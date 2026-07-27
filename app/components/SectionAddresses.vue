<script setup lang="ts">
const INITIAL_LIMIT = 20
const COMPACT_ROW_THRESHOLD = 10

const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
]

interface Props {
  collapsed?: boolean
  businessPartnerId?: number | null
  /** Customer/supplier name — forwarded to the drawer's "find by business name". */
  businessPartnerName?: string | null
  mapAddresses: (rawAddresses: any[]) => any[]
  initialAddresses?: Record<string, any>[] | null
  initialCount?: number | null
  defaultBillingJunctionId?: number | null
  defaultShippingJunctionId?: number | null
  /** Suppliers have billing-only addresses — forwarded to the address drawer. */
  isSupplier?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  collapsed: false,
  businessPartnerId: null,
  businessPartnerName: null,
  initialAddresses: null,
  initialCount: null,
  defaultBillingJunctionId: null,
  defaultShippingJunctionId: null,
  isSupplier: false,
})

const emit = defineEmits<{
  saved: []
  'update:count': [value: number]
}>()

const { fetchPartnerAddresses, fetchPartnerAddressesCount, reorderPartnerAddresses } = useBusinessPartners()
const toast = useToast()

// A client-side column sort reorders the *view* only; allowing a drag while one
// is active would persist that visual order as the manual order, which is
// surprising. Track the active sort field so reorder can stand down until the
// sort is cleared (the table uses `removable-sort`).
// Column sort state. The on-load default is decided by `applyDefaultSort()` once
// data lands: the manual-order column when sort values exist, else the first data
// column. The initial value here only covers the brief pre-load (empty) table.
const sortField = ref<string>('sortOrder')
const sortOrder = ref<number>(1)
// The first column is the manual drag order = `sortOrder` *ascending*. Only that
// exact state is "the home order" (reorder allowed, no full fetch needed). Every
// other sort — including `sortOrder` descending — is a real active sort and is
// treated identically to the Type/Street/etc. columns.
const isManualOrder = computed(() => sortField.value === 'sortOrder' && sortOrder.value === 1)
// First data column after the manual-sort column. When no address has a manual
// order yet (every row's sortOrder is null) the table defaults to this column and
// the sort column's header trigger is hidden — there's nothing to sort by yet.
const FIRST_DATA_SORT_FIELD = 'type'
// Flips true once the user explicitly sorts a column. Until then the table tracks
// the section default (manual order if sort values exist, else the first column).
const userHasSorted = ref(false)

// Background-save state for drag-reorder. The save never blocks the handle —
// the UI updates optimistically and the write runs in the background. A drag
// mid-save coalesces into `pendingReorderOrder` and flushes when the current
// write finishes, so overlapping requests can't interleave row writes.
let isReorderSaving = false
let pendingReorderOrder: Record<string, any>[] | null = null

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)

// Status column filter — starts unset (show all), mirroring the Contacts panel.
// An empty selection means "show all". Applied client-side over the full dataset
// (see filteredAddresses); the full set is pulled whenever this filter is active.
const selectedStatuses = ref<string[]>([])
const isColumnFilterActive = computed(() => selectedStatuses.value.length > 0)
const addressesTableRef = ref<any>(null)
const addressDrawerVisible = ref(false)
const addressDrawerData = ref<Record<string, any> | null>(null)

// Highlight the row whose address edit drawer is currently open.
function rowClass(address: Record<string, any>): string {
  return addressDrawerVisible.value && address.id === addressDrawerData.value?.id
    ? 'is-drawer-active'
    : ''
}

// Paginated data (loaded incrementally on scroll)
const paginatedAddresses = ref<Record<string, any>[]>([])
const totalRecords = ref(0)
const currentPage = ref(1)
const hasMore = ref(true)
const isLoading = ref(true)
const isLoadingMore = ref(false)
let loadRequestId = 0

function hasSeedData() {
  return Array.isArray(props.initialAddresses) && props.initialCount !== null
}

function seedFromInitial() {
  if (!hasSeedData()) return false
  paginatedAddresses.value = [...(props.initialAddresses || [])]
  totalRecords.value = props.initialCount ?? paginatedAddresses.value.length
  hasMore.value = paginatedAddresses.value.length < totalRecords.value
  currentPage.value = Math.max(1, Math.ceil(paginatedAddresses.value.length / INITIAL_LIMIT))
  isLoading.value = false
  applyDefaultSort()
  return true
}

// Full dataset cache (fetched on first search interaction)
const fullDataset = ref<Record<string, any>[] | null>(null)
const hasFullDataset = ref(false)
const isFullFetchInProgress = ref(false)

// Display source: full dataset (once loaded) OR paginated data, narrowed by the
// status filter and — when the full dataset is loaded — the text search.
const filteredAddresses = computed(() => {
  const source = hasFullDataset.value ? (fullDataset.value || []) : paginatedAddresses.value
  const query = hasFullDataset.value ? filterText.value.toLowerCase().trim() : ''
  const statuses = selectedStatuses.value

  return source.filter((address) => {
    if (isColumnFilterActive.value && !statuses.includes(String(address.status ?? 'active'))) {
      return false
    }
    if (query
      && ![address.street, address.city, address.state, address.postalCode]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(query))) {
      return false
    }
    return true
  })
})

// True when at least one loaded address carries a manual sort value. Drives both
// the sort column's icon visibility and which column is the on-load default sort.
const hasSortValues = computed(() => {
  const rows = hasFullDataset.value ? (fullDataset.value || []) : paginatedAddresses.value
  return rows.some((address) => address.sortOrder !== null && address.sortOrder !== undefined)
})

// Apply the on-load default sort: the manual-order column when sort values exist,
// otherwise the first data column. Skipped once the user has chosen their own sort.
// A non-manual default orders the *whole* list, so pull the full dataset like a
// header sort does rather than client-sorting only the loaded prefix.
function applyDefaultSort() {
  if (userHasSorted.value) { return }
  sortField.value = hasSortValues.value ? 'sortOrder' : FIRST_DATA_SORT_FIELD
  sortOrder.value = 1
  // A non-manual default orders the whole list; an active status filter likewise
  // needs every row on hand to filter and count correctly. Either pulls the full
  // dataset (a no-op cache copy when the loaded pages already hold everything).
  if (!isManualOrder.value || isColumnFilterActive.value) {
    fetchFullAddressDataset()
  }
}

const isCompactTable = computed(() => {
  if (hasFullDataset.value) {return filteredAddresses.value.length <= COMPACT_ROW_THRESHOLD}
  return totalRecords.value <= COMPACT_ROW_THRESHOLD
})
const showFilter = computed(() => totalRecords.value > COMPACT_ROW_THRESHOLD || !!filterText.value.trim())

// Drag-reorder works on the currently-loaded rows — no need to preload the
// whole list. Scroll-pagination always loads a contiguous prefix (rows sorted
// by `addresses_sort`), so renumbering the loaded rows 0..n-1 on drop stays
// consistent with the not-yet-loaded rows below them. It's offered whenever the
// order is unambiguous: no search filter, no column sort, more than one row, and
// not mid-(re)load.
const canReorder = computed(() =>
  !isLoading.value
  && !isLoadingMore.value
  && !filterText.value.trim()
  // Manual order normally, but also the empty state (no sort values yet) so a
  // drag can *define* the first order — that's how the sort column gets enabled.
  && (isManualOrder.value || !hasSortValues.value)
  && filteredAddresses.value.length > 1
  // A status filter can hide rows; reordering the visible subset would drop the
  // hidden rows (handleRowReorder overwrites the backing list with the view), so
  // only allow it when the filter is hiding nothing.
  && filteredAddresses.value.length === (hasFullDataset.value ? (fullDataset.value?.length ?? 0) : paginatedAddresses.value.length),
)

// Virtual scrolling stays on for smooth scrolling of large lists. It coexists
// with row-reorder because PrimeVue offsets the drag/drop indices by the
// scroller's first-visible row (`d_first`), so reorder still maps to absolute
// positions in the full array. Both this and `row-reorder` are always-on (never
// toggled), so there's no live scroll-mode switch to trip a patch crash.
const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(addressesTableRef, () => filteredAddresses.value.length)

/**
 * Load addresses page-by-page (used for initial load + scroll pagination).
 */
async function loadAddresses(page = 1) {
  const currentRequestId = ++loadRequestId

  if (page === 1) {
    isLoading.value = true
    paginatedAddresses.value = []
  } else {
    isLoadingMore.value = true
  }

  const [listResult, countResult] = await Promise.all([
    fetchPartnerAddresses(props.businessPartnerId, { limit: INITIAL_LIMIT, page }),
    page === 1
      ? fetchPartnerAddressesCount(props.businessPartnerId)
      : Promise.resolve(null),
  ])

  if (currentRequestId !== loadRequestId) {return}

  if (countResult && !countResult.error) {
    totalRecords.value = countResult.data
    emit('update:count', countResult.data)
  }
  if (!listResult.error) {
    const mapped = props.mapAddresses(listResult.data)
    if (page === 1) {
      paginatedAddresses.value = mapped
    } else {
      paginatedAddresses.value = [...paginatedAddresses.value, ...mapped]
    }
    // Prefer the known total — when it's set, stop paginating once we've
    // loaded everything; otherwise fall back to "last page was full".
    hasMore.value = totalRecords.value > 0
      ? paginatedAddresses.value.length < totalRecords.value
      : listResult.data.length === INITIAL_LIMIT
  }

  isLoading.value = false
  isLoadingMore.value = false
  currentPage.value = page

  if (page === 1) { applyDefaultSort() }
}

// Default-ness is derived by comparing each row's junction id against the
// partner's default pointers, which the parent refreshes after a save. Rows are
// stored already-mapped (the optimistic reorder mutates them in place, so they
// can't be a computed), so re-stamp the three default flags on the loaded rows
// whenever the pointers change. This decouples the gold-star display from the
// list re-fetch — the star moves the moment the parent reload lands, with no
// dependency on which network call resolves first.
watch(
  [() => props.defaultBillingJunctionId, () => props.defaultShippingJunctionId],
  ([billingId, shippingId]) => {
    const stamp = (rows: Record<string, any>[] | null) => {
      rows?.forEach((row) => {
        row.isDefaultBilling = row.id === billingId
        row.isDefaultShipping = row.id === shippingId
        row.isDefaultAny = row.isDefaultBilling || row.isDefaultShipping
      })
    }
    stamp(paginatedAddresses.value)
    stamp(fullDataset.value)
  },
)

async function fetchFullAddressDataset() {
  if (hasFullDataset.value || isFullFetchInProgress.value) {return}

  // Reuse paginated cache when it already holds the complete set — no network call needed.
  if (
    totalRecords.value > 0
    && paginatedAddresses.value.length >= totalRecords.value
  ) {
    fullDataset.value = [...paginatedAddresses.value]
    hasFullDataset.value = true
    return
  }

  isFullFetchInProgress.value = true

  const { data, error } = await fetchPartnerAddresses(props.businessPartnerId, {
    limit: -1,
  })

  if (!error) {
    fullDataset.value = props.mapAddresses(data)
    hasFullDataset.value = true
    totalRecords.value = fullDataset.value.length
    emit('update:count', fullDataset.value.length)
  }

  isFullFetchInProgress.value = false
}

/**
 * Shared handler for all search entry points (focus, click, icon click).
 */
function handleSearchInteraction() {
  fetchFullAddressDataset()
}

function handleFilterIconClick() {
  if (filterText.value) {
    filterText.value = ''
    isFilterExpanded.value = false
  } else {
    isFilterExpanded.value = !isFilterExpanded.value
    if (isFilterExpanded.value) {
      nextTick(() => filterInputRef.value?.$el?.focus())
      handleSearchInteraction()
    }
  }
}

function handleMobileFilterClick() {
  if (filterText.value) {
    filterText.value = ''
    isFilterExpanded.value = true
  } else {
    isFilterExpanded.value = !isFilterExpanded.value
  }
  // Only fetch when the filter is actually being opened, not when collapsing it.
  if (isFilterExpanded.value) {
    handleSearchInteraction()
  }
}

onBeforeUnmount(() => {
  isFilterExpanded.value = false
  filterText.value = ''
})

function handleScroll(event) {
  // Once full dataset is loaded (search active), no more scroll-based fetching needed.
  if (hasFullDataset.value) {return}

  const container = event.target
  const threshold = 100
  const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  if (nearBottom && hasMore.value && !isLoadingMore.value && !isLoading.value) {
    loadAddresses(currentPage.value + 1)
  }
}

function attachScrollListener() {
  const container =
    addressesTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    addressesTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.addEventListener('scroll', handleScroll)
  }
}

function detachScrollListener() {
  const container =
    addressesTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    addressesTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.removeEventListener('scroll', handleScroll)
  }
}

// Suppress the no-op drop indicator. When the cursor sits just below the row
// being dragged, PrimeVue marks that same row with `dragpoint-bottom` — but
// dropping there returns it to its own position, so the blue line is confusing.
// We strip that class from the dragged row on each `dragover` (ours runs after
// PrimeVue's row handler, since drag events bubble up to the table root), so
// only a genuine move shows a line. Real moves mark a *different* row, untouched.
let dragSourceRow: HTMLElement | null = null

function handleReorderDragStart(event: DragEvent) {
  dragSourceRow = (event.target as HTMLElement | null)?.closest('tr') as HTMLElement | null
}

function handleReorderDragOver() {
  dragSourceRow?.classList.remove('p-datatable-dragpoint-bottom')
  dragSourceRow?.removeAttribute('data-p-datatable-dragpoint-bottom')
}

function clearReorderDragSource() {
  dragSourceRow = null
}

function attachReorderDragListener() {
  const el = addressesTableRef.value?.$el as HTMLElement | undefined
  if (!el) { return }
  el.addEventListener('dragstart', handleReorderDragStart)
  el.addEventListener('dragover', handleReorderDragOver)
  el.addEventListener('dragend', clearReorderDragSource)
  el.addEventListener('drop', clearReorderDragSource)
}

function detachReorderDragListener() {
  const el = addressesTableRef.value?.$el as HTMLElement | undefined
  if (!el) { return }
  el.removeEventListener('dragstart', handleReorderDragStart)
  el.removeEventListener('dragover', handleReorderDragOver)
  el.removeEventListener('dragend', clearReorderDragSource)
  el.removeEventListener('drop', clearReorderDragSource)
}

// Turning the status filter on needs the whole list to filter/count over. (No
// refetch on turn-off — the cached full dataset simply stops being narrowed.)
watch(isColumnFilterActive, (active) => {
  if (active) { fetchFullAddressDataset() }
})

watch(isCompactTable, async (compact) => {
  detachScrollListener()
  if (!compact) {
    await nextTick()
    attachScrollListener()
  }
})

onMounted(() => {
  nextTick(attachReorderDragListener)
  if (seedFromInitial()) return
  if (props.businessPartnerId) {
    loadAddresses(1)
  }
})

onUnmounted(() => {
  detachScrollListener()
  detachReorderDragListener()
})

watch(() => props.businessPartnerId, (partnerId) => {
  if (!partnerId) return
  resetFullDatasetCache()
  if (seedFromInitial()) return
  currentPage.value = 1
  hasMore.value = true
  loadAddresses(1)
})

// When the parent refreshes silently (after an address save), seed data
// changes — re-sync the panel from props instead of issuing another fetch.
watch(() => props.initialAddresses, () => {
  if (!hasSeedData()) return
  resetFullDatasetCache()
  seedFromInitial()
  emit('update:count', totalRecords.value)
})

/**
 * Reset cached full dataset (called after CRUD updates and partner changes).
 */
function resetFullDatasetCache() {
  fullDataset.value = null
  hasFullDataset.value = false
  isFullFetchInProgress.value = false
}

const displayedTotalRecords = computed(() => {
  if (hasFullDataset.value) {return filteredAddresses.value.length}
  return totalRecords.value
})

const emptyMessage = computed(() => {
  if (isLoading.value) {return 'Searching...'}
  if (filterText.value.trim() && !filteredAddresses.value.length) {
    return `0 of ${totalRecords.value} addresses match`
  }
  if (!totalRecords.value) {return 'No associated addresses'}
  return `0 of ${totalRecords.value} addresses`
})

const { showFooterShadow } = useTableFooterShadow(addressesTableRef, computed(() => filteredAddresses.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(addressesTableRef, computed(() => displayedTotalRecords.value))

function buildGoogleMapsUrl(address: Record<string, any>) {
  const latitude = typeof address.latitude === 'number' ? address.latitude : null
  const longitude = typeof address.longitude === 'number' ? address.longitude : null

  if (latitude !== null && longitude !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`
  }

  const addressParts = [
    address.street,
    address.unitSuite,
    address.city,
    address.state,
    address.postalCode,
    address.countryName || address.country,
  ]
    .filter((part) => typeof part === 'string' && part.trim().length > 0)
    .join(', ')

  if (!addressParts) {
    return null
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressParts)}`
}

function openGoogleMaps(address: Record<string, any>) {
  const url = buildGoogleMapsUrl(address)
  if (!url || !import.meta.client) {
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

function openAddAddress() {
  addressDrawerData.value = null
  addressDrawerVisible.value = true
}

function openEditAddress(address) {
  addressDrawerData.value = address
  addressDrawerVisible.value = true
}

// Track the active column sort so reorder can stand down while one is applied
// (see `isManualOrder`). `removable-sort` clears the field back to the home order.
//
// A header sort must order the *whole* list, not just the pages scrolled so
// far — so any non-home sort (including the first column descending) pulls the
// full dataset (the same fetch the search uses). Once loaded, the table
// client-sorts every row.
function handleSort(event: { sortField?: unknown, sortOrder?: unknown }) {
  const field = typeof event.sortField === 'string' ? event.sortField : null
  // `removable-sort` cleared the active sort → fall back to the section default
  // (manual order if any sort values exist, else the first data column).
  if (!field) {
    userHasSorted.value = false
    applyDefaultSort()
    return
  }
  userHasSorted.value = true
  sortField.value = field
  sortOrder.value = typeof event.sortOrder === 'number' ? event.sortOrder : 1
  // Any non-home sort (incl. the first column descending) orders the whole list.
  if (!isManualOrder.value) {
    fetchFullAddressDataset()
  }
}

// After a failed save, pull the truthful server order back rather than leave the
// optimistic (now-divergent) order on screen. Seeded detail pages re-seed via
// the parent's reload; otherwise refetch the first page locally.
function refreshAfterReorderFailure() {
  resetFullDatasetCache()
  if (hasSeedData()) {
    emit('saved')
    return
  }
  currentPage.value = 1
  hasMore.value = true
  loadAddresses(1)
}

// Drag-drop persistence. PrimeVue hands us the fully reordered array; reflect it
// optimistically against whichever ref backs the display, then kick off a
// background save — the handle is never disabled, so dragging stays responsive.
function handleRowReorder(event: { value: Record<string, any>[] }) {
  if (!canReorder.value) { return }

  // A drag defines the manual order — switch the active sort onto the manual
  // column so the dropped order sticks (PrimeVue won't re-sort by the first
  // column) and its sort icon reveals once the saved values land.
  userHasSorted.value = false
  sortField.value = 'sortOrder'
  sortOrder.value = 1

  const reordered = event.value
  if (hasFullDataset.value) {
    fullDataset.value = reordered
  } else {
    paginatedAddresses.value = reordered
  }

  flushReorderSave(reordered)
}

// Serializes background saves: the latest dropped order is always saved, but
// only one write runs at a time. A drop during an in-flight save overwrites the
// pending order so we coalesce to the final intent instead of racing writes.
async function flushReorderSave(reordered: Record<string, any>[]) {
  pendingReorderOrder = reordered
  if (isReorderSaving) { return }

  isReorderSaving = true
  while (pendingReorderOrder) {
    const orderToSave = pendingReorderOrder
    pendingReorderOrder = null

    // Each row carries its current stored sort; the composable writes only the
    // rows whose index moved. `sortOrder` is the last-saved baseline, updated
    // only after a successful write (below) so coalesced drops diff correctly.
    const orderedRows = orderToSave.map((address) => ({
      id: address.id,
      currentSort: address.sortOrder ?? null,
    }))
    const { error } = await reorderPartnerAddresses(orderedRows)

    if (error) {
      // A newer drop is already queued — it will overwrite this result, so skip
      // surfacing/reverting and let the next iteration save the latest order.
      if (!pendingReorderOrder) {
        toast.add({
          severity: 'error',
          summary: 'Reorder failed',
          detail: 'The address order could not be saved. Reloading the saved order.',
          life: 4000,
        })
        refreshAfterReorderFailure()
        break
      }
      continue
    }

    // Advance the baseline to the just-saved positions so the next diff is
    // measured against what the server now holds.
    orderToSave.forEach((address, index) => { address.sortOrder = index })
  }
  isReorderSaving = false
}

function handleSaved(payload?: { mode: 'create' | 'update' | 'delete'; record?: Record<string, any>; id?: number | string }) {
  // Edits can be reflected locally without a network round-trip. Creates and
  // deletes need fresh server state (id assignment / total count / sort order),
  // so those still refetch as before.
  if (payload?.mode === 'update' && payload.record) {
    const [mapped] = props.mapAddresses([payload.record])
    if (mapped) {
      const paginatedIndex = paginatedAddresses.value.findIndex((row) => row.id === mapped.id)
      if (paginatedIndex !== -1) {
        paginatedAddresses.value.splice(paginatedIndex, 1, mapped)
      }
      if (fullDataset.value) {
        const fullIndex = fullDataset.value.findIndex((row) => row.id === mapped.id)
        if (fullIndex !== -1) {
          fullDataset.value.splice(fullIndex, 1, mapped)
        }
      }
      emit('saved')
      return
    }
  }

  resetFullDatasetCache()
  filterText.value = ''
  // When the parent owns the address data (initial-addresses prop), refreshing
  // it via the parent's silent reload will re-seed this panel through the
  // initialAddresses watcher — no need for another network call here.
  if (!hasSeedData()) {
    currentPage.value = 1
    hasMore.value = true
    loadAddresses(1)
  }
  emit('saved')
}
</script>

<template>
  <BasePanel
    id="addresses"
    :title="`Addresses (${totalRecords.toLocaleString()})`"
    :collapsed="collapsed"
    :loading="isLoading"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-addresses__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Addresses"
          size="small"
          :class="[
            'section-filter__input',
            { 'section-filter__input--collapsed': !isFilterExpanded }
          ]"
          @focus="isFilterExpanded = true; handleSearchInteraction()"
        />
        <SectionFilterIcon
          :active="Boolean(filterText)"
          @activate="handleFilterIconClick"
        />
      </div>
      <Button
        outlined
        size="small"
        icon="pi pi-search"
        :class="['section-addresses__filter', { 'section-addresses__filter--active': filterText }]"
        aria-label="Search Addresses"
        @click="handleMobileFilterClick"
      />
      <BaseFilterToolbar
        v-if="totalRecords > 0"
        inline
        :filter-count="selectedStatuses.length"
        aria-label="Filter addresses by status"
        @clear-all="selectedStatuses = []"
      >
        <BaseFilterSection
          title="Status"
          :active-count="selectedStatuses.length"
          is-last
          @clear="selectedStatuses = []"
        >
          <div class="filter-section__options-row">
            <div
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              class="filter-section__option"
            >
              <Checkbox
                v-model="selectedStatuses"
                :input-id="`addresses-filter-status-${option.value}`"
                :value="option.value"
              />
              <label :for="`addresses-filter-status-${option.value}`">
                <Tag
                  :value="option.label"
                  :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
                />
              </label>
            </div>
          </div>
        </BaseFilterSection>
      </BaseFilterToolbar>
      <Button
        size="small"
        label="Add"
        icon="pi pi-plus"
        class="section-addresses__add"
        @click="openAddAddress"
      />
    </template>
    <DataTable
      ref="addressesTableRef"
      class="is-row-hoverable"
      :value="filteredAddresses"
      data-key="id"
      :row-class="rowClass"
      scrollable
      removable-sort
      :sort-field="sortField"
      :sort-order="sortOrder"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      :table-style="{ minWidth: '100%' }"
      @row-reorder="handleRowReorder"
      @sort="handleSort"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-addresses__filter-row"
        >
          <InputText
            ref="filterInputRef"
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Addresses"
            size="small"
            class="section-addresses__filter-input"
            @focus="handleSearchInteraction"
          />
        </div>
      </template>
      <Column
        row-reorder
        row-reorder-icon="pi pi-equals"
        field="sortOrder"
        :sortable="hasSortValues"
        style="width: 48px; min-width: 48px"
      >
        <!-- No sort order set yet: keep the sort icon visible but disabled with
             a tooltip (rather than hiding it). Once a sort order exists the
             column is sortable and PrimeVue renders its own active sort icon. -->
        <template
          v-if="!hasSortValues"
          #header
        >
          <i
            v-tooltip.top="'No sort order has been defined yet'"
            class="pi pi-sort-alt sort-icon-size sort-icon-size--disabled"
            aria-label="Sorting unavailable until a sort order is set"
          />
        </template>
      </Column>
      <Column style="width: 44px; min-width: 44px">
        <template #body="{ data: address }">
          <span class="section-addresses__utility-cell">
            <i
              v-if="address.isDefaultAny"
              v-tooltip.top="address.isDefaultBilling && address.isDefaultShipping ? 'Default billing and shipping address' : address.isDefaultBilling ? 'Default billing address' : 'Default shipping address'"
              class="pi pi-star-fill section-addresses__default-star"
              aria-hidden="true"
            />
          </span>
        </template>
      </Column>
      <Column
        field="type"
        header="Type"
        sortable
        style="min-width: 120px"
      />
      <Column
        field="country"
        header="Country"
        sortable
        style="min-width: 120px"
      />
      <Column
        field="street"
        header="Street"
        sortable
        style="min-width: 205px"
      />
      <Column
        field="unitSuite"
        header="Unit/Suite"
        sortable
        style="min-width: 180px"
      />
      <Column
        field="city"
        header="City"
        sortable
        style="min-width: 170px"
      />
      <Column
        field="state"
        header="State/Region"
        sortable
        style="min-width: 170px"
      />
      <Column
        field="postalCode"
        header="Postal Code"
        sortable
        style="min-width: 130px"
      />
      <Column
        field="tagsDisplay"
        header="Tag"
        sortable
        style="min-width: 120px"
      >
        <template #body="{ data: address }">
          <span class="section-addresses__tags">
            <Tag
              v-for="tag in address.tags"
              :key="tag"
              :value="tag"
              severity="secondary"
              class="section-addresses__tag"
            />
          </span>
        </template>
      </Column>
      <Column
        field="status"
        header="Status"
        sortable
        style="min-width: 140px"
      >
        <template #body="{ data: address }">
          <Tag
            :value="address.status === 'active' ? 'Active' : 'Inactive'"
            :class="address.status === 'active' ? 'status-active' : 'status-inactive'"
          />
        </template>
      </Column>
      <BaseFrozenColumn
        key="frozen"
        :table-ref="addressesTableRef"
        :actions="[
          { icon: 'pi pi-map', handler: openGoogleMaps },
          { icon: 'pi pi-pencil', handler: openEditAddress }
        ]"
      />
      <template
        #footer
      >
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :loading="isLoadingMore || isFullFetchInProgress"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="displayedTotalRecords"
          page-label="addresses"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
        />
      </template>
    </DataTable>
  </BasePanel>

  <DrawerAddressInfo
    v-model:visible="addressDrawerVisible"
    :address="addressDrawerData"
    :business-partner-id="businessPartnerId"
    :business-partner-name="businessPartnerName"
    :default-shipping-junction-id="defaultShippingJunctionId"
    :default-billing-junction-id="defaultBillingJunctionId"
    :is-supplier="isSupplier"
    @saved="handleSaved($event)"
  />
</template>

<style scoped>
:deep(.p-datatable-tbody > tr > td) {
    cursor: default;
}
.section-addresses__tags {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
    overflow: hidden;
}
:deep(.section-addresses__tag.p-tag) {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    min-height: var(--p-spacing-5.5);
    padding: var(--p-spacing-0.5) var(--p-spacing-2);
    gap: var(--p-spacing-0.5);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-gray-50);
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-bold);
    line-height: var(--p-spacing-4);
    letter-spacing: var(--p-letter-spacing-normal);
}

:deep(.p-datatable-thead > tr > th .p-datatable-column-header-content) {
    display: flex;
    align-items: center;
}

/* Centre the order column's sort icon over the drag handle below it. */
:deep(.p-datatable-thead > tr > th:first-child .p-datatable-column-header-content) {
    justify-content: center;
}

/* PrimeVue renders the drag handle (`row-reorder-icon`) itself, so scoped icon
   classes can't reach it — style its handle class directly to match the
   original gray reorder grip. */
:deep(.p-datatable-reorderable-row-handle) {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-500);
    cursor: grab;
}

:deep(.p-datatable-reorderable-row-handle:active) {
    cursor: grabbing;
}

.section-addresses__utility-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
}

.section-addresses__default-star {
    font-size: var(--p-font-size-sm);
    color: #f4bf24;
}

.section-addresses__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-addresses__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-addresses__add .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

:deep(.section-addresses__add.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;

    @media (min-width: 768px) {
        width: auto;
        height: auto;
        min-width: auto;
        padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    }
}

.section-addresses__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-addresses__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-addresses__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-addresses__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.section-addresses__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

/* Tuck the active-count badge into the filter button's corner instead of
   overflowing outward, so it never crowds the adjacent Add button. */
:deep(.filter-toolbar__filter-badge--inline .p-badge) {
    inset-block-start: -10px;
    inset-inline-end: -5px;
    transform: none;
}

</style>
