<script setup lang="ts">
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'
import type { ManufacturerSupplier, ManufacturerCompetitor } from '~/composables/useManufacturers'

useHead({ title: 'Manufacturers' })

const tableRef = ref(null)
const { showFooterShadow } = useTableFooterShadow(tableRef)

const searchStore = useSearchStore()
const tableStateStore = useTableStateStore()
const { handleNoResults } = useScopeResultsSearch()
const { getResponsiveUrl } = useAssetUrl()
const { redirectIfCrossScopeMatch } = useCrossScopeExactMatch()
let isInitialMount = true

const manufacturers = ref<Record<string, any>[]>([])
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

const DEFAULT_SORT_FIELD = 'name'
const DEFAULT_SORT_ORDER = 1
const sortField = ref(DEFAULT_SORT_FIELD)
const sortOrder = ref(DEFAULT_SORT_ORDER)

useUrlSyncedListState({
  sort: {
    get: () => ({ field: sortField.value, order: sortOrder.value }),
    set: ({ field, order }: { field: string; order: number }) => {
      sortField.value = field || DEFAULT_SORT_FIELD
      sortOrder.value = field ? order : DEFAULT_SORT_ORDER
    },
    defaultValue: { field: DEFAULT_SORT_FIELD, order: DEFAULT_SORT_ORDER },
    parse: (raw) => {
      if (!raw) return undefined
      if (raw.startsWith('-')) return { field: raw.slice(1), order: -1 }
      return { field: raw, order: 1 }
    },
    serialize: ({ field, order }) => {
      if (!field) return null
      if (field === DEFAULT_SORT_FIELD && order === DEFAULT_SORT_ORDER) return null
      return order === -1 ? `-${field}` : field
    },
  },
})

function buildSortParam() {
  if (!sortField.value) { return null }
  const prefix = sortOrder.value === -1 ? '-' : ''
  return [`${prefix}${sortField.value}`]
}

function handleSort(event: any) {
  sortField.value = event.sortField ?? DEFAULT_SORT_FIELD
  sortOrder.value = event.sortField ? event.sortOrder : DEFAULT_SORT_ORDER
  currentPage.value = 1
  hasMore.value = true
  loadManufacturers(1, searchStore.searchQuery)
}

// `count(...)` function-fields return the supplier/competitor association counts
// in the same query — no per-row round-trips.
const MANUFACTURER_LIST_FIELDS = [
  'id',
  'name',
  'logo_id',
  'website',
  'count(business_partners)',
  'count(competitors)',
]

const {
  fetchManufacturers,
  fetchManufacturerCount,
  fetchManufacturerSuppliers,
  fetchManufacturerCompetitors,
  updateManufacturerSupplier,
} = useManufacturers()
const toast = useToast()

// Association flyouts (Suppliers / Competitors), loaded lazily on open.
const suppliersDrawerVisible = ref(false)
const competitorsDrawerVisible = ref(false)
const drawerLoading = ref(false)
const activeSuppliers = ref<ManufacturerSupplier[]>([])
const activeCompetitors = ref<ManufacturerCompetitor[]>([])
const activeSupplierCount = ref(0)
const activeCompetitorCount = ref(0)
// The manufacturer whose suppliers/competitors drawer is open — drives the
// active-row tint (mirrors the Customers list). Gated by the drawer-visible
// flags in rowClass, so it need not be cleared on close.
const activeManufacturerId = ref<number | string | null>(null)

async function openSuppliersDrawer(manufacturer: Record<string, any>) {
  activeSuppliers.value = []
  activeSupplierCount.value = manufacturer._supplierCount || 0
  activeManufacturerId.value = manufacturer.id
  drawerLoading.value = true
  suppliersDrawerVisible.value = true
  const { data, error } = await fetchManufacturerSuppliers(manufacturer.id)
  if (!error && data) { activeSuppliers.value = data }
  drawerLoading.value = false
}

// Persist status / remarks edits made in the suppliers drawer, then reflect them
// in the open list so the card updates without a refetch.
async function handleSupplierSave(payload: { junctionId: number | string, status?: string, remarks?: string | null }) {
  const { junctionId, ...changes } = payload
  const { error } = await updateManufacturerSupplier(junctionId, changes)
  if (error) {
    toast.add({ severity: 'error', summary: 'Failed', detail: 'Could not save supplier changes.', life: 5000 })
    return
  }
  const target = activeSuppliers.value.find((supplier) => supplier.junctionId === junctionId)
  if (target) {
    if (changes.status !== undefined) { target.status = changes.status }
    if (changes.remarks !== undefined) { target.remarks = changes.remarks }
  }
  toast.add({ severity: 'success', summary: 'Saved', detail: 'Supplier updated.', life: 3000 })
}

// "New" opens the request form rather than a create screen — manufacturers, like
// suppliers, are created by the operations team, so the form emails them the
// details (via the same CONNECT New Supplier Request flow).
const requestNewManufacturerVisible = ref(false)

function openRequestNewManufacturer() {
  requestNewManufacturerVisible.value = true
}

async function openCompetitorsDrawer(manufacturer: Record<string, any>) {
  activeCompetitors.value = []
  activeCompetitorCount.value = manufacturer._competitorCount || 0
  activeManufacturerId.value = manufacturer.id
  drawerLoading.value = true
  competitorsDrawerVisible.value = true
  const { data, error } = await fetchManufacturerCompetitors(manufacturer.id)
  if (!error && data) { activeCompetitors.value = data }
  drawerLoading.value = false
}

function rowClass(rowData: Record<string, any>): string {
  if (rowData._skeleton) { return 'skeleton-row' }
  if ((suppliersDrawerVisible.value || competitorsDrawerVisible.value)
    && activeManufacturerId.value != null
    && rowData.id === activeManufacturerId.value) {
    return 'manufacturers-table__row--active-drawer'
  }
  return ''
}

let loadRequestId = 0
let tailRequestId = 0

async function loadManufacturers(page = 1, search: string | null = null) {
  const currentRequestId = ++loadRequestId
  const searchTerm = search || null

  if (page === 1) {
    isLoading.value = true
    hasLoadError.value = false
    manufacturers.value = []
  } else {
    isLoadingMore.value = true
  }

  const [listResult, countResult] = await Promise.all([
    fetchManufacturers({
      fields: MANUFACTURER_LIST_FIELDS,
      limit: rowsPerPage,
      page,
      search: searchTerm,
      sort: buildSortParam(),
    }),
    page === 1
      ? fetchManufacturerCount(null, searchTerm)
      : Promise.resolve(null),
  ])

  if (currentRequestId !== loadRequestId) {
    return
  }

  if (!listResult.error) {
    const pageManufacturers = listResult.data as Record<string, any>[]

    // Directus returns the function-field counts as strings — normalize.
    for (const mfr of pageManufacturers) {
      mfr._supplierCount = Number(mfr.business_partners_count) || 0
      mfr._competitorCount = Number(mfr.competitors_count) || 0
    }

    await Promise.all(pageManufacturers.map(async (mfr) => {
      const responsive = await getResponsiveUrl(mfr.logo_id, 84, 56)
      mfr._logoSrc = responsive?.src ?? null
      mfr._logoSrcset = responsive?.srcset ?? null
    }))

    if (page === 1) {
      manufacturers.value = pageManufacturers
    } else {
      manufacturers.value = [
        ...manufacturers.value,
        ...pageManufacturers,
      ]
    }
    hasMore.value = pageManufacturers.length === rowsPerPage
  } else if (page === 1 && isServerError(listResult.error)) {
    hasLoadError.value = true
  }
  if (countResult && !countResult.error) {
    totalRecords.value = countResult.data
  }

  isLoading.value = false
  isLoadingMore.value = false
  currentPage.value = page
  searchStore.setResultCount(manufacturers.value.length)

  if (page === 1 && !hasLoadError.value && manufacturers.value.length === 0 && searchStore.searchQuery) {
    handleNoResults('manufacturers', searchStore.searchQuery)
  }
}

// Pre-warm the navigation TAIL in the background: the last manufacturers of the
// sequence, fetched once under the reversed sort (id only) and stashed in
// tableState. The manufacturer detail page seeds its tail segment from this, so
// Previous on the first manufacturer — the wrap to the LAST — is instant. The
// nav always sequences manufacturers by name asc (independent of the list's
// display sort), so the tail is fetched and stored under that same name/asc
// order. Skipped when a matching tail is already warm.
async function prefetchTail() {
  const currentTailRequestId = ++tailRequestId
  const search = searchStore.searchQuery || ''

  const existing = tableStateStore.getTailState('/manufacturers')
  if (existing
    && existing.searchQuery === search
    && existing.sortField === DEFAULT_SORT_FIELD
    && existing.sortOrder === DEFAULT_SORT_ORDER) {
    return
  }

  const { data, error } = await fetchManufacturers({
    fields: ['id', 'name'],
    // Mirror the nav store's sort (buildManufacturersSort('name', 1)).
    sort: reverseSort([DEFAULT_SORT_FIELD, 'id']),
    search: search || null,
    limit: TAIL_PREFETCH_SIZE,
    page: 1,
  })
  // Discard if a newer prefetch (search change) superseded this one.
  if (currentTailRequestId !== tailRequestId || error || !data) { return }

  // Fetched descending; store forward order so the nav store uses it directly.
  tableStateStore.saveTailState('/manufacturers', {
    rows: [...data].reverse(),
    reachedStart: data.length < TAIL_PREFETCH_SIZE,
    sortField: DEFAULT_SORT_FIELD,
    sortOrder: DEFAULT_SORT_ORDER,
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
    loadManufacturers(currentPage.value + 1, searchStore.searchQuery)
  }
}

const {
  handleRowClick,
  handleRowContextMenu,
  contextMenuRef,
  contextMenuItems,
} = useRowNavigation((rowData) => `/manufacturers/${rowData.id}`)


const filteredManufacturers = computed(() => {
  if (showLoader.value) {return skeletonRows}
  const term = searchStore.filterText.toLowerCase()
  if (!term) {
    return manufacturers.value
  }

  return manufacturers.value.filter((manufacturer) => {
    const searchableValues = [
      manufacturer.name,
      `${manufacturer._supplierCount ?? ''}`,
      `${manufacturer._competitorCount ?? ''}`,
    ]
    return searchableValues.some(
      (value) => value && String(value).toLowerCase().includes(term),
    )
  })
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(tableRef, computed(() => filteredManufacturers.value.length), 77)

const { hasCachedState, saveBeforeLeave, restoreScrollPosition } =
  useTableStateRestore('/manufacturers', {
    rows: manufacturers,
    currentPage,
    hasMore,
    totalRecords,
    sortField,
    sortOrder,
    isLoading,
  }, tableRef)

watch(
  () => searchStore.searchQuery,
  async (query) => {
    tableStateStore.clearTableState('/manufacturers')
    currentPage.value = 1
    hasMore.value = true
    if (!isInitialMount && query && await redirectIfCrossScopeMatch(query)) {
      return
    }
    loadManufacturers(1, query)
    prefetchTail()
  },
)

onMounted(() => {
  if (!hasCachedState.value) {
    loadManufacturers(1, searchStore.searchQuery)
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
  <div class="manufacturers-page">
    <div
      v-if="!hasLoadError"
      class="manufacturers-page__header"
    >
      <h1>Manufacturers</h1>
      <Button
        label="New"
        icon="pi pi-plus"
        size="small"
        @click="openRequestNewManufacturer"
      />
    </div>

    <Error500 v-if="hasLoadError" />

    <div
      v-else
      class="manufacturers-card"
    >
      <DataTable
        ref="tableRef"
        class="manufacturers-table is-row-clickable"
        :value="filteredManufacturers"
        data-key="id"
        lazy
        removable-sort
        scrollable
        scroll-height="max(calc(100dvh - 230px), 275px)"
        :virtual-scroller-options="{ itemSize: 77 }"
        row-hover
        :sort-field="sortField"
        :sort-order="sortOrder"
        :row-class="rowClass"
        @sort="handleSort"
        @row-click="handleRowClick"
        @row-contextmenu="handleRowContextMenu"
      >
        <Column
          field="name"
          header="Name"
          sortable
          style="width: 420px; min-width: 260px"
        >
          <template #body="{data: manufacturer}">
            <div
              v-if="manufacturer._skeleton"
              class="skeleton-block"
            />
            <div
              v-else
              class="manufacturer-name"
            >
              <div
                class="placeholder-thumb manufacturer-name__thumbnail"
                :class="{ 'placeholder-thumb--empty': !manufacturer._logoSrc }"
              >
                <img
                  v-if="manufacturer._logoSrc"
                  :src="manufacturer._logoSrc"
                  :srcset="manufacturer._logoSrcset"
                  sizes="84px"
                  alt=""
                  class="manufacturer-name__image"
                  width="84"
                  height="84"
                  loading="lazy"
                />
                <BasePlaceholderIcon
                  v-else
                  category="manufacturer"
                  class="placeholder-thumb__icon manufacturer-name__placeholder"
                />
              </div>

              <span class="company-name-cell">
                <BaseWebsiteLink
                  :website="manufacturer.website"
                  :name="manufacturer.name"
                />
                <span class="company-name-cell__text">{{ manufacturer.name }}</span>
              </span>
            </div>
          </template>
        </Column>

        <Column
          field="count(business_partners)"
          header="Suppliers"
          sortable
          style="width: 250px; min-width: 150px"
        >
          <template #body="{data: manufacturer}">
            <div
              v-if="manufacturer._skeleton"
              class="skeleton-block"
            />
            <Button
              v-else-if="manufacturer._supplierCount"
              text
              class="mfr-count-btn"
              @click.stop="openSuppliersDrawer(manufacturer)"
            >
              <span class="mfr-count-btn__count">
                {{ manufacturer._supplierCount.toLocaleString() }} {{ manufacturer._supplierCount === 1 ? 'supplier' : 'suppliers' }}
              </span>
              <i class="pi pi-ellipsis-h mfr-count-btn__icon" />
            </Button>
            <span
              v-else
              class="mfr-count-empty"
            >0 suppliers</span>
          </template>
        </Column>

        <Column
          field="count(competitors)"
          header="Competitors"
          sortable
          style="min-width: 150px"
        >
          <template #body="{data: manufacturer}">
            <div
              v-if="manufacturer._skeleton"
              class="skeleton-block"
            />
            <Button
              v-else-if="manufacturer._competitorCount"
              text
              class="mfr-count-btn"
              @click.stop="openCompetitorsDrawer(manufacturer)"
            >
              <span class="mfr-count-btn__count">
                {{ manufacturer._competitorCount.toLocaleString() }} {{ manufacturer._competitorCount === 1 ? 'competitor' : 'competitors' }}
              </span>
              <i class="pi pi-ellipsis-h mfr-count-btn__icon" />
            </Button>
            <span
              v-else
              class="mfr-count-empty"
            >0 competitors</span>
          </template>
        </Column>

        <!-- Row itself opens the manufacturer (clickable row); the frozen column
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
            page-label="manufacturers"
          />
        </template>
      </DataTable>
      <ContextMenu
        ref="contextMenuRef"
        :model="contextMenuItems"
      />
    </div>

    <DrawerManufacturerAssociations
      v-model:visible="suppliersDrawerVisible"
      mode="suppliers"
      :items="activeSuppliers"
      :loading="drawerLoading"
      :skeleton-count="activeSupplierCount"
      @save="handleSupplierSave"
    />
    <DrawerManufacturerAssociations
      v-model:visible="competitorsDrawerVisible"
      mode="competitors"
      :items="activeCompetitors"
      :loading="drawerLoading"
      :skeleton-count="activeCompetitorCount"
    />
    <DrawerRequestNewCompany
      v-model:visible="requestNewManufacturerVisible"
      mode="manufacturer"
    />
  </div>
</template>

<style scoped>
.manufacturers-page {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: 0;
    margin-bottom: calc(-1 * var(--p-spacing-4));
}

.manufacturers-page__header {
    display: flex;
    place-content: space-between;
}

h1 {
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-spacing-8);
    margin: 0;
}

.manufacturers-card {
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-sm);
    overflow: hidden;
    padding: var(--p-spacing-4);
}

/* Name column — thumbnail + text */
.manufacturer-name {
    display: flex;
    align-items: center;
    /* Matches .company-name-cell gap so the globe icon sits with equal
       space on both sides (thumbnail ↔ globe ↔ name). */
    gap: var(--p-spacing-1);
    /* Allow the name to shrink and truncate within the fixed-width column
       (ellipsis handled by the shared .company-name-cell__text). */
    min-width: 0;
}

/* Same plate as the in-page table thumbs (.placeholder-thumb), just wider — this
   is the list's primary column, so the logo gets more room than a 5:4 chip. */
.manufacturer-name__thumbnail {
    width: calc(var(--p-spacing-px) * 84);
    height: calc(var(--p-spacing-px) * 56);
    aspect-ratio: auto;
}

.manufacturer-name__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

/* Scaled up from the shared 16px to suit the larger plate. */
.manufacturer-name__placeholder {
    width: var(--p-spacing-6);
    height: var(--p-spacing-6);
    font-size: var(--p-spacing-6);
}

/* Suppliers / Competitors count cells — skyblue link text that becomes a compact
   bordered pill (tideblue-50 fill, skyblue-200 border, 2px radius) on hover,
   opening the association flyout. Mirrors the Customers "Contacts" cell. A
   transparent 1px border is reserved at rest so the label never shifts. */
:deep(.mfr-count-btn.p-button) {
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

:deep(.mfr-count-btn.p-button:hover) {
    background: var(--p-tideblue-50);
    border-color: var(--p-skyblue-200);
}

.mfr-count-btn__count {
    white-space: nowrap;
}

/* Ellipsis toggle — 24px circular footprint mirroring the Figma node-toggle. */
.mfr-count-btn__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-6);
    height: var(--p-spacing-6);
    border-radius: var(--p-border-radius-full);
    font-size: var(--p-font-size-sm);
}

/* Zero counts: plain, non-interactive text — left inset matches the pill's text
   so it lines up with the button-rendered counts above/below it. */
.mfr-count-empty {
    display: inline-block;
    padding-left: var(--p-spacing-2);
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

/* Manufacturer row whose suppliers/competitors drawer is open — the same
   deepblue-50 fill as the clickable-row hover (readable through the drawer
   backdrop) plus a deepblue-900 left accent bar marking which row owns the
   drawer. Mirrors the Customers / Suppliers lists. */
:deep(.manufacturers-table .manufacturers-table__row--active-drawer > td) {
    background-color: var(--p-deepblue-50) !important;
}

:deep(.manufacturers-table .manufacturers-table__row--active-drawer > td:first-child) {
    box-shadow: inset var(--p-spacing-1) 0 0 0 var(--p-deepblue-900);
}

/* Consistent row height for virtual scroller */
:deep(.p-datatable-tbody > tr > td) {
    height: 77px;
}

:deep(.skeleton-row td .skeleton-block) {
    height: var(--p-spacing-16);
}

.account-link {
    color: var(--p-gray-500);
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}
</style>
