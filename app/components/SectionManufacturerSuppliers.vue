<script setup lang="ts">
import type { ManufacturerSupplier } from '~/composables/useManufacturers'

type SupplierRow = ManufacturerSupplier & { _logoSrc?: string | null, _logoSrcset?: string | null }

interface Props {
  suppliers?: SupplierRow[]
  collapsed?: boolean
  showAdd?: boolean
  showEdit?: boolean
  reorderable?: boolean
  associationNote?: string | null
  // Item page only: adds a per-row truck action that opens the Shipping
  // Estimator drawer with the supplier as the ship-from origin.
  showEstimateShipping?: boolean
  // Partner ids of suppliers whose SAP account number is still syncing (just created
  // in the panel). Their Account cell shows a "Syncing…" spinner until it lands.
  syncingSupplierIds?: Array<number | string>
  // Id of the supplier whose details drawer is open in the parent (or null).
  // Drives the active-row highlight; the parent gates it on drawer visibility.
  activeDetailId?: string | number | null
}

const props = withDefaults(defineProps<Props>(), {
  suppliers: () => [],
  collapsed: false,
  showAdd: true,
  showEdit: true,
  reorderable: true,
  associationNote: null,
  showEstimateShipping: false,
  syncingSupplierIds: () => [],
  activeDetailId: null,
})

// Highlight the row whose details drawer is open in the side pane (Manufacturers
// page only; the Items page navigates instead and passes no active id).
function rowClass(supplier: Record<string, any>): string {
  return props.activeDetailId != null && supplier.id === props.activeDetailId
    ? 'is-drawer-active'
    : ''
}

// A just-created supplier has no account number yet; while its SAP sync is in flight
// (id present in syncingSupplierIds) the Account cell shows the syncing spinner.
function isAccountSyncing(supplier: SupplierRow): boolean {
  return !supplier.accountNumber
    && props.syncingSupplierIds.some((id) => String(id) === String(supplier.id))
}

// Whole-row click opens the supplier detail page — same target as the frozen
// "open supplier" action: prefer the SAP account number, fall back to the
// Directus id for suppliers not yet synced.
const { handleRowClick, handleRowContextMenu, contextMenuRef, contextMenuItems }
  = useRowNavigation((row) => {
    const supplierRow = row as unknown as SupplierRow
    return `/suppliers/${supplierRow.accountNumber || supplierRow.id}`
  })

// Frozen right-column actions: the row itself now opens the supplier (clickable
// row), so there's no "open" icon here — the truck (estimate shipping) shows only
// on the item page; the edit pencil only where junction edits are allowed (the
// manufacturer page).
const frozenActions = computed(() => {
  const actions: Array<{ icon: string, handler: (row: Record<string, unknown>) => void }> = []
  if (props.showEstimateShipping) {
    actions.push({
      // Same shipping glyph as the side nav's Shipments item and the estimator
      // drawer's Get Estimate button.
      icon: 'ms:local_shipping',
      handler: (row) => emit('estimate-shipping', row as unknown as ManufacturerSupplier),
    })
  }
  if (props.showEdit) {
    actions.push({
      icon: 'pi pi-pencil',
      handler: (row) => emit('view-details', row as unknown as ManufacturerSupplier),
    })
  }
  return actions
})

const emit = defineEmits<{
  'view-details': [supplier: ManufacturerSupplier]
  'estimate-shipping': [supplier: ManufacturerSupplier]
  'reorder': [orderedJunctionIds: Array<number | string>]
  'add': []
}>()

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const suppliersTableRef = ref<any>(null)

// Status filter — an empty selection means "all" (no default set). Uses the
// shared BaseFilterToolbar Status filter, same as the items table and the add
// drawer, in place of the old binary active-only funnel.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]
const selectedStatuses = ref<string[]>([])

function clearStatusFilter() {
  selectedStatuses.value = []
}

// The manual drag order = `sort` *ascending*. Only that exact state is "the home
// order" where reordering is allowed; every other sort (a data column, or `sort`
// descending) is a real active sort, like in SectionContacts.
const sortField = ref<string>('sort')
const sortOrder = ref<number>(1)
const userHasSorted = ref(false)
// First data column — the on-load default and the sort applied when no manual
// order exists yet (every row's `sort` is null).
const FIRST_DATA_SORT_FIELD = 'accountNumber'

const isManualOrder = computed(() => sortField.value === 'sort' && sortOrder.value === 1)

// Keep a local ordered copy so drag-reorder can mutate the visible order before
// persisting it through the parent.
const orderedActive = ref<SupplierRow[]>([])
watch(
  [() => props.suppliers, selectedStatuses],
  ([list]) => {
    const statuses = selectedStatuses.value
    orderedActive.value = (list ?? [])
      .filter((supplier) => !statuses.length || statuses.includes(supplier.status))
      .slice()
      .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity))
  },
  { immediate: true, deep: true },
)

// True once any supplier carries a manual sort value. Drives both the sort
// column's icon/disabled state and which sort the table defaults to on load.
const hasSortValues = computed(() =>
  orderedActive.value.some((supplier) => supplier.sort !== null && supplier.sort !== undefined),
)

// On-load default: the manual-order column when sort values exist, otherwise the
// first data column. Skipped once the user has chosen their own sort.
function applyDefaultSort() {
  if (userHasSorted.value) { return }
  sortField.value = hasSortValues.value ? 'sort' : FIRST_DATA_SORT_FIELD
  sortOrder.value = 1
}
watch(hasSortValues, applyDefaultSort, { immediate: true })

const filteredSuppliers = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) { return orderedActive.value }
  return orderedActive.value.filter((supplier) =>
    [supplier.name, supplier.accountNumber, supplier.remarks]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

// Rank = the supplier's 1-based position in the manual (sort) order. Keyed by
// junction id so it stays with each row when the table is re-sorted by another
// column. Displayed read-only in the Rank column; on the item page this is the
// only order affordance (no drag).
const rankByJunctionId = computed(() => {
  const ranks = new Map<number | string, number>()
  orderedActive.value.forEach((supplier, index) => {
    ranks.set(supplier.junctionId, index + 1)
  })
  return ranks
})

// Reorder is valid only from the home (manual-order) state — or the empty state,
// where a drag *defines* the first order — and never while filtering.
const canReorder = computed(() =>
  !filterText.value.trim()
  && (isManualOrder.value || !hasSortValues.value)
  && filteredSuppliers.value.length > 1,
)

const showFilter = computed(() => orderedActive.value.length > 1 || !!filterText.value.trim())

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(suppliersTableRef, () => filteredSuppliers.value.length)

function handleSort(event: { sortField?: unknown, sortOrder?: unknown }) {
  const field = typeof event.sortField === 'string' ? event.sortField : null
  // `removable-sort` cleared the active sort → fall back to the section default.
  if (!field) {
    userHasSorted.value = false
    applyDefaultSort()
    return
  }
  userHasSorted.value = true
  sortField.value = field
  sortOrder.value = typeof event.sortOrder === 'number' ? event.sortOrder : 1
}

function onRowReorder(event: { value: SupplierRow[] }) {
  if (!canReorder.value) { return }
  // A drag defines the manual order. Stamp the new positions optimistically so
  // the dropped order sticks (the active sort is the `sort` column and PrimeVue
  // re-sorts by it), then switch the active sort onto the manual column and
  // persist via the parent.
  event.value.forEach((supplier, index) => { supplier.sort = index })
  userHasSorted.value = false
  sortField.value = 'sort'
  sortOrder.value = 1
  orderedActive.value = event.value
  emit('reorder', event.value.map((supplier) => supplier.junctionId))
}

function handleFilterIconClick() {
  if (filterText.value) {
    filterText.value = ''
    isFilterExpanded.value = false
  } else {
    isFilterExpanded.value = !isFilterExpanded.value
    if (isFilterExpanded.value) {
      nextTick(() => filterInputRef.value?.$el?.focus())
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
}

onBeforeUnmount(() => {
  isFilterExpanded.value = false
  filterText.value = ''
})

const emptyMessage = computed(() => {
  if (filterText.value.trim() && !filteredSuppliers.value.length) {
    return `0 of ${orderedActive.value.length} suppliers match`
  }
  if (!orderedActive.value.length) { return 'No active suppliers' }
  return `0 of ${orderedActive.value.length} suppliers`
})

const { showFooterShadow } = useTableFooterShadow(suppliersTableRef, computed(() => filteredSuppliers.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(suppliersTableRef, computed(() => filteredSuppliers.value.length))
</script>

<template>
  <BasePanel
    id="suppliers"
    :title="`Suppliers (${orderedActive.length.toLocaleString()})`"
    :collapsed="collapsed"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-suppliers__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Suppliers"
          size="small"
          :class="[
            'section-filter__input',
            { 'section-filter__input--collapsed': !isFilterExpanded }
          ]"
          @focus="isFilterExpanded = true"
        />
        <SectionFilterIcon
          :active="Boolean(filterText)"
          @activate="handleFilterIconClick"
        />
      </div>
      <Button
        v-if="showFilter"
        outlined
        size="small"
        icon="pi pi-search"
        :class="['section-suppliers__filter', { 'section-suppliers__filter--active': filterText }]"
        aria-label="Search Suppliers"
        @click="handleMobileFilterClick"
      />
      <BaseFilterToolbar
        inline
        :filter-count="selectedStatuses.length"
        aria-label="Filter suppliers by status"
        @clear-all="clearStatusFilter"
      >
        <BaseFilterSection
          title="Status"
          is-last
          :active-count="selectedStatuses.length"
          @clear="clearStatusFilter"
        >
          <div class="filter-section__options-row">
            <div
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              class="filter-section__option"
            >
              <Checkbox
                v-model="selectedStatuses"
                :input-id="`suppliers-filter-status-${option.value}`"
                :value="option.value"
              />
              <label :for="`suppliers-filter-status-${option.value}`">
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
        v-if="showAdd"
        size="small"
        label="Add"
        icon="pi pi-plus"
        class="section-suppliers__add"
        @click="emit('add')"
      />
    </template>
    <p
      v-if="associationNote"
      class="info-note"
    >
      <i class="pi pi-info-circle" />
      <span>{{ associationNote }}</span>
    </p>
    <DataTable
      ref="suppliersTableRef"
      class="is-row-clickable"
      :value="filteredSuppliers"
      data-key="id"
      :row-class="rowClass"
      scrollable
      removable-sort
      :sort-field="sortField"
      :sort-order="sortOrder"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      @row-reorder="onRowReorder"
      @row-click="handleRowClick"
      @row-contextmenu="handleRowContextMenu"
      @sort="handleSort"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-suppliers__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Suppliers"
            size="small"
            class="section-suppliers__filter-input"
          />
        </div>
      </template>

      <!-- Drag handle — reorder is only offered on the manufacturer page
           (reorderable). The item page omits it entirely; its Rank column below
           is read-only. -->
      <Column
        v-if="reorderable"
        row-reorder
        row-reorder-icon="pi pi-equals"
        field="sort"
        :sortable="hasSortValues"
        style="width: 44px; min-width: 44px"
      >
        <!-- No sort order set yet: keep the sort icon visible but disabled with a
             tooltip (rather than hiding it). Once an order exists the column is
             sortable and PrimeVue renders its own active sort icon. -->
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

      <!-- Rank — read-only 1-based position in the manual order. On the
           manufacturer page it's display-only (reorder + sort live on the drag
           column); on the item page there's no drag column, so Rank is the sort
           control. Either way the value itself is never editable. -->
      <Column
        field="sort"
        header="Rank"
        :sortable="!reorderable"
        body-class="rank-col"
        style="width: 72px; min-width: 72px"
      >
        <template #body="{ data: supplier }">
          <span class="rank-pill">
            {{ rankByJunctionId.get(supplier.junctionId) ?? '—' }}
          </span>
        </template>
      </Column>

      <Column
        field="accountNumber"
        header="Account"
        sortable
        style="width: clamp(92px, 9vw, 116px); min-width: 92px"
      >
        <template #body="{ data: supplier }">
          <SapSyncingIndicator
            v-if="isAccountSyncing(supplier)"
            size="sm"
            icon-only
          />
          <BaseCopyText
            v-else-if="supplier.accountNumber"
            :value="supplier.accountNumber"
          />
          <span v-else>—</span>
        </template>
      </Column>

      <Column
        field="name"
        header="Name"
        sortable
        style="width: clamp(200px, 28vw, 320px); min-width: 200px"
      >
        <template #body="{ data: supplier }">
          <div class="section-supplier__company">
            <span
              class="placeholder-thumb"
              :class="{ 'placeholder-thumb--empty': !supplier._logoSrc }"
            >
              <img
                v-if="supplier._logoSrc"
                :src="supplier._logoSrc"
                :srcset="supplier._logoSrcset ?? undefined"
                sizes="30px"
                alt=""
                class="placeholder-thumb__img"
              >
              <BasePlaceholderIcon
                v-else
                category="supplier"
                class="placeholder-thumb__icon"
              />
            </span>
            <BaseWebsiteLink
              :website="supplier.website"
              :name="supplier.name"
            />
            <span class="section-supplier__name">{{ supplier.name }}</span>
          </div>
        </template>
      </Column>

      <Column
        field="status"
        header="Status"
        sortable
        style="width: clamp(96px, 10vw, 120px); min-width: 96px"
      >
        <template #body="{ data: supplier }">
          <Tag
            :value="supplier.status === 'active' ? 'Active' : 'Inactive'"
            :class="supplier.status === 'active' ? 'status-active' : 'status-inactive'"
          />
        </template>
      </Column>

      <Column
        field="remarks"
        header="Remarks"
        style="min-width: 200px"
      >
        <template #body="{ data: supplier }">
          {{ supplier.remarks || '—' }}
        </template>
      </Column>

      <!-- Frozen right: open the supplier detail page; edit status/remarks is
           added only where junction edits are allowed (see frozenActions). -->
      <BaseFrozenColumn
        key="frozen"
        :table-ref="suppliersTableRef"
        :actions="frozenActions"
      />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :loading="false"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="filteredSuppliers.length"
          page-label="suppliers"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
        />
      </template>
    </DataTable>
    <ContextMenu
      ref="contextMenuRef"
      :model="contextMenuItems"
    />
  </BasePanel>
</template>

<style scoped>
/* Match the gray reorder grip used by the other reorderable tables. */
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

.section-suppliers__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-suppliers__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-suppliers__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

/* Add button: icon-only on mobile, icon + label from tablet up. */
:deep(.section-suppliers__add .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

:deep(.section-suppliers__add.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;

    @media (min-width: 768px) {
        width: auto;
        min-width: auto;
        height: auto;
        padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    }
}

.section-suppliers__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-suppliers__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-suppliers__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-suppliers__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

/* Company cell: logo thumbnail + website globe + name. */
.section-supplier__company {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
    min-width: 0;
}


.section-supplier__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
