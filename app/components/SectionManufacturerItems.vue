<script setup lang="ts">
interface Props {
  items?: Record<string, any>[]
  itemCount?: number
  collapsed?: boolean
  isLoadingMore?: boolean
  sortField?: string | null
  sortOrder?: number | null
  totalRecords?: number
  search?: string
}

const props = withDefaults(defineProps<Props>(), {
  items: () => [],
  itemCount: 0,
  collapsed: false,
  isLoadingMore: false,
  sortField: 'sku',
  sortOrder: 1,
  totalRecords: 0,
  search: '',
})

const emit = defineEmits<{
  'scroll-near-bottom': []
  sort: [event: { sortField: string | null; sortOrder: number | null }]
  'update:search': [value: string]
}>()

const searchInputRef = ref<any>(null)
const isSearchExpanded = ref(false)

// Whole-row click opens the item detail page (same target as the frozen action).
const { handleRowClick, handleRowContextMenu, contextMenuRef, contextMenuItems }
  = useRowNavigation((row) => `/items/${(row as { sku?: string }).sku}`)

const searchValue = computed({
  get: () => props.search,
  set: (value: string) => emit('update:search', value),
})

function handleSearchIconClick() {
  if (searchValue.value) {
    searchValue.value = ''
    isSearchExpanded.value = false
  } else {
    isSearchExpanded.value = !isSearchExpanded.value
    if (isSearchExpanded.value) {
      nextTick(() => searchInputRef.value?.$el?.focus())
    }
  }
}

const itemsTableRef = ref<any>(null)

function handleSort(event: any) {
  emit('sort', { sortField: event.sortField ?? null, sortOrder: event.sortOrder ?? null })
}

function handleOpenSku(sku: string) {
  window.open(`https://libertysupply.com/products/${sku.toLowerCase()}`, '_blank')
}

function handleScroll(event: Event) {
  const container = event.target as HTMLElement
  const threshold = 100
  const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  if (nearBottom && !props.isLoadingMore) {
    emit('scroll-near-bottom')
  }
}

function attachScrollListener() {
  const container =
    itemsTableRef.value?.$el?.querySelector('.p-virtualscroller')
    || itemsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) container.addEventListener('scroll', handleScroll)
}

function detachScrollListener() {
  const container =
    itemsTableRef.value?.$el?.querySelector('.p-virtualscroller')
    || itemsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) container.removeEventListener('scroll', handleScroll)
}

onMounted(() => {
  nextTick(() => attachScrollListener())
})

onUnmounted(() => {
  detachScrollListener()
})

const { showFooterShadow } = useTableFooterShadow(itemsTableRef, computed(() => props.items.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(
  itemsTableRef,
  computed(() => props.items.length),
)

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(itemsTableRef, () => props.items.length)
</script>

<template>
  <BasePanel
    id="items"
    :title="`Items (${itemCount.toLocaleString()})`"
    :collapsed="collapsed"
  >
    <template #actions>
      <!-- Desktop: shared collapsing search (section-filter pattern — same as the customer detail pages) -->
      <div class="section-filter section-manufacturer-items__filter-desktop">
        <InputText
          ref="searchInputRef"
          v-model="searchValue"
          v-search-input
          autocomplete="off"
          placeholder="Search Items"
          size="small"
          :class="['section-filter__input', { 'section-filter__input--collapsed': !isSearchExpanded && !searchValue }]"
          @focus="isSearchExpanded = true"
        />
        <SectionFilterIcon
          :active="Boolean(searchValue)"
          @activate="handleSearchIconClick"
        />
      </div>
      <!-- Mobile: square icon button that toggles the below-header input -->
      <Button
        outlined
        size="small"
        icon="pi pi-search"
        aria-label="Search Items"
        :class="['section-manufacturer-items__filter', { 'section-manufacturer-items__filter--active': searchValue }]"
        @click="handleSearchIconClick"
      />
      <ItemsToolbar
        hide-manufacturer
        inline
      />
    </template>
    <DataTable
      ref="itemsTableRef"
      class="is-row-clickable"
      :value="items"
      data-key="id"
      scrollable
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      removable-sort
      :sort-field="sortField"
      :sort-order="sortOrder"
      @row-click="handleRowClick"
      @row-contextmenu="handleRowContextMenu"
      @sort="handleSort"
    >
      <template #header>
        <div
          v-if="isSearchExpanded || searchValue"
          class="section-manufacturer-items__filter-row"
        >
          <InputText
            v-model="searchValue"
            v-search-input
            autocomplete="off"
            placeholder="Search Items"
            size="small"
            class="section-manufacturer-items__filter-input"
          />
        </div>
      </template>
      <!-- SKU (thumbnail + globe for Standard Item only + value) -->
      <Column
        field="sku"
        header="SKU"
        sortable
        style="width: 240px; min-width: 240px"
      >
        <template #body="{ data: product }">
          <span class="section-item__sku-cell">
            <div class="placeholder-thumb placeholder-thumb--empty">
              <BasePlaceholderIcon
                category="item"
                class="placeholder-thumb__icon"
              />
            </div>
            <BaseIconButton
              v-if="product.is_standard_sku"
              icon="pi pi-globe"
              label="Open standard SKU page"
              @click.stop="handleOpenSku(product.sku)"
            />
            <span class="section-item__cell-text">{{ product.sku }}</span>
          </span>
        </template>
      </Column>

      <Column
        field="status"
        header="Status"
        sortable
        style="width: 110px; min-width: 110px"
      >
        <template #body="{ data: product }">
          <Tag
            :value="formatStatus(product.status)"
            :class="
              product.status === 'active'
                ? 'status-active'
                : 'status-inactive'
            "
          />
        </template>
      </Column>

      <Column
        field="mpn"
        header="MPN"
        sortable
        style="width: 160px; min-width: 160px"
      >
        <template #body="{ data: product }">
          <span class="section-item__cell-text">{{ product.mpn }}</span>
        </template>
      </Column>

      <Column
        field="description"
        header="Description"
        sortable
        style="min-width: 280px"
      >
        <template #body="{ data: product }">
          <span class="section-item__cell-text">{{ product.description }}</span>
        </template>
      </Column>

      <!-- Frozen right: horizontal scroll nav only — the row itself opens the
           item detail page now (clickable row). -->
      <BaseFrozenColumn
        key="frozen"
        scrollable-only
        :table-ref="itemsTableRef"
        :actions="[]"
      />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :loading="isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="totalRecords"
          page-label="items"
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
:deep(.p-datatable-thead > tr > th .p-datatable-column-header-content) {
    display: flex;
    align-items: center;
}


.section-item__sku-cell {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
}

.section-item__cell-text {
    color: var(--p-gray-800);
}

/* Mobile: square search button; the shared section-filter handles the desktop
   collapsing search (same pattern as the customer detail pages). */
.section-manufacturer-items__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-manufacturer-items__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-manufacturer-items__filter--active.p-button) {
    color: var(--p-red-500);
}

.section-manufacturer-items__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-manufacturer-items__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-manufacturer-items__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-manufacturer-items__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

/* The inline filter now renders at its natural size=small from
   BaseFilterToolbar — no section-level override needed. */
</style>
