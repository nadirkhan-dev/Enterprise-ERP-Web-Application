<script setup lang="ts">
import type { BusinessPartnerManufacturer } from '~/composables/useBusinessPartners'
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'
import { useSuppliersFilterStore } from '~/stores/suppliersFilter'

useHead({ title: 'Suppliers' })

const tableRef = ref(null)
const { showFooterShadow } = useTableFooterShadow(tableRef)

const searchStore = useSearchStore()
const tableStateStore = useTableStateStore()
const filterStore = useSuppliersFilterStore()
const { handleNoResults } = useScopeResultsSearch()

// Apply default filters on the first-ever visit — guarded by the persisted
// `hasInitializedDefaults` flag so it runs exactly once and never resurrects
// filters the user cleared. Gated on `import.meta.client` (not `isHydrating`)
// so the defaults also apply when the page is reached via SPA navigation, not
// only on a hard refresh.
if (import.meta.client && !filterStore.hasInitializedDefaults) {
  filterStore.resetToDefaults()
}

if (useNuxtApp().isHydrating) {
  tableStateStore.clearTableState('/suppliers')
}

// Resolve the Product group default before the page renders so the
// chip row paints in one frame (no async pop-in after mount).
await filterStore.ensureBusinessPartnerGroupsLoaded()

const defaultSupplierGroupIds = filterStore.productGroupId !== null
  ? [filterStore.productGroupId]
  : []

useUrlSyncedListState({
  status: {
    get: () => filterStore.selectedStatuses,
    set: (value: string[]) => filterStore.setStatuses(value),
    defaultValue: [],
    parse: (raw) => {
      if (raw === '') return []
      return raw.split(',').filter((value) => value === 'active' || value === 'inactive')
    },
    serialize: (value: string[]) => (value.length ? value.join(',') : null),
  },
  business_partner_groups_id: {
    get: () => filterStore.selectedBusinessPartnerGroupIds,
    set: (value: number[]) => filterStore.setBusinessPartnerGroupIds(value),
    defaultValue: defaultSupplierGroupIds,
    parse: (raw) => {
      if (raw === '') return []
      return raw.split(',').map(Number).filter((value) => Number.isFinite(value) && value > 0)
    },
    serialize: (value: number[]) => (value.length ? value.join(',') : null),
  },
  manufacturers_id: {
    get: () => filterStore.selectedManufacturerIds,
    set: (value: number[]) => filterStore.setManufacturerIds(value),
    defaultValue: [],
    parse: (raw) => {
      if (raw === '') return []
      return raw.split(',').map(Number).filter((value) => Number.isFinite(value) && value > 0)
    },
    serialize: (value: number[]) => (value.length ? value.join(',') : null),
  },
  sort: {
    get: () => ({ field: filterStore.sortField, order: filterStore.sortOrder }),
    set: ({ field, order }: { field: string; order: number }) => filterStore.setSort(field, order),
    defaultValue: { field: 'account_number', order: 1 },
    parse: (raw) => {
      if (!raw) return undefined
      if (raw.startsWith('-')) return { field: raw.slice(1), order: -1 }
      return { field: raw, order: 1 }
    },
    serialize: ({ field, order }) => {
      if (!field) return null
      if (field === 'account_number' && order === 1) return null
      return order === -1 ? `-${field}` : field
    },
  },
})

interface FilterChip {
  key: string
  label: string
  remove: () => void
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
}

const activeFilterChips = computed<FilterChip[]>(() => {
  const chips: FilterChip[] = []

  filterStore.selectedStatuses.forEach((statusValue) => {
    chips.push({
      key: `status-${statusValue}`,
      label: STATUS_LABELS[statusValue] ?? statusValue,
      remove: () => filterStore.setStatuses(
        filterStore.selectedStatuses.filter((value) => value !== statusValue),
      ),
    })
  })

  filterStore.selectedBusinessPartnerGroupIds.forEach((groupId) => {
    const group = filterStore.getBusinessPartnerGroupById(groupId)
    chips.push({
      key: `group-${groupId}`,
      label: group?.name ?? 'Supplier Group',
      remove: () => filterStore.setBusinessPartnerGroupIds(
        filterStore.selectedBusinessPartnerGroupIds.filter((value) => value !== groupId),
      ),
    })
  })

  filterStore.selectedManufacturerIds.forEach((manufacturerId) => {
    const manufacturer = filterStore.getManufacturerById(manufacturerId)
    chips.push({
      key: `manufacturer-${manufacturerId}`,
      label: manufacturer?.name ?? 'Manufacturer',
      remove: () => filterStore.setManufacturerIds(
        filterStore.selectedManufacturerIds.filter((value) => value !== manufacturerId),
      ),
    })
  })

  return chips
})

const suppliers = ref<Record<string, any>[]>([])
const totalRecords = ref(0)
const isLoading = ref(true)
const hasLoadError = ref(false)
const { showLoader } = useDeferredLoading(isLoading)
const currentPage = ref(1)
const hasMore = ref(true)
const isLoadingMore = ref(false)
const rowsPerPage = 46

const skeletonRows = Array.from({ length: rowsPerPage }, (_, index) => ({
  id: `skeleton-${index}`,
  _skeleton: true,
}))

function buildSortParam() {
  if (!filterStore.sortField) { return null }
  const prefix = filterStore.sortOrder === -1 ? '-' : ''
  return [`${prefix}${filterStore.sortField}`]
}

function handleSort(event: any) {
  filterStore.setSort(event.sortField ?? null, event.sortOrder ?? null)
  currentPage.value = 1
  hasMore.value = true
  loadSuppliers(1, searchStore.searchQuery)
}

const SUPPLIER_LIST_FIELDS = [
  'id',
  'account_number',
  'name',
  'website',
  'status',
  'business_partner_groups_id.name',
  // Only active associations are surfaced, so the "Manufacturers" cell counts
  // the rows returned under SUPPLIER_LIST_DEEP rather than using
  // `count(manufacturers)` — Directus applies `deep` to nested rows but not to
  // the count() function, which would tally inactive rows too.
  'manufacturers.id',
]

// Restrict the nested association rows to active ones. `_limit: -1` overrides
// the default nested cap so a supplier with many manufacturers still counts all
// of them.
const SUPPLIER_LIST_DEEP = {
  manufacturers: {
    _filter: { status: { _eq: 'active' } },
    _limit: -1,
  },
}

const {
  fetchBusinessPartners,
  fetchBusinessPartnerCount,
  fetchBusinessPartnerByAccountNumber,
  fetchPartnerManufacturers,
  updatePartnerManufacturer,
  reorderPartnerManufacturers,
} = useBusinessPartners()
const toast = useToast()

// Exact account-number searches bypass filters and jump straight to the
// supplier's detail page so active filters can never hide an exact match.
const { redirectIfExactKey } = useExactKeySearch(async (term) => {
  const { data, error } = await fetchBusinessPartnerByAccountNumber(term)
  if (error || !data || data.relationship_type !== 'supplier') {
    return null
  }
  return `/suppliers/${data.account_number || data.id}`
})

// Cross-entity exact match: if search term is an exact key for a different
// entity type (e.g., Customer SAP ID while on Suppliers list), redirect there.
const { redirectIfCrossScopeMatch } = useCrossScopeExactMatch()

let loadRequestId = 0
let tailRequestId = 0
let isInitialMount = true

async function loadSuppliers(page = 1, search: string | null = null) {
  const currentRequestId = ++loadRequestId
  const searchTerm = search || null

  if (page === 1) {
    isLoading.value = true
    hasLoadError.value = false
    suppliers.value = []
  } else {
    isLoadingMore.value = true
  }

  // An exact account-number search takes precedence over active filters so
  // the matching supplier is never filtered out of the results.
  const bypassFilters = !!searchTerm && isExactKeySearch(searchTerm)
  const statusValues = !bypassFilters && filterStore.selectedStatuses.length
    ? [...filterStore.selectedStatuses]
    : null
  const businessPartnerGroupIds = !bypassFilters && filterStore.selectedBusinessPartnerGroupIds.length
    ? [...filterStore.selectedBusinessPartnerGroupIds]
    : null
  const manufacturerIds = !bypassFilters && filterStore.selectedManufacturerIds.length
    ? [...filterStore.selectedManufacturerIds]
    : null

  const [listResult, countResult] = await Promise.all([
    fetchBusinessPartners({
      relationshipType: 'supplier',
      fields: SUPPLIER_LIST_FIELDS,
      deep: SUPPLIER_LIST_DEEP,
      limit: rowsPerPage,
      page,
      search: searchTerm,
      sort: buildSortParam(),
      statusValues,
      businessPartnerGroupIds,
      manufacturerIds,
    }),
    page === 1
      ? fetchBusinessPartnerCount({
        relationshipType: 'supplier',
        search: searchTerm,
        statusValues,
        businessPartnerGroupIds,
        manufacturerIds,
      })
      : Promise.resolve(null),
  ])

  if (currentRequestId !== loadRequestId) {
    return
  }

  if (!listResult.error) {
    if (page === 1) {
      suppliers.value = listResult.data
    } else {
      suppliers.value = [...suppliers.value, ...listResult.data]
    }
    hasMore.value = listResult.data.length === rowsPerPage
  } else if (page === 1 && isServerError(listResult.error)) {
    hasLoadError.value = true
  }
  if (countResult && !countResult.error) {
    totalRecords.value = countResult.data
  }

  isLoading.value = false
  isLoadingMore.value = false
  currentPage.value = page
  searchStore.setResultCount(suppliers.value.length)

  if (page === 1 && !hasLoadError.value && suppliers.value.length === 0 && searchStore.searchQuery) {
    handleNoResults('suppliers', searchStore.searchQuery)
  }
}

// Pre-warm the navigation TAIL in the background: the last rows of the current
// filtered/sorted sequence, fetched once under the reversed sort (account_number only)
// and stashed in tableState. The supplier detail page seeds its tail segment
// from this, so Previous on the first supplier — the wrap to the LAST supplier —
// is instant instead of waiting on a round-trip. Skipped when a matching tail is
// already warm, or for an exact-key search (which redirects straight to detail).
async function prefetchTail() {
  const currentTailRequestId = ++tailRequestId
  const searchTerm = searchStore.searchQuery || null
  if (searchTerm && isExactKeySearch(searchTerm)) { return }

  const search = searchStore.searchQuery || ''
  const sortField = filterStore.sortField
  const sortOrder = filterStore.sortOrder

  const existing = tableStateStore.getTailState('/suppliers')
  if (existing
    && existing.searchQuery === search
    && existing.sortField === sortField
    && existing.sortOrder === sortOrder) {
    return
  }

  // Match the nav store's tail sort (buildSuppliersSort): primary + `account_number`.
  const field = sortField || 'account_number'
  const primary = sortOrder === -1 ? `-${field}` : field
  const forwardSort = field === 'account_number' ? [primary] : [primary, 'account_number']

  const { data, error } = await fetchBusinessPartners({
    relationshipType: 'supplier',
    fields: ['account_number', 'name'],
    sort: reverseSort(forwardSort),
    statusValues: filterStore.selectedStatuses.length
      ? [...filterStore.selectedStatuses] : null,
    businessPartnerGroupIds: filterStore.selectedBusinessPartnerGroupIds.length
      ? [...filterStore.selectedBusinessPartnerGroupIds] : null,
    manufacturerIds: filterStore.selectedManufacturerIds.length
      ? [...filterStore.selectedManufacturerIds] : null,
    search: searchTerm,
    limit: TAIL_PREFETCH_SIZE,
    page: 1,
  })
  // Discard if a newer prefetch (filter/sort/search change) superseded this one.
  if (currentTailRequestId !== tailRequestId || error || !data) { return }

  // Fetched descending; store forward order so the nav store uses it directly.
  tableStateStore.saveTailState('/suppliers', {
    rows: [...data].reverse(),
    reachedStart: data.length < TAIL_PREFETCH_SIZE,
    sortField,
    sortOrder,
    searchQuery: search,
  })
}

function handleScroll(event: Event) {
  const container = event.target as HTMLElement
  const threshold = 100
  const nearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        threshold
  if (
    nearBottom &&
        hasMore.value &&
        !isLoadingMore.value &&
        !isLoading.value
  ) {
    loadSuppliers(currentPage.value + 1, searchStore.searchQuery)
  }
}


// `manufacturers` arrives pre-filtered to active rows (SUPPLIER_LIST_DEEP), so
// its length is the active-only tally shown in the list and the drawer.
function getManufacturerCount(supplier: Record<string, any>): number {
  return Array.isArray(supplier.manufacturers) ? supplier.manufacturers.length : 0
}

// ── Manufacturers drawer (per-supplier flyout) ──────────────────────────────
// Follows the manufacturer-list pattern: the page fetches the association rows
// and feeds the shared DrawerManufacturerAssociations in `manufacturers` mode.
const manufacturerDrawerVisible = ref(false)
const manufacturerDrawerLoading = ref(false)
const manufacturerDrawerItems = ref<BusinessPartnerManufacturer[]>([])
const manufacturerDrawerSkeletonCount = ref(0)
// The supplier whose manufacturers drawer is open — drives the active-row tint.
const activeDrawerSupplier = ref<Record<string, any> | null>(null)

async function openManufacturersDrawer(supplier: Record<string, any>) {
  if (getManufacturerCount(supplier) < 1) { return }
  manufacturerDrawerItems.value = []
  manufacturerDrawerSkeletonCount.value = getManufacturerCount(supplier)
  manufacturerDrawerLoading.value = true
  activeDrawerSupplier.value = supplier
  manufacturerDrawerVisible.value = true
  const { data, error } = await fetchPartnerManufacturers(supplier.id)
  if (!error && data) {
    manufacturerDrawerItems.value = data
  }
  manufacturerDrawerLoading.value = false
}

// Skeleton rows keep the loader class; the open-drawer supplier gets a saturated
// tint + accent bar so it stays identifiable beside the drawer (matches the
// customers list contacts-drawer pattern).
function rowClass(rowData: Record<string, any>): string {
  if (rowData._skeleton) { return 'skeleton-row' }
  if (manufacturerDrawerVisible.value && activeDrawerSupplier.value && rowData.id === activeDrawerSupplier.value.id) {
    return 'suppliers-table__row--active-drawer'
  }
  return ''
}

// Persist a status/remarks edit, then reflect it onto the open list row so the
// status tag updates without a refetch.
async function handleManufacturerSave(payload: { id: number | string, status: string, remarks: string | null }) {
  const { error } = await updatePartnerManufacturer(payload.id, {
    status: payload.status,
    remarks: payload.remarks,
  })
  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Save failed',
      detail: 'The manufacturer remarks could not be saved. Please try again.',
      life: 4000,
    })
    return
  }
  const row = manufacturerDrawerItems.value.find((manufacturer) => manufacturer.id === payload.id)
  if (row) {
    row.status = payload.status
    row.remarks = payload.remarks
  }
}

async function handleManufacturerReorder(orderedRows: Array<{ id: number | string, currentSort: number | null }>) {
  const { error } = await reorderPartnerManufacturers(orderedRows)
  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Reorder failed',
      detail: 'The manufacturer order could not be saved. Please try again.',
      life: 4000,
    })
    return
  }
  // Advance the saved baseline so the next drop diffs against current positions.
  orderedRows.forEach((orderedRow, index) => {
    const row = manufacturerDrawerItems.value.find((manufacturer) => manufacturer.id === orderedRow.id)
    if (row) { row.sortOrder = index }
  })
}

const {
  handleRowClick,
  handleRowContextMenu,
  contextMenuRef,
  contextMenuItems,
} = useRowNavigation((rowData) => `/suppliers/${rowData.account_number || rowData.id}`)

const filteredSuppliers = computed(() => {
  if (showLoader.value) {return skeletonRows}
  const term = searchStore.filterText.toLowerCase()
  if (!term) {
    return suppliers.value
  }

  return suppliers.value.filter((supplier) => {
    const searchableValues = [
      supplier.account_number,
      supplier.name,
      supplier.status,
      supplier.business_partner_groups_id?.name,
    ]
    return searchableValues.some(
      (value) => value && String(value).toLowerCase().includes(term),
    )
  })
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(tableRef, computed(() => filteredSuppliers.value.length))

const sortFieldRef = computed(() => filterStore.sortField)
const sortOrderRef = computed(() => filterStore.sortOrder)

const { hasCachedState, saveBeforeLeave, restoreScrollPosition } =
  useTableStateRestore('/suppliers', {
    rows: suppliers,
    currentPage,
    hasMore,
    totalRecords,
    sortField: sortFieldRef,
    sortOrder: sortOrderRef,
    isLoading,
  }, tableRef)

watch(
  () => searchStore.searchQuery,
  async (query) => {
    tableStateStore.clearTableState('/suppliers')
    currentPage.value = 1
    hasMore.value = true
    // Only redirect on user-initiated searches, not on mount/restore
    if (!isInitialMount) {
      if (query && await redirectIfExactKey(query)) {
        return
      }
      if (query && await redirectIfCrossScopeMatch(query)) {
        return
      }
    }
    loadSuppliers(1, query)
    prefetchTail()
  },
)

watch(
  [
    () => filterStore.selectedStatuses,
    () => filterStore.selectedBusinessPartnerGroupIds,
    () => filterStore.selectedManufacturerIds,
  ],
  () => {
    tableStateStore.clearTableState('/suppliers')
    currentPage.value = 1
    hasMore.value = true
    loadSuppliers(1, searchStore.searchQuery)
    prefetchTail()
  },
  { deep: true },
)

// "New" means different things depending on what the user may do. With create
// rights on *suppliers* it opens the create form; without them, creating a
// supplier is an operations-team action, so it opens the same request form the
// manufacturer page uses — rather than a create screen Directus would 403.
//
// The right to create a supplier is asked for by name: a policy can grant
// `business_partners` create and still cap it at `relationship_type = customer`,
// which is exactly what CONNECT Internal Sales does.
const { loadBusinessPartnerCreateRights, canCreateBusinessPartner } = usePermissions()
const requestNewSupplierVisible = ref(false)

async function handleNewSupplier() {
  // Awaited rather than read off a warm cache: a click that lands before the
  // rights arrive must still branch correctly, not fall through to the request
  // form.
  await loadBusinessPartnerCreateRights()

  if (canCreateBusinessPartner('supplier')) {
    navigateTo('/suppliers/create')
    return
  }
  requestNewSupplierVisible.value = true
}

onMounted(() => {
  // Warm the rights so the button reacts instantly on click.
  loadBusinessPartnerCreateRights()
  filterStore.ensureBusinessPartnerGroupsLoaded()
  filterStore.ensureManufacturersLoaded()

  if (!hasCachedState.value) {
    loadSuppliers(1, searchStore.searchQuery)
  }
  // Warm the tail regardless of head cache state (it self-skips when already
  // warm), so returning to the list also refreshes a stale/expired tail.
  prefetchTail()

  const container = tableRef.value?.$el?.querySelector('.p-virtualscroller')
    || tableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.addEventListener('scroll', handleScroll)
  }

  if (hasCachedState.value) {
    restoreScrollPosition()
  }

  isInitialMount = false
})

onBeforeRouteLeave(() => {
  saveBeforeLeave()
})

onUnmounted(() => {
  const container = tableRef.value?.$el?.querySelector('.p-virtualscroller')
    || tableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.removeEventListener('scroll', handleScroll)
  }
})
</script>

<template>
  <div class="suppliers-page">
    <div
      v-if="!hasLoadError"
      class="suppliers-page__header"
    >
      <h1 class="suppliers-page__title">Suppliers</h1>
      <BaseFilterChips
        :chips="activeFilterChips"
        class="suppliers-page__chips-row"
      />
      <div class="suppliers-page__header-actions">
        <SuppliersToolbar />
        <Button
          label="New"
          icon="pi pi-plus"
          size="small"
          @click="handleNewSupplier"
        />
      </div>
    </div>

    <Error500 v-if="hasLoadError" />

    <div
      v-else
      class="suppliers-card"
    >
      <DataTable
        ref="tableRef"
        class="suppliers-table is-row-clickable"
        :value="filteredSuppliers"
        data-key="id"
        lazy
        removable-sort
        scrollable
        scroll-height="max(calc(100dvh - var(--list-table-offset, 230px)), 218px)"
        :table-style="{ minWidth: '100%' }"
        :virtual-scroller-options="{ itemSize: 46 }"
        :sort-field="filterStore.sortField"
        :sort-order="filterStore.sortOrder"
        row-hover
        :row-class="rowClass"
        @sort="handleSort"
        @row-click="handleRowClick"
        @row-contextmenu="handleRowContextMenu"
      >
        <Column
          field="account_number"
          header="Account"
          sortable
          style="width: clamp(140px, 11vw, 150px); min-width: 140px"
        >
          <template #body="{data: supplier}">
            <div
              v-if="supplier._skeleton"
              class="skeleton-block"
            />
            <BaseCopyText
              v-else
              :value="supplier.account_number"
              label-color="var(--p-gray-800)"
            />
          </template>
        </Column>

        <Column
          field="name"
          header="Company Name"
          sortable
          style="width: 350px; min-width: 350px"
        >
          <template #body="{data: supplier}">
            <div
              v-if="supplier._skeleton"
              class="skeleton-block"
            />
            <span
              v-else
              class="company-name-cell"
            >
              <BaseWebsiteLink
                :website="supplier.website"
                :name="supplier.name"
              />
              <span class="company-name-cell__text">{{ supplier.name }}</span>
            </span>
          </template>
        </Column>

        <Column
          field="status"
          header="Status"
          sortable
          style="min-width: 200px"
        >
          <template #body="{data: supplier}">
            <div
              v-if="supplier._skeleton"
              class="skeleton-block"
            />
            <Tag
              v-else
              :value="formatStatus(supplier.status)"
              :class="
                supplier.status === 'active'
                  ? 'status-active'
                  : 'status-inactive'
              "
            />
          </template>
        </Column>

        <Column
          field="business_partner_groups_id.name"
          header="Supplier Group"
          sortable
          style="min-width: 200px"
        >
          <template #body="{data: supplier}">
            <div
              v-if="supplier._skeleton"
              class="skeleton-block"
            />
            <template v-else>
              {{ supplier.business_partner_groups_id?.name ?? '' }}
            </template>
          </template>
        </Column>

        <Column
          header="Manufacturers"
          sortable
          sort-field="count(manufacturers)"
          style="min-width: 200px"
        >
          <template #body="{data: supplier}">
            <div
              v-if="supplier._skeleton"
              class="skeleton-block"
            />
            <Button
              v-else-if="getManufacturerCount(supplier) > 0"
              text
              class="manufacturers-btn"
              @click.stop="openManufacturersDrawer(supplier)"
            >
              <span class="manufacturers-btn__count">
                {{ getManufacturerCount(supplier) }}
                {{ getManufacturerCount(supplier) === 1 ? 'manufacturer' : 'manufacturers' }}
              </span>
              <i class="pi pi-ellipsis-h manufacturers-btn__icon" />
            </Button>
            <span
              v-else
              class="manufacturers-cell--empty"
            >
              0 manufacturers
            </span>
          </template>
        </Column>

        <!-- Row itself opens the supplier (clickable row); the frozen column
             remains for horizontal scroll navigation only. -->
        <BaseFrozenColumn
          key="frozen"
          scrollable-only
          :table-ref="tableRef"
          :actions="[]"
        />
        <template #footer>
          <BaseDataTableFooterLoader
            :loading="isLoadingMore"
            :first-row="firstVisibleRow"
            :last-row="lastVisibleRow"
            :total-records="totalRecords"
            :show-shadow="showFooterShadow"
            :filter-text="searchStore.filterText"
            empty-msg="No results found"
            page-label="suppliers"
          />
        </template>
      </DataTable>
      <ContextMenu
        ref="contextMenuRef"
        :model="contextMenuItems"
      />
    </div>

    <DrawerManufacturerAssociations
      v-model:visible="manufacturerDrawerVisible"
      mode="manufacturers"
      :items="manufacturerDrawerItems"
      :loading="manufacturerDrawerLoading"
      :skeleton-count="manufacturerDrawerSkeletonCount"
      @save="handleManufacturerSave"
      @reorder="handleManufacturerReorder"
    />

    <!-- Shown instead of the create form to users without create rights on
         business_partners — no manufacturer context here, so the request reads
         "… be added as a new supplier." -->
    <DrawerRequestNewCompany
      v-model:visible="requestNewSupplierVisible"
      mode="supplier"
    />
  </div>
</template>

<style scoped>
.suppliers-page {
    --list-table-offset: 260px;

    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: 0;
    margin-bottom: calc(-1 * var(--p-spacing-4));

    @media (min-width: 768px) {
        --list-table-offset: 230px;
    }
}

.suppliers-page__header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
        "title actions"
        "chips chips";
    column-gap: clamp(var(--p-spacing-2), 2vw, var(--p-spacing-4));
    row-gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
    align-items: center;

    @media (min-width: 768px) {
        grid-template-columns: auto minmax(0, 1fr) auto;
        grid-template-areas: "title chips actions";
    }
}

.suppliers-page__title {
    grid-area: title;
}

.suppliers-page__chips-row {
    grid-area: chips;
}

.suppliers-page__header-actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
}

h1 {
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-spacing-8);
    margin: 0;
}

/* "N manufacturers ⋯" — opens the per-supplier flyout. Mirrors the customers
   list "Contacts" cell: skyblue link text (Figma text/accent) that becomes a
   compact bordered pill (tideblue-50 fill, skyblue-200 border, 2px radius) on
   hover. A transparent 1px border is reserved at rest so the label never shifts. */
:deep(.manufacturers-btn.p-button) {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
    width: fit-content;
    height: auto;
    padding: 0 0 0 var(--p-spacing-2);
    color: var(--p-primary-500);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-5);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--p-border-radius-xs);
}

:deep(.manufacturers-btn.p-button:hover) {
    background: var(--p-tideblue-50);
    border-color: var(--p-skyblue-200);
}

.manufacturers-btn__count {
    white-space: nowrap;
}

/* Ellipsis toggle — 24px circular footprint mirroring the Figma node-toggle. */
.manufacturers-btn__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-6);
    height: var(--p-spacing-6);
    border-radius: var(--p-border-radius-full);
    font-size: var(--p-font-size-sm);
}

/* Empty cell: left inset matches the pill's text so "0 manufacturers" lines up
   with the populated rows. */
.manufacturers-cell--empty {
    display: block;
    padding-left: var(--p-spacing-2);
    color: var(--p-text-muted-color);
}

/* Supplier row whose manufacturers drawer is open — the same deepblue-50 fill as
   the clickable-row hover (readable through the drawer backdrop) plus a deepblue-900
   left accent bar on the leading cell that marks which row owns the drawer. */
:deep(.suppliers-table .suppliers-table__row--active-drawer > td) {
    background-color: var(--p-deepblue-50) !important;
}

:deep(.suppliers-table .suppliers-table__row--active-drawer > td:first-child) {
    box-shadow: inset var(--p-spacing-1) 0 0 0 var(--p-deepblue-900);
}

.suppliers-card {
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-sm);
    overflow: hidden;
    padding: var(--p-spacing-4);
}
</style>
