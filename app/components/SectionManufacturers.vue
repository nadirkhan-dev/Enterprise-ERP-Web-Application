<script setup lang="ts">
const ROWS_PER_BATCH = 10

interface ManufacturerRow {
  id: number | string
  manufacturerId: number | string
  name: string
  website: string | null
  logoId: string | null
  status: string
  remarks: string
  sort: number | null
  _logoSrc?: string | null
  _logoSrcset?: string | null
}

interface Props {
  manufacturers?: ManufacturerRow[]
  collapsed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  manufacturers: () => [],
  collapsed: false,
})

// Whole-row click opens the manufacturer detail page (same target as the frozen
// "open manufacturer" action).
const { handleRowClick, handleRowContextMenu, contextMenuRef, contextMenuItems }
  = useRowNavigation((row) => `/manufacturers/${(row as unknown as ManufacturerRow).manufacturerId}`)

// Frozen right-column actions: the row itself now opens the manufacturer
// (clickable row), so only the edit pencil remains here.
const frozenActions = computed(() => [
  {
    icon: 'pi pi-pencil',
    handler: (row: Record<string, unknown>) => openEditManufacturer(row),
  },
])

// Status filter — empty selection means "all". Same shared toolbar as the
// suppliers/competitors tables.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]
const selectedStatuses = ref<string[]>([])

function clearStatusFilter() {
  selectedStatuses.value = []
}

const emit = defineEmits<{
  // Ordered rows carrying the pre-drop sort so the parent can diff and persist
  // only the rows that moved (writes manufacturers_sort).
  'reorder': [orderedRows: Array<{ id: number | string, currentSort: number | null }>]
  // "Add" — the parent opens the manufacturer association picker.
  'add': []
}>()

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const manufacturersTableRef = ref<any>(null)
const manufacturerDrawerVisible = ref(false)
const manufacturerDrawerData = ref<Record<string, any> | null>(null)

// Highlight the row whose edit drawer is currently open (opened via the pencil
// action; a plain row click navigates to the manufacturer instead).
function rowClass(manufacturer: Record<string, any>): string {
  return manufacturerDrawerVisible.value && manufacturer.id === manufacturerDrawerData.value?.id
    ? 'is-drawer-active'
    : ''
}

// The manual drag order = `sort` ascending. Only that exact state is the "home
// order" where reordering is allowed; any other sort (a data column, or `sort`
// descending) is a real active sort. Mirrors SectionManufacturerSuppliers.
const sortField = ref<string>('sort')
const sortOrder = ref<number>(1)
const userHasSorted = ref(false)
// First data column — the on-load default and the sort applied when no manual
// order exists yet (every row's `sort` is null).
const FIRST_DATA_SORT_FIELD = 'name'

const isManualOrder = computed(() => sortField.value === 'sort' && sortOrder.value === 1)

// Local ordered copy so a drag can mutate the visible order before the parent
// persists it. Object refs are shared with the prop rows, so the optimistic
// `sort` stamp in onRowReorder is reflected back.
const orderedManufacturers = ref<ManufacturerRow[]>([])
watch(
  [() => props.manufacturers, selectedStatuses],
  ([list]) => {
    const statuses = selectedStatuses.value
    orderedManufacturers.value = (list ?? [])
      .filter((manufacturer) => !statuses.length || statuses.includes(manufacturer.status))
      .slice()
      .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity))
  },
  { immediate: true, deep: true },
)

// True once any manufacturer carries a manual sort value. Drives the sort
// column's icon/disabled state and the on-load default sort.
const hasSortValues = computed(() =>
  orderedManufacturers.value.some((manufacturer) => manufacturer.sort !== null && manufacturer.sort !== undefined),
)

function applyDefaultSort() {
  if (userHasSorted.value) { return }
  sortField.value = hasSortValues.value ? 'sort' : FIRST_DATA_SORT_FIELD
  sortOrder.value = 1
}
watch(hasSortValues, applyDefaultSort, { immediate: true })

const filteredManufacturers = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) { return orderedManufacturers.value }
  return orderedManufacturers.value.filter((manufacturer) =>
    [manufacturer.name, manufacturer.remarks]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

// Rank = the 1-based position in the manual order, keyed by junction id so it
// stays with each row when the table is re-sorted by another column.
const rankById = computed(() => {
  const ranks = new Map<number | string, number>()
  orderedManufacturers.value.forEach((manufacturer, index) => {
    ranks.set(manufacturer.id, index + 1)
  })
  return ranks
})

// Reorder is valid only from the home (manual-order) state — or the empty state,
// where a drag defines the first order — and never while filtering.
const canReorder = computed(() =>
  !filterText.value.trim()
  && (isManualOrder.value || !hasSortValues.value)
  && filteredManufacturers.value.length > 1,
)

const showFilter = computed(() => props.manufacturers.length > ROWS_PER_BATCH || !!filterText.value.trim())

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(manufacturersTableRef, () => filteredManufacturers.value.length)

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

function onRowReorder(event: { value: ManufacturerRow[] }) {
  if (!canReorder.value) { return }
  const reordered = event.value
  // Capture the pre-drop positions BEFORE stamping, so the parent's diff sees a
  // real change (stamping first would make currentSort === the new index and
  // nothing would persist).
  const payload = reordered.map((manufacturer) => ({ id: manufacturer.id, currentSort: manufacturer.sort ?? null }))
  // Stamp new positions optimistically so the active `sort` column keeps the
  // dropped order, then pin the active sort to the manual column.
  reordered.forEach((manufacturer, index) => { manufacturer.sort = index })
  userHasSorted.value = false
  sortField.value = 'sort'
  sortOrder.value = 1
  orderedManufacturers.value = reordered
  emit('reorder', payload)
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
  if (filterText.value.trim() && !filteredManufacturers.value.length) {
    return `0 of ${props.manufacturers.length} manufacturers match`
  }
  if (!props.manufacturers.length) {return 'No associated manufacturers'}
  return `0 of ${props.manufacturers.length} manufacturers`
})

const { showFooterShadow } = useTableFooterShadow(manufacturersTableRef, computed(() => filteredManufacturers.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(manufacturersTableRef, computed(() => filteredManufacturers.value.length))

// "Add" hands off to the parent, which opens the association picker (the same
// flow the manufacturer page's Suppliers section uses). The section's own
// DrawerManufacturer stays for VIEWING/editing an already-linked manufacturer.
function openAddManufacturer() {
  emit('add')
}

function openEditManufacturer(manufacturer) {
  manufacturerDrawerData.value = manufacturer
  manufacturerDrawerVisible.value = true
}
</script>

<template>
  <BasePanel
    id="manufacturers"
    :title="`Manufacturers (${manufacturers.length.toLocaleString()})`"
    :collapsed="collapsed"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-manufacturers__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Manufacturers"
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
        :class="['section-manufacturers__filter', { 'section-manufacturers__filter--active': filterText }]"
        aria-label="Search Manufacturers"
        @click="handleMobileFilterClick"
      />
      <BaseFilterToolbar
        inline
        :filter-count="selectedStatuses.length"
        aria-label="Filter manufacturers by status"
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
                :input-id="`manufacturers-filter-status-${option.value}`"
                :value="option.value"
              />
              <label :for="`manufacturers-filter-status-${option.value}`">
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
        class="manufacturers-add-btn"
        @click="openAddManufacturer"
      />
    </template>
    <DataTable
      ref="manufacturersTableRef"
      class="is-row-clickable"
      :value="filteredManufacturers"
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
          class="section-manufacturers__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Manufacturers"
            size="small"
            class="section-manufacturers__filter-input"
          />
        </div>
      </template>
      <!-- Drag handle — reorder writes manufacturers_sort. Only acts from the
           home (manual-order) state; onRowReorder guards with canReorder. -->
      <Column
        row-reorder
        row-reorder-icon="pi pi-equals"
        field="sort"
        :sortable="hasSortValues"
        style="width: 44px; min-width: 44px"
      >
        <!-- No manual order yet: show a disabled sort icon with a tooltip rather
             than hiding the header. Once an order exists PrimeVue renders its own
             active sort icon. -->
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

      <!-- Rank — read-only 1-based position in the manual order. Reorder + sort
           live on the drag column, so this column is display-only. -->
      <Column
        field="sort"
        header="Rank"
        body-class="rank-col"
        style="width: 72px; min-width: 72px"
      >
        <template #body="{ data: manufacturer }">
          <span class="rank-pill">
            {{ rankById.get(manufacturer.id) ?? '—' }}
          </span>
        </template>
      </Column>

      <Column
        field="name"
        header="Name"
        sortable
        style="width: clamp(200px, 28vw, 320px); min-width: 200px"
      >
        <template #body="{ data: manufacturer }">
          <div class="section-manufacturers__company">
            <span
              class="placeholder-thumb"
              :class="{ 'placeholder-thumb--empty': !manufacturer._logoSrc }"
            >
              <img
                v-if="manufacturer._logoSrc"
                :src="manufacturer._logoSrc"
                :srcset="manufacturer._logoSrcset ?? undefined"
                sizes="30px"
                alt=""
                class="placeholder-thumb__img"
              >
              <BasePlaceholderIcon
                v-else
                category="manufacturer"
                class="placeholder-thumb__icon"
              />
            </span>
            <BaseWebsiteLink
              :website="manufacturer.website"
              :name="manufacturer.name"
            />
            <span class="section-manufacturers__name">{{ manufacturer.name }}</span>
          </div>
        </template>
      </Column>
      <Column
        field="status"
        header="Status"
        sortable
        style="width: clamp(96px, 10vw, 120px); min-width: 96px"
      >
        <template #body="{ data: manufacturer }">
          <Tag
            :value="manufacturer.status === 'active' ? 'Active' : 'Inactive'"
            :class="manufacturer.status === 'active' ? 'status-active' : 'status-inactive'"
          />
        </template>
      </Column>
      <Column
        field="remarks"
        header="Remarks"
        sortable
        style="min-width: 200px"
      >
        <template #body="{ data: manufacturer }">
          {{ manufacturer.remarks || '—' }}
        </template>
      </Column>
      <BaseFrozenColumn
        key="frozen"
        :table-ref="manufacturersTableRef"
        :actions="frozenActions"
      />
      <template
        #footer
      >
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :loading="false"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="filteredManufacturers.length"
          page-label="manufacturers"
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

  <DrawerManufacturer
    v-model:visible="manufacturerDrawerVisible"
    :manufacturer="manufacturerDrawerData"
  />
</template>

<style scoped>
/* Company cell: logo thumbnail + website globe + name. */
.section-manufacturers__company {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
    min-width: 0;
}


.section-manufacturers__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

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

.section-manufacturers__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-manufacturers__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-manufacturers__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

.section-manufacturers__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-manufacturers__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-manufacturers__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-manufacturers__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.manufacturers-add-btn .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

:deep(.manufacturers-add-btn.p-button) {
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
</style>
