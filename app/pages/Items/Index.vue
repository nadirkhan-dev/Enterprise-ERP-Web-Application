<script setup lang="ts">
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'
import { useItemsFilterStore } from '~/stores/itemsFilter'

useHead({ title: 'Items' })

const tableRef = ref(null)
const { showFooterShadow } = useTableFooterShadow(tableRef)

const searchStore = useSearchStore()
const tableStateStore = useTableStateStore()
const filterStore = useItemsFilterStore()
const { handleNoResults } = useScopeResultsSearch()

if (useNuxtApp().isHydrating) {
  tableStateStore.clearTableState('/items')
}

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
  // The "special-order only" filter maps to the Directus column `is_standard_sku`
  // (false = special-order item), so the URL carries the real column name and
  // value — `?is_standard_sku=false` — instead of a synthetic key.
  is_standard_sku: {
    get: () => filterStore.isSpecialOrderOnly,
    set: (value: boolean) => filterStore.setSpecialOrderOnly(value),
    defaultValue: false,
    parse: (raw) => raw === 'false' || raw === '0',
    serialize: (value: boolean) => (value ? 'false' : null),
  },
  sort: {
    get: () => ({ field: filterStore.sortField, order: filterStore.sortOrder }),
    set: ({ field, order }: { field: string; order: number }) => filterStore.setSort(field, order),
    defaultValue: { field: 'sku', order: 1 },
    parse: (raw) => {
      if (!raw) return undefined
      if (raw.startsWith('-')) return { field: raw.slice(1), order: -1 }
      return { field: raw, order: 1 }
    },
    serialize: ({ field, order }) => {
      if (!field) return null
      if (field === 'sku' && order === 1) return null
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

  if (filterStore.isSpecialOrderOnly) {
    chips.push({
      key: 'special-order',
      label: 'Special Order SKU',
      remove: () => filterStore.setSpecialOrderOnly(false),
    })
  }

  return chips
})

const items = ref<Record<string, any>[]>([])
const totalRecords = ref(0)
const isLoading = ref(true)
const hasLoadError = ref(false)
const specialSkuDrawerVisible = ref(false)
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
  loadItems(1, searchStore.searchQuery)
}

function buildFilterParam(): Record<string, unknown> | null {
  const conditions: Record<string, unknown>[] = []
  if (filterStore.selectedStatuses.length) {
    conditions.push({ status: { _in: [...filterStore.selectedStatuses] } })
  }
  if (filterStore.selectedManufacturerIds.length) {
    conditions.push({ manufacturers_id: { _in: [...filterStore.selectedManufacturerIds] } })
  }
  // Special Order SKU acts as a boolean toggle:
  //   unchecked (default) → exclude special-order items (is_standard_sku = true)
  //   checked             → only special-order items   (is_standard_sku = false)
  conditions.push({ is_standard_sku: { _eq: !filterStore.isSpecialOrderOnly } })
  return conditions.length ? { _and: conditions } : null
}

const ITEM_LIST_FIELDS = [
  'id',
  'sku',
  'status',
  'mpn',
  'description',
  'manufacturers_id.id',
  'manufacturers_id.name',
]

const { fetchItems, fetchItemCount, fetchItemBySku } = useItems()

// Exact SKU searches bypass filters and jump straight to the item's detail
// page so active filters can never hide an exact match.
const { redirectIfExactKey } = useExactKeySearch(async (term) => {
  const { data, error } = await fetchItemBySku(term)
  if (error || !data) {
    return null
  }
  return `/items/${data.sku}`
})

// Cross-entity exact match: if search term is an exact key for a different
// entity type (e.g., Customer SAP ID while on Items list), redirect there.
const { redirectIfCrossScopeMatch } = useCrossScopeExactMatch()

let loadRequestId = 0
let tailRequestId = 0
let isInitialMount = true

async function loadItems(page = 1, search: string | null = null) {
  const currentRequestId = ++loadRequestId
  const searchTerm = search || null

  if (page === 1) {
    isLoading.value = true
    hasLoadError.value = false
    items.value = []
  } else {
    isLoadingMore.value = true
  }

  // An exact SKU search takes precedence over active filters so the matching
  // item is never filtered out of the results.
  const bypassFilters = !!searchTerm && isExactKeySearch(searchTerm)
  const filter = bypassFilters ? null : buildFilterParam()

  const [listResult, countResult] = await Promise.all([
    fetchItems({
      fields: ITEM_LIST_FIELDS,
      limit: rowsPerPage,
      page,
      search: searchTerm,
      sort: buildSortParam(),
      filter,
    }),
    page === 1 ? fetchItemCount(filter, searchTerm) : Promise.resolve(null),
  ])

  if (currentRequestId !== loadRequestId) {return}

  if (!listResult.error) {
    if (page === 1) {
      items.value = listResult.data
    } else {
      items.value = [...items.value, ...listResult.data]
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
  searchStore.setResultCount(items.value.length)

  if (page === 1 && !hasLoadError.value && items.value.length === 0 && searchStore.searchQuery) {
    handleNoResults('items', searchStore.searchQuery)
  }
}

// Pre-warm the navigation TAIL in the background: the last rows of the current
// filtered/sorted sequence, fetched once under the reversed sort (sku only) and
// stashed in tableState. The item detail page seeds its tail segment from this,
// so Previous on the first item — the wrap to the LAST item — is instant instead
// of waiting on a round-trip. Skipped when a matching tail is already warm, or
// for an exact-key search (which redirects straight to detail).
async function prefetchTail() {
  const currentTailRequestId = ++tailRequestId
  const searchTerm = searchStore.searchQuery || null
  if (searchTerm && isExactKeySearch(searchTerm)) { return }

  const search = searchStore.searchQuery || ''
  const sortField = filterStore.sortField
  const sortOrder = filterStore.sortOrder

  const existing = tableStateStore.getTailState('/items')
  if (existing
    && existing.searchQuery === search
    && existing.sortField === sortField
    && existing.sortOrder === sortOrder) {
    return
  }

  // Match the nav store's tail sort (buildItemsSort): primary + `sku` tiebreaker.
  const field = sortField || 'sku'
  const primary = sortOrder === -1 ? `-${field}` : field
  const forwardSort = field === 'sku' ? [primary] : [primary, 'sku']

  const { data, error } = await fetchItems({
    fields: ['sku', 'description'],
    sort: reverseSort(forwardSort),
    filter: buildFilterParam(),
    search: searchTerm,
    limit: TAIL_PREFETCH_SIZE,
    page: 1,
  })
  // Discard if a newer prefetch (filter/sort/search change) superseded this one.
  if (currentTailRequestId !== tailRequestId || error || !data) { return }

  // Fetched descending; store forward order so the nav store uses it directly.
  tableStateStore.saveTailState('/items', {
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
    loadItems(currentPage.value + 1, searchStore.searchQuery)
  }
}

const {
  handleRowClick,
  handleRowContextMenu,
  contextMenuRef,
  contextMenuItems,
} = useRowNavigation((rowData) => `/items/${rowData.sku}`)

const filteredItems = computed(() => {
  if (showLoader.value) {return skeletonRows}
  const term = searchStore.filterText.toLowerCase()
  if (!term) {
    return items.value
  }

  return items.value.filter((item) => {
    const searchableValues = [
      item.sku,
      item.status,
      item.mpn,
      item.description,
      item.manufacturers_id?.name,
    ]
    return searchableValues.some(
      (value) => value && String(value).toLowerCase().includes(term),
    )
  })
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(tableRef, computed(() => filteredItems.value.length))

const sortFieldRef = computed(() => filterStore.sortField)
const sortOrderRef = computed(() => filterStore.sortOrder)

const { hasCachedState, saveBeforeLeave, restoreScrollPosition } =
  useTableStateRestore('/items', {
    rows: items,
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
    tableStateStore.clearTableState('/items')
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
    loadItems(1, query)
    prefetchTail()
  },
)

watch(
  [
    () => filterStore.selectedStatuses,
    () => filterStore.selectedManufacturerIds,
    () => filterStore.isSpecialOrderOnly,
  ],
  () => {
    tableStateStore.clearTableState('/items')
    currentPage.value = 1
    hasMore.value = true
    loadItems(1, searchStore.searchQuery)
    prefetchTail()
  },
  { deep: true },
)

onMounted(() => {
  filterStore.ensureManufacturersLoaded()

  if (!hasCachedState.value) {
    loadItems(1, searchStore.searchQuery)
  }
  // Warm the tail regardless of head cache state (it self-skips when already
  // warm), so returning to the list also refreshes a stale/expired tail.
  prefetchTail()

  const container = tableRef.value?.$el?.querySelector('.p-virtualscroller')
    || tableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {container.addEventListener('scroll', handleScroll)}

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
  if (container) {container.removeEventListener('scroll', handleScroll)}
})
</script>

<template>
  <div class="items-page">
    <div
      v-if="!hasLoadError"
      class="items-page__header"
    >
      <h1 class="items-page__title">Items</h1>
      <BaseFilterChips
        :chips="activeFilterChips"
        class="items-page__chips-row"
      />
      <div class="items-page__header-actions">
        <ItemsToolbar />
        <Button
          label="Special Order SKU"
          icon="pi pi-search"
          size="small"
          class="items-page__special-sku-btn"
          @click="specialSkuDrawerVisible = true"
        />
      </div>
    </div>

    <Error500 v-if="hasLoadError" />

    <div
      v-else
      class="items-card"
    >
      <DataTable
        ref="tableRef"
        class="items-table is-row-clickable"
        :value="filteredItems"
        data-key="id"
        lazy
        removable-sort
        scrollable
        scroll-height="max(calc(100dvh - var(--list-table-offset, 230px)), 218px)"
        :virtual-scroller-options="{ itemSize: 46 }"
        :sort-field="filterStore.sortField"
        :sort-order="filterStore.sortOrder"
        row-hover
        :row-class="(rowData) => rowData._skeleton ? 'skeleton-row' : ''"
        @sort="handleSort"
        @row-click="handleRowClick"
        @row-contextmenu="handleRowContextMenu"
      >
        <Column
          field="sku"
          header="SKU"
          sortable
          style="width: 200px; min-width: 200px"
        >
          <template #body="{data: item}">
            <div
              v-if="item._skeleton"
              class="skeleton-block"
            />
            <BaseCopyText
              v-else
              :value="item.sku"
              label-color="var(--p-gray-800)"
            />
          </template>
        </Column>

        <Column
          field="status"
          header="Status"
          sortable
          style="width: 110px; min-width: 110px"
        >
          <template #body="{data: item}">
            <div
              v-if="item._skeleton"
              class="skeleton-block"
            />
            <Tag
              v-else
              :value="formatStatus(item.status)"
              :class="
                item.status === 'active'
                  ? 'status-active'
                  : 'status-inactive'
              "
            />
          </template>
        </Column>

        <Column
          field="manufacturers_id.name"
          header="Manufacturer"
          sortable
          style="width: 240px; min-width: 240px"
        >
          <template #body="{data: item}">
            <div
              v-if="item._skeleton"
              class="skeleton-block"
            />
            <template v-else>
              {{ item.manufacturers_id?.name }}
            </template>
          </template>
        </Column>

        <Column
          field="mpn"
          header="MPN"
          sortable
          style="width: 160px; min-width: 160px"
        >
          <template #body="{data: item}">
            <div
              v-if="item._skeleton"
              class="skeleton-block"
            />
            <template v-else>
              {{ item.mpn }}
            </template>
          </template>
        </Column>

        <Column
          field="description"
          header="Description"
          sortable
          style="min-width: 250px"
        >
          <template #body="{data: item}">
            <div
              v-if="item._skeleton"
              class="skeleton-block"
            />
            <template v-else>
              {{ item.description }}
            </template>
          </template>
        </Column>

        <!-- Row itself opens the item (clickable row); the frozen column remains
             for horizontal scroll navigation only. -->
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
            page-label="items"
          />
        </template>
      </DataTable>
      <ContextMenu
        ref="contextMenuRef"
        :model="contextMenuItems"
      />
    </div>

    <DrawerSpecialOrderSku v-model:visible="specialSkuDrawerVisible" />
  </div>
</template>

<style scoped>
.items-page {
    --list-table-offset: 220px;

    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: 0;
    margin-bottom: calc(-1 * var(--p-spacing-4));

    @media (min-width: 768px) {
        --list-table-offset: 230px;
    }
}

.items-page__header {
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
        column-gap: 0;
        row-gap: 0;
    }
}

.items-page__title {
    grid-area: title;
    margin-right: clamp(var(--p-spacing-2), 2vw, var(--p-spacing-4));
}

.items-page__chips-row {
    grid-area: chips;
}

.items-page__header-actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
}

/* Small primary button matching the Customers list "New" button; keep it from
   shrinking/wrapping in the header flex. */
.items-page__special-sku-btn.p-button {
    flex-shrink: 0;
    white-space: nowrap;
}

h1 {
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-spacing-8);
    margin: 0;
}

.items-card {
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-sm);
    overflow: hidden;
    padding: var(--p-spacing-4);
}

:deep(.items-table.p-datatable) {
    min-height: 218px;
}

:deep(.items-table .p-datatable-table-container),
:deep(.items-table .p-virtualscroller) {
    min-height: 218px;
}
</style>
