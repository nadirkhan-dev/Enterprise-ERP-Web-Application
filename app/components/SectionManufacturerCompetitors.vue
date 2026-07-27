<script setup lang="ts">
import type { ManufacturerCompetitor } from '~/composables/useManufacturers'

interface Props {
  competitors?: (ManufacturerCompetitor & { _logoSrc?: string | null, _logoSrcset?: string | null })[]
  collapsed?: boolean
  // Id of the competitor whose details drawer is open in the parent (or null).
  // Drives the active-row highlight; the parent gates it on drawer visibility.
  activeDetailId?: string | number | null
}

const props = withDefaults(defineProps<Props>(), {
  competitors: () => [],
  collapsed: false,
  activeDetailId: null,
})

// Highlight the row whose details drawer is open in the side pane.
function rowClass(competitor: Record<string, any>): string {
  return props.activeDetailId != null && competitor.id === props.activeDetailId
    ? 'is-drawer-active'
    : ''
}

const emit = defineEmits<{
  'view-details': [competitor: ManufacturerCompetitor]
  'reorder': [orderedJunctionIds: Array<number | string>]
  'add': []
}>()

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const competitorsTableRef = ref<any>(null)


// The manual drag order = `sort` *ascending*. Only that exact state is "the home
// order" where reordering is allowed; every other sort (a data column, or `sort`
// descending) is a real active sort, like in SectionContacts.
const sortField = ref<string>('sort')
const sortOrder = ref<number>(1)
const userHasSorted = ref(false)
// First data column — the on-load default and the sort applied when no manual
// order exists yet (every row's `sort` is null).
const FIRST_DATA_SORT_FIELD = 'name'

const isManualOrder = computed(() => sortField.value === 'sort' && sortOrder.value === 1)

// Base order: the persisted SupplyHub/Connect order (competitors_sort). A drag
// mutates this local copy (optimistically) before the parent persists it.
const orderedCompetitors = ref<typeof props.competitors>([])
watch(
  () => props.competitors,
  (list) => {
    orderedCompetitors.value = (list ?? [])
      .slice()
      .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity))
  },
  { immediate: true, deep: false },
)

// True once any competitor carries a manual sort value. Drives both the sort
// column's icon/disabled state and which sort the table defaults to on load.
const hasSortValues = computed(() =>
  orderedCompetitors.value.some((competitor) => competitor.sort !== null && competitor.sort !== undefined),
)

// On-load default: the manual-order column when sort values exist, otherwise the
// first data column. Skipped once the user has chosen their own sort.
function applyDefaultSort() {
  if (userHasSorted.value) { return }
  sortField.value = hasSortValues.value ? 'sort' : FIRST_DATA_SORT_FIELD
  sortOrder.value = 1
}
watch(hasSortValues, applyDefaultSort, { immediate: true })

const filteredCompetitors = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) { return orderedCompetitors.value }
  return orderedCompetitors.value.filter((competitor) =>
    [competitor.name, competitor.remarks]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

// Reorder is valid only from the home (manual-order) state — or the empty state,
// where a drag *defines* the first order — and never while filtering.
const canReorder = computed(() =>
  !filterText.value.trim()
  && (isManualOrder.value || !hasSortValues.value)
  && filteredCompetitors.value.length > 1,
)

const showFilter = computed(() => orderedCompetitors.value.length > 1 || !!filterText.value.trim())

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(competitorsTableRef, () => filteredCompetitors.value.length)

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

function onRowReorder(event: { value: ManufacturerCompetitor[] }) {
  if (!canReorder.value) { return }
  // A drag defines the manual order. Stamp the new positions optimistically so
  // the dropped order sticks (the active sort is the `sort` column and PrimeVue
  // re-sorts by it), then switch the active sort onto the manual column and
  // persist via the parent.
  event.value.forEach((competitor, index) => { competitor.sort = index })
  userHasSorted.value = false
  sortField.value = 'sort'
  sortOrder.value = 1
  orderedCompetitors.value = event.value
  emit('reorder', event.value.map((competitor) => competitor.junctionId))
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
  if (filterText.value.trim() && !filteredCompetitors.value.length) {
    return `0 of ${props.competitors.length} competitors match`
  }
  if (!props.competitors.length) { return 'No associated competitors' }
  return `0 of ${props.competitors.length} competitors`
})

const { showFooterShadow } = useTableFooterShadow(competitorsTableRef, computed(() => filteredCompetitors.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(competitorsTableRef, computed(() => filteredCompetitors.value.length))
</script>

<template>
  <BasePanel
    id="competitors"
    :title="`Competitors (${competitors.length.toLocaleString()})`"
    :collapsed="collapsed"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-competitors__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          autocomplete="off"
          placeholder="Search Competitors"
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
        :class="['section-competitors__filter', { 'section-competitors__filter--active': filterText }]"
        aria-label="Search Competitors"
        @click="handleMobileFilterClick"
      />
      <Button
        size="small"
        label="Add"
        icon="pi pi-plus"
        class="section-competitors__add"
        @click="emit('add')"
      />
    </template>
    <DataTable
      ref="competitorsTableRef"
      class="is-row-hoverable"
      :value="filteredCompetitors"
      data-key="id"
      :row-class="rowClass"
      scrollable
      removable-sort
      :sort-field="sortField"
      :sort-order="sortOrder"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      @row-reorder="onRowReorder"
      @sort="handleSort"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-competitors__filter-row"
        >
          <InputText
            v-model="filterText"
            autocomplete="off"
            placeholder="Search Competitors"
            size="small"
            class="section-competitors__filter-input"
          />
        </div>
      </template>

      <Column
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

      <Column
        field="name"
        header="Name"
        sortable
        style="width: clamp(200px, 28vw, 320px); min-width: 200px"
      >
        <template #body="{ data: competitor }">
          <div class="section-competitor__company">
            <span
              class="placeholder-thumb"
              :class="{ 'placeholder-thumb--empty': !competitor._logoSrc }"
            >
              <img
                v-if="competitor._logoSrc"
                :src="competitor._logoSrc"
                :srcset="competitor._logoSrcset ?? undefined"
                sizes="30px"
                alt=""
                class="placeholder-thumb__img"
              >
              <BasePlaceholderIcon
                v-else
                category="competitor"
                class="placeholder-thumb__icon"
              />
            </span>
            <BaseWebsiteLink
              :website="competitor.website"
              :name="competitor.name"
            />
            <span class="section-competitor__name">{{ competitor.name }}</span>
          </div>
        </template>
      </Column>

      <Column
        field="remarks"
        header="Remarks"
        style="min-width: 200px"
      >
        <template #body="{ data: competitor }">
          {{ competitor.remarks || '—' }}
        </template>
      </Column>

      <!-- Frozen right: the file icon opens the competitor details in the side
           pane — the row itself isn't clickable (no details page). -->
      <BaseFrozenColumn
        key="frozen"
        :table-ref="competitorsTableRef"
        :actions="[
          { icon: 'pi pi-file', handler: (competitor) => emit('view-details', competitor as unknown as ManufacturerCompetitor) },
        ]"
      />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :loading="false"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="filteredCompetitors.length"
          page-label="competitors"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
        />
      </template>
    </DataTable>
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

.section-competitors__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-competitors__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-competitors__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

/* Add button: icon-only on mobile, icon + label from tablet up. */
:deep(.section-competitors__add .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

:deep(.section-competitors__add.p-button) {
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

.section-competitors__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-competitors__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-competitors__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-competitors__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

/* Company cell: logo thumbnail + website globe + name. */
.section-competitor__company {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
    min-width: 0;
}


.section-competitor__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
