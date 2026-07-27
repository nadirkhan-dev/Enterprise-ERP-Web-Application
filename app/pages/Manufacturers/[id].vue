<script setup lang="ts">
import type { ManufacturerCompetitor, ManufacturerSupplier } from '~/composables/useManufacturers'
import { useItemsFilterStore } from '~/stores/itemsFilter'
import { useManufacturersNavigationStore } from '~/stores/manufacturersNavigation'
import { useSearchStore } from '~/stores/search'

type CompetitorRow = ManufacturerCompetitor & { _logoSrc?: string | null, _logoSrcset?: string | null }
type SupplierRow = ManufacturerSupplier & { _logoSrc?: string | null, _logoSrcset?: string | null }

const route = useRoute()
const toast = useToast()
const navStore = useManufacturersNavigationStore()
const {
  fetchManufacturer,
  fetchManufacturerItems,
  fetchManufacturerItemCount,
  fetchManufacturerSuppliers,
  fetchManufacturerCompetitors,
  updateManufacturer,
  updateManufacturerSupplier,
  reorderManufacturerSuppliers,
  reorderManufacturerCompetitors,
  addManufacturerSuppliers,
  addManufacturerCompetitors,
} = useManufacturers()
const { fetchManufacturerQuarterlyChart } = useLooker()
const { getResponsiveUrl } = useAssetUrl()
const { subscribe: subscribeSapSync } = useSapSyncSocket()

const filterStore = useItemsFilterStore()
const searchStore = useSearchStore()

// A supplier created in the panel has no SAP account number until the Service Master
// sync writes it back. While that sync is in flight, its Account cell shows a
// "Syncing…" spinner instead of an empty dash. Keyed by partner (Directus) id.
const syncingSupplierIds = ref<Array<number | string>>([])
const supplierSapSyncUnsubscribers = new Map<string, () => void>()

function stopWatchingSupplierSapSync(partnerId: number | string) {
  syncingSupplierIds.value = syncingSupplierIds.value.filter((id) => String(id) !== String(partnerId))
  const unsubscribe = supplierSapSyncUnsubscribers.get(String(partnerId))
  if (unsubscribe) {
    unsubscribe()
    supplierSapSyncUnsubscribers.delete(String(partnerId))
  }
}

// Watch a just-created supplier's SAP sync over the SSE relay (same stream the
// supplier detail page uses). On success, reload so the real account number lands;
// on a terminal failure, just drop the spinner (the cell falls back to a dash).
function watchSupplierSapSync(partnerId: number | string) {
  if (supplierSapSyncUnsubscribers.has(String(partnerId))) { return }
  if (!syncingSupplierIds.value.some((id) => String(id) === String(partnerId))) {
    syncingSupplierIds.value.push(partnerId)
  }
  const unsubscribe = subscribeSapSync(partnerId, async (update) => {
    if (update.status === 'success' && update.sapId) {
      // Reload FIRST so the account number is already in the row, THEN drop the
      // spinner — otherwise the cell flashes "—" in the gap between the two.
      if (manufacturerId.value) { await loadSuppliers(manufacturerId.value) }
      stopWatchingSupplierSapSync(partnerId)
    } else if (update.status === 'failed' || update.status === 'retrying' || update.status === 'cancelled') {
      stopWatchingSupplierSapSync(partnerId)
    }
    // queued / processing → still syncing → keep the spinner.
  })
  supplierSapSyncUnsubscribers.set(String(partnerId), unsubscribe)
}

onBeforeUnmount(() => {
  supplierSapSyncUnsubscribers.forEach((unsubscribe) => unsubscribe())
  supplierSapSyncUnsubscribers.clear()
})

const isLoading = ref(true)
const { showLoader } = useDeferredLoading(isLoading)
const hasLoadError = ref(false)
const loadError = ref<string | null>(null)
const logoId = ref<string | null>(null)
const manufacturerId = ref<number | null>(null)
const logoFileInputRef = ref<HTMLInputElement | null>(null)

// Upload, FK repoint and deletion of the superseded file all happen in one server
// round-trip. Until now the repoint 403'd outright — the CONNECT policy had no
// update grant on `manufacturers`, so only admins could set a manufacturer logo.
const {
  isLogoProcessing,
  logoSrc,
  logoSrcset,
  handleLogoSelect,
  handleLogoRemove,
} = useEntityLogo(LOGO_COLLECTIONS.manufacturers, manufacturerId, logoId)

function triggerLogoUpload() {
  logoFileInputRef.value?.click()
}

const manufacturer = reactive({
  name: '',
  website: '',
  sapId: '',
  remarks: '',
})

// Exception to the identifier rule (CONNECT-537): a manufacturer's internal id is
// meaningless to users, so its detail-page title uses the NAME. Reactive so it
// updates once the record loads; falls back to 'Manufacturer' before then.
useHead({ title: () => manufacturer.name || 'Manufacturer' })

const suppliers = ref<SupplierRow[]>([])
const items = ref<Record<string, any>[]>([])
const itemCount = ref(0)
const competitors = ref<CompetitorRow[]>([])

// Suppliers default to active-only (CONNECT-556); the tab/count reflect that.
const activeSuppliers = computed(() => suppliers.value.filter((supplier) => supplier.status === 'active'))

// Supplier whose details/edit are shown in the side drawer.
const supplierDrawerVisible = ref(false)
const selectedSupplierId = ref<number | string | null>(null)

function openSupplierDetails(supplier: ManufacturerSupplier) {
  selectedSupplierId.value = supplier.id
  supplierDrawerVisible.value = true
}

// Add existing supplier(s): open the picker, then create junction rows for the
// selected business partners and reload the list.
const addSupplierDialogVisible = ref(false)
const existingSupplierIds = computed(() => suppliers.value.map((supplier) => supplier.id))

function openAddSupplier() {
  addSupplierDialogVisible.value = true
}

// The supplier picker's "Add New Supplier" button means different things by
// permission (per the connect meeting): a user who may create suppliers gets the
// create form IN A PANEL — so they never leave the manufacturer they're associating
// to — and the new supplier is auto-linked on success. Everyone else gets the
// request form, which emails ops (the CONNECT New Supplier Request flow). The right
// is asked for by name — a policy can grant `business_partners` create yet cap it at
// customers only.
const requestNewSupplierVisible = ref(false)
const createSupplierDrawerVisible = ref(false)
const { loadBusinessPartnerCreateRights, canCreateBusinessPartner } = usePermissions()

async function openRequestNewSupplier() {
  // Awaited so a click landing before the rights arrive still branches correctly
  // rather than falling through to the request form.
  await loadBusinessPartnerCreateRights()
  if (canCreateBusinessPartner('supplier')) {
    createSupplierDrawerVisible.value = true
    return
  }
  requestNewSupplierVisible.value = true
}

// A supplier created in the panel is immediately associated with this manufacturer —
// the whole reason it's created in place rather than on the standalone create page.
async function handleSupplierCreated(partnerId: number | string) {
  if (!manufacturerId.value) { return }
  const startSort = suppliers.value.length
  const results = await addManufacturerSuppliers(manufacturerId.value, [partnerId], startSort)
  if (results.some((entry) => entry.error)) {
    // The supplier DID get created — only the association failed. Say so, and point
    // the user at the recovery path rather than implying nothing happened.
    toast.add({
      severity: 'warn',
      summary: 'Created, not linked',
      detail: 'Supplier created, but linking it to this manufacturer failed. Add it via "Add Existing Supplier".',
      life: 6000,
    })
  } else {
    toast.add({ severity: 'success', summary: 'Supplier created', detail: 'Created and associated with this manufacturer.', life: 3000 })
  }
  await loadSuppliers(manufacturerId.value)
  // Spinner in the Account cell until the Service Master sync assigns its SAP number.
  watchSupplierSapSync(partnerId)
}

// "Back" in the request form returns to the supplier picker.
function handleBackToSupplierPicker() {
  addSupplierDialogVisible.value = true
}

async function handleAddSuppliers(businessPartnerIds: Array<number | string>) {
  if (!manufacturerId.value || !businessPartnerIds.length) { return }
  const startSort = suppliers.value.length
  const results = await addManufacturerSuppliers(manufacturerId.value, businessPartnerIds, startSort)
  if (results.some((entry) => entry.error)) {
    toast.add({ severity: 'error', summary: 'Failed', detail: 'Could not add some suppliers.', life: 5000 })
  } else {
    // Singular for one, plural for many — no "(s)" brace form.
    const noun = businessPartnerIds.length === 1 ? 'Supplier' : 'Suppliers'
    toast.add({ severity: 'success', summary: 'Added', detail: `${noun} added.`, life: 3000 })
  }
  await loadSuppliers(manufacturerId.value)
}

// Persist a drag-reorder of the supplier list (writes business_partners_sort).
async function handleSupplierReorder(orderedJunctionIds: Array<number | string>) {
  const results = await reorderManufacturerSuppliers(orderedJunctionIds)
  if (results.some((entry) => entry.error)) {
    toast.add({ severity: 'error', summary: 'Failed', detail: 'Could not save the new order.', life: 5000 })
  }
}

// Save status / remarks edits from the supplier drawer.
async function handleSupplierSave(payload: { junctionId: number | string, status?: string, remarks?: string | null }) {
  const { junctionId, ...changes } = payload
  const { error } = await updateManufacturerSupplier(junctionId, changes)
  if (error) {
    toast.add({ severity: 'error', summary: 'Failed', detail: 'Could not save supplier changes.', life: 5000 })
    return
  }
  const target = suppliers.value.find((supplier) => supplier.junctionId === junctionId)
  if (target) {
    if (changes.status !== undefined) { target.status = changes.status }
    if (changes.remarks !== undefined) { target.remarks = changes.remarks }
  }
  toast.add({ severity: 'success', summary: 'Saved', detail: 'Supplier updated.', life: 3000 })
}

// Competitor whose details are shown in the side drawer (right pane).
const competitorsDrawerVisible = ref(false)
const selectedCompetitorId = ref<number | string | null>(null)

function openCompetitorDetails(competitor: ManufacturerCompetitor) {
  selectedCompetitorId.value = competitor.id
  competitorsDrawerVisible.value = true
}

// Persist a drag-reorder of the competitor list (writes competitors_sort).
async function handleCompetitorReorder(orderedJunctionIds: Array<number | string>) {
  const results = await reorderManufacturerCompetitors(orderedJunctionIds)
  if (results.some((entry) => entry.error)) {
    toast.add({ severity: 'error', summary: 'Failed', detail: 'Could not save the new order.', life: 5000 })
  }
}

// Add existing competitor(s): open the picker, then create junction rows for the
// selected competitors and reload the list.
const addCompetitorDialogVisible = ref(false)
const existingCompetitorIds = computed(() => competitors.value.map((competitor) => competitor.id))

function openAddCompetitor() {
  addCompetitorDialogVisible.value = true
}

// Request a competitor that isn't in Connect yet — the competitor picker's "Add
// New Competitor" button, mirroring the supplier picker's escape hatch.
const requestNewCompetitorVisible = ref(false)

function openRequestNewCompetitor() {
  requestNewCompetitorVisible.value = true
}

// "Back" in the request form returns to the competitor picker.
function handleBackToCompetitorPicker() {
  addCompetitorDialogVisible.value = true
}

async function handleAddCompetitors(competitorIds: Array<number | string>) {
  if (!manufacturerId.value || !competitorIds.length) { return }
  const startSort = competitors.value.length
  const results = await addManufacturerCompetitors(manufacturerId.value, competitorIds, startSort)
  if (results.some((entry) => entry.error)) {
    toast.add({ severity: 'error', summary: 'Failed', detail: 'Could not add some competitors.', life: 5000 })
  } else {
    // Singular for one, plural for many — no "(s)" brace form.
    const noun = competitorIds.length === 1 ? 'Competitor' : 'Competitors'
    toast.add({ severity: 'success', summary: 'Added', detail: `${noun} added.`, life: 3000 })
  }
  await loadCompetitors(manufacturerId.value)
}

const chartBars = ref<{ label: string, bookedSales: number, orderCount: number }[]>([])
const isChartLoading = ref(true)
// Computed so the "Looker" header link is available *before* the chart
// API resolves — otherwise it'd be hidden during skeleton loading.
// Mirrors the pattern in Suppliers/[id].vue.
const chartLookerUrl = computed(() => {
  if (!manufacturer.name) return null
  // Hide the link during navigation: only expose the URL once the loaded
  // manufacturer matches the current route, otherwise we'd briefly show
  // the previous manufacturer's name in the link target.
  if (String(manufacturerId.value) !== String(route.params.id)) return null
  const params = new URLSearchParams()
  params.set('Item Manufacturer', manufacturer.name)
  params.set('Created On Date', '9 quarter')
  return `https://libertysupply.cloud.looker.com/dashboards/162?${params.toString()}`
})

async function loadManufacturerQuarterlyChart(manufacturerName: string) {
  if (!manufacturerName) {
    chartBars.value = []
    isChartLoading.value = false
    return
  }
  isChartLoading.value = true
  const { data, error } = await fetchManufacturerQuarterlyChart(manufacturerName)
  if (error) {
    console.error('Failed to load manufacturer quarterly chart:', error.message)
    chartBars.value = []
    isChartLoading.value = false
    return
  }
  chartBars.value = data?.rows ?? []
  isChartLoading.value = false
}

const ITEMS_PER_PAGE = 20
const itemsCurrentPage = ref(1)
const itemsHasMore = ref(true)
const isItemsLoadingMore = ref(false)
const itemsSearchQuery = ref('')
let itemsLoadRequestId = 0
let itemsSearchDebounce: ReturnType<typeof setTimeout> | null = null
const isItemsSectionCollapsed = ref(true)

const itemsSortField = computed(() => filterStore.sortField)
const itemsSortOrder = computed(() => filterStore.sortOrder)

function buildItemsSortParam() {
  if (!filterStore.sortField) return null
  const prefix = filterStore.sortOrder === -1 ? '-' : ''
  return [`${prefix}${filterStore.sortField}`]
}

async function loadItems(page = 1) {
  const routeId = String(route.params.id)
  if (!routeId) return

  const currentRequestId = ++itemsLoadRequestId

  if (page !== 1) {
    isItemsLoadingMore.value = true
  }
  // For page === 1 (filter/sort changes) we intentionally DO NOT clear
  // `items.value` here. Wiping it would collapse the table height,
  // remove the page's scrollbar, and shift everything when the new
  // results arrive a moment later. Old rows stay visible until the
  // request resolves and we replace them atomically below.

  const statusValues = filterStore.selectedStatuses.length
    ? [...filterStore.selectedStatuses]
    : null
  const search = itemsSearchQuery.value.trim() || null
  const isSpecialOrderOnly = filterStore.isSpecialOrderOnly

  const [listResult, countResult] = await Promise.all([
    fetchManufacturerItems(routeId, {
      limit: ITEMS_PER_PAGE,
      page,
      sort: buildItemsSortParam(),
      search,
      statusValues,
      isSpecialOrderOnly,
    }),
    page === 1
      ? fetchManufacturerItemCount(routeId, { search, statusValues, isSpecialOrderOnly })
      : Promise.resolve(null),
  ])

  if (currentRequestId !== itemsLoadRequestId) return

  if (!listResult.error && listResult.data) {
    if (page === 1) {
      items.value = listResult.data
    } else {
      items.value = [...items.value, ...listResult.data]
    }
    itemsHasMore.value = listResult.data.length === ITEMS_PER_PAGE
    if (items.value.length > 0 && isItemsSectionCollapsed.value) {
      isItemsSectionCollapsed.value = false
    }
  }

  if (countResult && !countResult.error && countResult.data !== null) {
    itemCount.value = countResult.data
  }

  isItemsLoadingMore.value = false
  itemsCurrentPage.value = page
}

function handleItemsScrollNearBottom() {
  if (itemsHasMore.value && !isItemsLoadingMore.value) {
    loadItems(itemsCurrentPage.value + 1)
  }
}

function handleItemsSort(event: { sortField: string | null; sortOrder: number | null }) {
  filterStore.setSort(event.sortField, event.sortOrder)
  itemsCurrentPage.value = 1
  itemsHasMore.value = true
  loadItems(1)
}

// Refetch from page 1 whenever filters change (no debounce — discrete actions).
watch(
  [
    () => filterStore.selectedStatuses,
    () => filterStore.isSpecialOrderOnly,
  ],
  () => {
    itemsCurrentPage.value = 1
    itemsHasMore.value = true
    loadItems(1)
  },
  { deep: true },
)

// Debounce search keystrokes so we don't hammer the API on every character.
watch(itemsSearchQuery, () => {
  if (itemsSearchDebounce) clearTimeout(itemsSearchDebounce)
  itemsSearchDebounce = setTimeout(() => {
    itemsCurrentPage.value = 1
    itemsHasMore.value = true
    loadItems(1)
  }, 300)
})

onBeforeUnmount(() => {
  if (itemsSearchDebounce) clearTimeout(itemsSearchDebounce)
})

const navTabs = computed(() => [
  // Performance section is commented out (see template) — keep its tab hidden too
  // until the section is re-enabled.
  // { label: 'Performance', icon: 'pi pi-chart-line', sectionId: 'performance' },
  {
    label: `Suppliers (${activeSuppliers.value.length})`,
    icon: 'pi pi-box',
    sectionId: 'suppliers',
  },
  {
    label: `Competitors (${competitors.value.length})`,
    icon: 'ms:directions_run',
    sectionId: 'competitors',
  },
  {
    label: `Items (${itemCount.value.toLocaleString()})`,
    icon: 'ms:barcode_scanner',
    sectionId: 'items',
  },
])

const quotesEnabled = ref(true)
const ordersEnabled = ref(true)
const periodOptions = ref([
  { label: 'Previous 12 Months', value: '12m' },
  { label: 'Previous 6 Months', value: '6m' },
  { label: 'Previous 3 Months', value: '3m' },
])
const selectedPeriod = ref('12m')

// Suppliers associated with the manufacturer (manufacturers_business_partners
// junction). Resolve each logo to a small thumbnail for the Company cell.
async function loadSuppliers(mfrId: number | string) {
  const { data, error } = await fetchManufacturerSuppliers(mfrId)
  if (error || !data) {
    suppliers.value = []
    return
  }
  await Promise.all(data.map(async (supplier: SupplierRow) => {
    const responsive = await getResponsiveUrl(supplier.logoId, 56)
    supplier._logoSrc = responsive?.src ?? null
    supplier._logoSrcset = responsive?.srcset ?? null
  }))
  suppliers.value = data
}

// Competitors associated with the manufacturer (read-only, SupplyHub-ordered).
// Resolve each logo to a small thumbnail for the Company cell.
async function loadCompetitors(mfrId: number | string) {
  const { data, error } = await fetchManufacturerCompetitors(mfrId)
  if (error || !data) {
    competitors.value = []
    return
  }
  await Promise.all(data.map(async (competitor: CompetitorRow) => {
    const responsive = await getResponsiveUrl(competitor.logoId, 56)
    competitor._logoSrc = responsive?.src ?? null
    competitor._logoSrcset = responsive?.srcset ?? null
  }))
  competitors.value = data
}

async function loadManufacturer() {
  const routeId = String(route.params.id)
  if (!routeId) {
    navigateTo('/manufacturers')
    return
  }

  isLoading.value = true
  hasLoadError.value = false
  loadError.value = null

  const { data: manufacturerData, error } =
        await fetchManufacturer(routeId)

  if (error) {
    console.error('Failed to load manufacturer:', error.message)
    if (isServerError(error)) {
      hasLoadError.value = true
    } else {
      loadError.value = 'Failed to load manufacturer. Please try again.'
    }
    isLoading.value = false
    return
  }

  if (!manufacturerData) {
    loadError.value = 'Manufacturer not found.'
    isLoading.value = false
    return
  }

  logoId.value = manufacturerData.logo_id || null
  manufacturerId.value = manufacturerData.id

  manufacturer.name = manufacturerData.name || ''
  manufacturer.website = manufacturerData.website || ''
  manufacturer.sapId = manufacturerData.sap_id ? String(manufacturerData.sap_id) : ''

  loadSuppliers(manufacturerData.id)
  loadCompetitors(manufacturerData.id)
  await loadItems(1)

  isLoading.value = false

  // Quarterly performance chart from Looker — keyed off the manufacturer
  // name since the Looker dashboard filter is "Item Manufacturer".
  chartBars.value = []
  isChartLoading.value = true
  loadManufacturerQuarterlyChart(manufacturer.name)
}

// Loads the manufacturer and points the Next/Prev navigation at it. The nav
// store decides whether this is a fresh entry (rebuild) or a Next/Prev step.
function handleManufacturerRoute() {
  navStore.enterManufacturer(String(route.params.id))
  loadManufacturer()
}

// The page transition re-creates this component on every Next/Prev, so
// `onMounted` covers in-detail navigation; the route watch covers the case
// where the component is reused instead.
watch(() => route.params.id, handleManufacturerRoute)
onMounted(() => {
  handleManufacturerRoute()
  // Warm the supplier create rights so "Add New Supplier" branches instantly.
  loadBusinessPartnerCreateRights()
})

// Surface navigation fetch failures as a toast. The nonce re-fires the
// watcher even when consecutive failures carry the same message.
watch(
  () => navStore.navErrorNonce,
  () => {
    toast.add({
      severity: 'error',
      summary: 'Manufacturer navigation',
      detail: navStore.navErrorMessage ?? 'Something went wrong.',
      life: 4000,
    })
  },
)
</script>

<template>
  <div class="manufacturer-page">
    <BaseLoader
      v-if="showLoader"
      overlay
      label="Loading manufacturer…"
    />

    <!-- Top toolbar — back link + next-prev CTAs -->
    <div
      v-if="!hasLoadError"
      class="manufacturer-page__top"
    >
      <BaseBackButton
        to="/manufacturers"
        label="Back to Manufacturers"
        class="manufacturer-back"
      />
      <ManufacturersToolbar :show-navigation="true" />
    </div>

    <Error500 v-if="hasLoadError" />

    <Message
      v-if="loadError"
      severity="error"
      :closable="false"
    >
      {{ loadError }}
    </Message>

    <div
      v-if="!isLoading && !hasLoadError && !loadError"
      class="manufacturer-page__content"
    >
      <ProfileCard
        :tabs="navTabs"
        :chart-bars="chartBars"
        :looker-url="chartLookerUrl"
        :is-chart-loading="isChartLoading"
        order-count-label="Units Sold"
      >
        <template #avatar>
          <input
            ref="logoFileInputRef"
            type="file"
            accept="image/* " class="visually-hidden" @change="handleLogoSelect" > <div class="manufacturer-avatar"> <img v-if="logoSrc" :src="logoSrc" :srcset="logoSrcset" sizes="(min-width: 768px) 150px, 120px" alt="Manufacturer logo" class="manufacturer-avatar__image" width="150" height="150" loading="lazy" @error="logoId = null" /> <BasePlaceholderIcon v-else category="manufacturer" class="placeholder-avatar__icon" /> <div v-if="isLogoProcessing" class="manufacturer-avatar__processing" > <BaseSpinner size="md" /> </div> </div> </template> <template #identity> <div class="manufacturer-profile__name-row"> <span class="manufacturer-profile__name">{{ manufacturer.name }}</span> <BaseWebsiteLink :website="manufacturer.website" :name="manufacturer.name" /> </div> </template> </ProfileCard> <!-- Performance — commented out for now; un-comment if/when needed. <BasePanel id="performance" title="Performance" > <template #actions> <div class="performance-actions"> <div class="performance-toggles"> <label class="performance-toggle"> <InputSwitch v-model="quotesEnabled" /> <span>Quotes</span> </label> <label class="performance-toggle"> <InputSwitch v-model="ordersEnabled" /> <span>Orders</span> </label> </div> <Select v-model="selectedPeriod" :options="periodOptions" option-label="label" option-value="value" size="small" :filter="periodOptions.length > 10" class="performance-period" /> </div> </template> <div class="chart-placeholder"> Chart placeholder </div> </BasePanel> --> <!-- Suppliers --> <SectionManufacturerSuppliers :suppliers="suppliers" :syncing-supplier-ids="syncingSupplierIds" :collapsed="!activeSuppliers.length" :active-detail-id="supplierDrawerVisible ? selectedSupplierId : null" @view-details="openSupplierDetails" @reorder="handleSupplierReorder" @add="openAddSupplier" /> <!-- Competitors --> <SectionManufacturerCompetitors :competitors="competitors" :collapsed="!competitors.length" :active-detail-id="competitorsDrawerVisible ? selectedCompetitorId : null" @view-details="openCompetitorDetails" @reorder="handleCompetitorReorder" @add="openAddCompetitor" /><!-- Items --> <SectionManufacturerItems v-model:search="itemsSearchQuery" :items="items" :item-count="itemCount" :collapsed="isItemsSectionCollapsed" :is-loading-more="isItemsLoadingMore" :sort-field="itemsSortField" :sort-order="itemsSortOrder" :total-records="itemCount" @scroll-near-bottom="handleItemsScrollNearBottom" @sort="handleItemsSort" /> <DrawerManufacturerAssociations v-model:visible="competitorsDrawerVisible" mode="competitors" :items="competitors" :initial-detail-id="selectedCompetitorId" /> <DrawerManufacturerAssociations v-model:visible="supplierDrawerVisible" mode="suppliers" :items="suppliers" :initial-detail-id="selectedSupplierId" @save="handleSupplierSave" /> <DrawerAddManufacturerAssociation v-model:visible="addSupplierDialogVisible" mode="suppliers" :existing-ids="existingSupplierIds" :entity-name="manufacturer.name" @save="handleAddSuppliers" @add-new="openRequestNewSupplier" /> <DrawerAddManufacturerAssociation v-model:visible="addCompetitorDialogVisible" mode="competitors" :existing-ids="existingCompetitorIds" :entity-name="manufacturer.name" @save="handleAddCompetitors" @add-new="openRequestNewCompetitor" /> <DrawerRequestNewCompany v-model:visible="requestNewSupplierVisible" mode="supplier" back-to="Suppliers" :manufacturer-id="manufacturerId" @back="handleBackToSupplierPicker" /> <DrawerCreateSupplier v-model:visible="createSupplierDrawerVisible" @created="handleSupplierCreated" /> <DrawerRequestNewCompany v-model:visible="requestNewCompetitorVisible" mode="competitor" back-to="Competitors" :manufacturer-id="manufacturerId" @back="handleBackToCompetitorPicker" /> </div> <PageScrollTop /> </div> </template> <style scoped> /* Page layout */
.manufacturer-page {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    padding: 0;

    @media (min-width: 768px) {
        gap: var(--p-spacing-4);
    }
}

/* Top toolbar — back link + next-prev CTAs */
.manufacturer-page__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-3);
}

.manufacturer-page__top > .manufacturers-toolbar {
    margin-left: auto;
}
.manufacturer-page__content {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    margin-top: calc(-1 * var(--p-spacing-8));

    @media (min-width: 768px) {
        display: contents;
    }
}

/* Manufacturer avatar (ProfileCard #avatar slot) */
.manufacturer-avatar {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--p-surface-0);
    border: var(--p-spacing-1) solid var(--p-surface-100);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

.manufacturer-avatar__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
}

.manufacturer-avatar__actions {
    position: absolute;
    top: 15%;
    left: 85%;
    transform: translate(-50%, -50%);
    z-index: 2;
    display: flex;
    gap: var(--p-spacing-1);
}

.manufacturer-avatar__actions--hover-only {
    top: var(--p-spacing-2);
    left: auto;
    right: var(--p-spacing-2);
    transform: none;
    opacity: 1;
    transition: opacity var(--p-transition-duration);

    @media (min-width: 768px) {
        opacity: 0;
    }
}

:deep(.manufacturer-avatar__actions .p-button) {
    background: var(--p-surface-0);
}

.manufacturer-avatar__processing {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Mobile defaults — back button hidden */
.manufacturer-back {
    display: none;

    @media (min-width: 768px) {
        display: inline-flex;
    }
}

:deep(.profile-card .profile-chart) {
    inset: var(--p-spacing-4) var(--p-spacing-2) var(--p-spacing-5);

    @media (min-width: 768px) {
        inset: var(--p-spacing-4) var(--p-spacing-3) var(--p-spacing-3);
    }
}

:deep(.profile-card-wrapper .profile-card.has-chart .profile-card__identity) {
    margin-top: calc(var(--p-spacing-4) + var(--p-spacing-3));
}

/* Profile identity (ProfileCard #identity slot) */
.manufacturer-profile__name-row {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
    margin-top: 0;
    justify-content: center;
    text-align: center;

    @media (min-width: 768px) {
        justify-content: flex-start;
        text-align: left;
    }
}

.manufacturer-profile__name {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);
    padding: var(--p-spacing-0) var(--p-spacing-3);
    border-radius: var(--p-border-radius-full);

    @media (min-width: 768px) {
        background: var(--p-surface-0);
    }
}
.manufacturer-profile__name-row :deep(.base-icon-button) {
    background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);

    @media (min-width: 768px) {
        background: var(--p-surface-0);
    }
}

.manufacturer-profile__name-row :deep(.base-icon-button:hover),
.manufacturer-profile__name-row :deep(.base-icon-button:focus-visible) {
    background: var(--p-tideblue-50);
}

.performance-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    width: 100%;
    gap: var(--p-spacing-3);

    @media (min-width: 768px) {
        flex-direction: row;
        align-items: center;
        width: auto;
        gap: var(--p-spacing-4);
    }
}

.performance-toggles {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-4);
}

.performance-toggle {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    font-size: var(--p-font-size-sm);
    color: var(--p-text-muted-color);
    cursor: pointer;
}

.performance-period {
    width: 100%;

    @media (min-width: 768px) {
        width: 200px;
    }
}

:deep(.base-panel__header) {
    flex-wrap: wrap;

    @media (min-width: 768px) {
        flex-wrap: nowrap;
    }
}

.chart-placeholder {
    height: 280px;
    border: 1px dashed var(--p-surface-300);
    border-radius: var(--p-border-radius-xs);
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--p-text-muted-color);
    font-size: var(--p-font-size-sm);
}

</style>
