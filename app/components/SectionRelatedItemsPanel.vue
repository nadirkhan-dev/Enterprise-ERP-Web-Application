<script setup lang="ts">
const ROWS_PER_BATCH = 10

interface RelatedItem {
  id: string | number
  sku?: string
  manufacturer?: string
  mpn?: string
  description?: string
}

interface Props {
  title: string
  items: RelatedItem[] | Record<string, any>[]
  filterable?: boolean
  filterPlaceholder?: string
  pageLabel?: string
  collapsed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  filterable: false,
  filterPlaceholder: 'Search',
  pageLabel: 'results',
  collapsed: false,
})

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const tableRef = ref<any>(null)
const displayLimit = ref(ROWS_PER_BATCH)

// Whole-row click opens the item detail page — each row is an item.
const { handleRowClick, handleRowContextMenu, contextMenuRef, contextMenuItems }
  = useRowNavigation((row) => `/items/${(row as { sku?: string }).sku}`)

const filteredItems = computed(() => {
  if (!props.filterable) {return props.items}
  const query = filterText.value.toLowerCase().trim()
  if (!query) {return props.items}
  return props.items.filter((relatedItem) => [relatedItem.sku, relatedItem.manufacturer, relatedItem.mpn, relatedItem.description]
    .filter(Boolean)
    .some((field) => field.toLowerCase().includes(query)))
})

const isCompactTable = computed(() => filteredItems.value.length <= ROWS_PER_BATCH)
const showFilter = computed(() => props.filterable && (props.items.length > ROWS_PER_BATCH || !!filterText.value.trim()))

const displayedItems = computed(() =>
  filteredItems.value.slice(0, displayLimit.value),
)

function handleSort(event: { sortField?: unknown }) {
  if (event?.sortField) {
    displayLimit.value = filteredItems.value.length
  }
}

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(tableRef, () => displayedItems.value.length)

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
  if (nearBottom && displayLimit.value < filteredItems.value.length) {
    displayLimit.value = Math.min(
      displayLimit.value + ROWS_PER_BATCH,
      filteredItems.value.length,
    )
  }
}

function attachScrollListener() {
  const container =
    tableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    tableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.addEventListener('scroll', handleScroll)
  }
}

function detachScrollListener() {
  const container =
    tableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    tableRef.value?.$el?.querySelector('.p-datatable-table-container')
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
  if (props.filterable && filterText.value.trim() && !filteredItems.value.length) {
    return `0 of ${props.items.length} ${props.pageLabel} match`
  }
  if (!props.items.length) {return `No associated ${props.pageLabel}`}
  return `0 of ${props.items.length} ${props.pageLabel}`
})

const { showFooterShadow } = useTableFooterShadow(tableRef, computed(() => displayedItems.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(tableRef, computed(() => displayedItems.value.length))
</script>

<template>
  <BasePanel
    :title="title"
    :collapsed="collapsed"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-related-items-panel__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          :placeholder="filterPlaceholder"
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
        :class="['section-related-items-panel__filter', { 'section-related-items-panel__filter--active': filterText }]"
        :aria-label="filterPlaceholder"
        @click="handleMobileFilterClick"
      />
    </template>
    <DataTable
      ref="tableRef"
      class="is-row-clickable"
      :value="displayedItems"
      data-key="id"
      scrollable
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      removable-sort
      @row-click="handleRowClick"
      @row-contextmenu="handleRowContextMenu"
      @sort="handleSort"
    >
      <template #header>
        <div
          v-if="showFilter && (isFilterExpanded || filterText)"
          class="section-related-items-panel__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            :placeholder="filterPlaceholder"
            size="small"
            class="section-related-items-panel__filter-input"
          />
        </div>
      </template>
      <Column style="width: 40px">
        <template #header>
          <i class="pi pi-sort-alt sort-icon-size" />
        </template>
        <template #body>
          <Button
            icon="pi pi-bars"
            text
            size="small"
            severity="secondary"
          />
        </template>
      </Column>
      <Column style="width: 56px">
        <template #body>
          <div class="placeholder-thumb placeholder-thumb--empty">
            <BasePlaceholderIcon
              category="item"
              class="placeholder-thumb__icon"
            />
          </div>
        </template>
      </Column>
      <Column
        field="sku"
        header="SKU"
        sortable
        style="width: 160px"
      >
        <template #body="{ data: rowData }">
          <span class="related-items-panel__sku">
            <i class="pi pi-tag related-items-panel__sku-icon" />
            {{ rowData.sku }}
          </span>
        </template>
      </Column>
      <Column
        field="manufacturer"
        header="Manufacturer"
        sortable
        style="width: 240px"
      />
      <Column
        field="mpn"
        header="MPN"
        sortable
        style="width: 160px"
      />
      <Column
        field="description"
        header="Description"
        sortable
      />
      <BaseFrozenColumn
        key="frozen"
        :table-ref="tableRef"
        :actions="[
          { icon: 'pi pi-pencil' },
          { icon: 'pi pi-external-link' }
        ]"
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
          :total-records="filteredItems.length"
          page-label="items"
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
.section-related-items-panel__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-related-items-panel__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-related-items-panel__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

.section-related-items-panel__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-related-items-panel__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-related-items-panel__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-related-items-panel__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}


.related-items-panel__sku {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
    color: var(--p-deepblue-900);
    font-weight: var(--p-font-weight-bold);
}

.related-items-panel__sku-icon {
    font-size: var(--p-font-size-sm);
    color: var(--p-primary-500);
}
</style>
