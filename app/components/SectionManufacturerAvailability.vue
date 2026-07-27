<script setup lang="ts">
const ROWS_PER_BATCH = 10

interface Props {
  availability?: Record<string, any>[]
  collapsed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  availability: () => [],
  collapsed: false,
})

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const availabilityTableRef = ref<any>(null)
const displayLimit = ref(ROWS_PER_BATCH)

const filteredAvailability = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) {return props.availability}
  return props.availability.filter((record) =>
    [
      record.warehouse,
      record.supplier,
      record.unitsAvailable,
      record.uniqueItemCount,
      record.inventoryValue,
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

const isCompactTable = computed(() => filteredAvailability.value.length <= ROWS_PER_BATCH)
const showFilter = computed(() => props.availability.length > ROWS_PER_BATCH || !!filterText.value.trim())

const displayedAvailability = computed(() =>
  filteredAvailability.value.slice(0, displayLimit.value),
)
function handleSort(event: { sortField?: unknown }) {
  if (event?.sortField) {
    displayLimit.value = filteredAvailability.value.length
  }
}

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(availabilityTableRef, () => displayedAvailability.value.length)

watch(filterText, () => {
  displayLimit.value = ROWS_PER_BATCH
})

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

function handleScroll(event) {
  const container = event.target
  const threshold = 100
  const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  if (nearBottom && displayLimit.value < filteredAvailability.value.length) {
    displayLimit.value = Math.min(
      displayLimit.value + ROWS_PER_BATCH,
      filteredAvailability.value.length,
    )
  }
}

function attachScrollListener() {
  const container =
    availabilityTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    availabilityTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.addEventListener('scroll', handleScroll)
  }
}

function detachScrollListener() {
  const container =
    availabilityTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    availabilityTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.removeEventListener('scroll', handleScroll)
  }
}

watch(isCompactTable, async (compact) => {
  detachScrollListener()
  if (!compact) {
    await nextTick()
    attachScrollListener()
  }
})

onMounted(() => {
  if (!isCompactTable.value) {
    attachScrollListener()
  }
})

onUnmounted(() => {
  detachScrollListener()
})

const emptyMessage = computed(() => {
  if (filterText.value.trim() && !filteredAvailability.value.length) {
    return `0 of ${props.availability.length} availability records match`
  }
  if (!props.availability.length) {return 'No associated availability records'}
  return `0 of ${props.availability.length} availability records`
})

const { showFooterShadow } = useTableFooterShadow(availabilityTableRef, computed(() => displayedAvailability.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(availabilityTableRef, computed(() => displayedAvailability.value.length))
</script>

<template>
  <BasePanel
    id="availability"
    :title="`Availability (${availability.length.toLocaleString()})`"
    :collapsed="collapsed"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-availability__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Availability"
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
        :class="['section-availability__filter', { 'section-availability__filter--active': filterText }]"
        aria-label="Search Availability"
        @click="handleMobileFilterClick"
      />
    </template>
    <DataTable
      ref="availabilityTableRef"
      :value="displayedAvailability"
      data-key="id"
      scrollable
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      removable-sort
      sort-field="warehouse"
      :sort-order="-1"
      @sort="handleSort"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-availability__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Availability"
            size="small"
            class="section-availability__filter-input"
          />
        </div>
      </template>
      <Column
        field="warehouse"
        header="Warehouse"
        sortable
      />
      <Column
        field="supplier"
        header="Supplier"
        sortable
      />
      <Column
        field="unitsAvailable"
        header="Units Available"
        sortable
      />
      <Column
        field="uniqueItemCount"
        header="Unique Item Count"
        sortable
      />
      <Column
        field="inventoryValue"
        header="Inventory Value"
        sortable
      />
      <BaseFrozenColumn
        key="frozen"
        :table-ref="availabilityTableRef"
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
          :total-records="filteredAvailability.length"
          page-label="availability records"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
        />
      </template>
    </DataTable>
  </BasePanel>
</template>

<style scoped>
:deep(.p-datatable-tbody > tr > td) {
    cursor: default;
}

.section-availability__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-availability__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-availability__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

.section-availability__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-availability__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-availability__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-availability__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}
</style>
