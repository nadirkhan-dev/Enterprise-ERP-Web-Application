<script setup lang="ts">
interface Props {
  orders?: Record<string, any>[]
  totalCount?: number
  collapsed?: boolean
  loading?: boolean
  lookerUrl?: string | null
  isLoadingMore?: boolean
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  orders: () => [],
  totalCount: 0,
  collapsed: false,
  loading: false,
  lookerUrl: null,
  isLoadingMore: false,
  hasMore: false,
})

const emit = defineEmits<{
  'scroll-near-bottom': []
  'load-all': []
}>()

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const ordersTableRef = ref<any>(null)

const filteredOrders = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) { return props.orders }
  return props.orders.filter((order) =>
    [order.orderNumber, order.status, order.createdOn, order.createdBy, order.promiseShipBy, order.requestedBy]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

// The selector sets how many rows are visible; the table scrolls when there
// are more. The full dataset is also reachable via the Looker link.
const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(ordersTableRef, () => filteredOrders.value.length)

const showFilter = computed(() =>
  props.orders.length > DEFAULT_TABLE_ROWS_PER_PAGE || !!filterText.value.trim(),
)

// Fetch the full dataset when search opens so client-side filtering matches
// every row, not just the rows already paged in.
function openSearch() {
  emit('load-all')
}

function handleFilterIconClick() {
  if (filterText.value) {
    filterText.value = ''
    isFilterExpanded.value = false
  } else {
    isFilterExpanded.value = !isFilterExpanded.value
    if (isFilterExpanded.value) {
      openSearch()
      nextTick(() => filterInputRef.value?.$el?.focus())
    }
  }
}

function handleMobileFilterClick() {
  if (filterText.value) {
    filterText.value = ''
    isFilterExpanded.value = true
    return
  }
  isFilterExpanded.value = !isFilterExpanded.value
  if (isFilterExpanded.value) {
    openSearch()
  }
}

// Infinite-scroll — emit `scroll-near-bottom` when near the end of loaded
// rows so the parent can fetch the next page.
useTableInfiniteScroll(
  ordersTableRef,
  virtualScrollerOptions,
  () => props.hasMore && !props.isLoadingMore && !props.loading,
  () => emit('scroll-near-bottom'),
)

onBeforeUnmount(() => {
  isFilterExpanded.value = false
  filterText.value = ''
})

// Total document count for the section header + empty-state copy.
const orderTotal = computed(() => props.totalCount)

const emptyMessage = computed(() => {
  if (!orderTotal.value) { return 'No associated orders' }
  if (filterText.value.trim() && !filteredOrders.value.length) {
    return `0 of ${orderTotal.value} orders match`
  }
  return `0 of ${orderTotal.value} orders`
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(
  ordersTableRef,
  computed(() => filteredOrders.value.length),
)

const { showFooterShadow } = useTableFooterShadow(
  ordersTableRef,
  computed(() => filteredOrders.value.length),
)

const toast = useToast()
const { downloadDocument, pendingAction } = useDocumentDownload()
const detailsDrawerVisible = ref(false)

function orderRenderInput(order: Record<string, any>) {
  return {
    template: 'sales-orders',
    docEntry: order.docEntry,
    filename: buildDocumentFilename(order.orderNumber, 'Order'),
  }
}

function notifyMissingDocId() {
  toast.add({
    severity: 'warn',
    summary: 'Document ID unavailable',
    detail: 'This order has no document ID yet.',
    life: 3000,
  })
}

// CONNECT-617: the in-app transaction detail panel isn't built yet — open the
// "Under Construction" placeholder for now. The PDF download stays available.
function handleOrderOpen() {
  detailsDrawerVisible.value = true
}

function handleOrderDownload(order: Record<string, any>) {
  if (!order.docEntry) { notifyMissingDocId(); return }
  downloadDocument(orderRenderInput(order))
}

const orderActions = [
  {
    icon: (order: Record<string, unknown>) =>
      pendingAction(order.docEntry as string | number) === 'download'
        ? 'pi pi-spin pi-spinner'
        : 'pi pi-download',
    handler: handleOrderDownload,
  },
  {
    icon: 'pi pi-file',
    handler: handleOrderOpen,
  },
]
</script>

<template>
  <BasePanel
    id="orders"
    :title="`Orders (${orderTotal.toLocaleString()})`"
    :collapsed="collapsed"
    :loading="loading"
  >
    <template #actions>
      <BaseLookerLink
        v-if="lookerUrl"
        :url="lookerUrl"
      />
      <div
        v-if="showFilter"
        class="section-filter section-orders__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Orders"
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
        :class="['section-orders__filter', { 'section-orders__filter--active': filterText }]"
        aria-label="Search Orders"
        @click="handleMobileFilterClick"
      />
    </template>
    <DataTable
      ref="ordersTableRef"
      class="is-row-hoverable"
      :value="filteredOrders"
      data-key="orderNumber"
      scrollable
      removable-sort
      sort-field="orderNumber"
      :sort-order="-1"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      @sort="$emit('load-all')"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-orders__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Orders"
            size="small"
            class="section-orders__filter-input"
          />
        </div>
      </template>
      <Column
        field="orderNumber"
        header="Order #"
        sortable
        style="width: 140px; min-width: 140px; max-width: 140px"
      />
      <Column
        field="status"
        header="Status"
        sortable
        style="width: 120px; min-width: 120px; max-width: 120px"
      >
        <template #body="{ data: order }">
          <StatusTag :status="order.status" />
        </template>
      </Column>
      <Column
        field="createdOn"
        header="Created On"
        sortable
        style="width: 150px; min-width: 150px; max-width: 150px"
      />
      <Column
        field="createdBy"
        header="Created By"
        sortable
        style="width: 160px; min-width: 160px; max-width: 160px"
      />
      <Column
        field="promiseShipBy"
        header="Promise Ship By"
        sortable
        style="width: 160px; min-width: 160px; max-width: 160px"
      />
      <Column
        field="requestedBy"
        header="Requested By"
        sortable
        style="width: 160px; min-width: 160px; max-width: 160px"
      />
      <Column
        field="documentTotal"
        header="Document Total"
        sortable
        style="width: 160px; min-width: 160px; max-width: 160px"
      >
        <template #body="{ data: order }">
          {{ order.documentTotal != null ? `$${order.documentTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '' }}
        </template>
      </Column>
      <BaseFrozenColumn
        key="frozen"
        :table-ref="ordersTableRef"
        :actions="orderActions"
      />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :loading="isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="totalCount"
          :rows-per-page-options="rowsPerPageOptions"
          page-label="orders"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
          :show-shadow="showFooterShadow"
        />
      </template>
    </DataTable>
    <DrawerUnderConstruction v-model:visible="detailsDrawerVisible" />
  </BasePanel>
</template>

<style scoped>
.section-orders__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-orders__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

.section-orders__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-orders__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-orders__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-orders__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.section-orders__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}
</style>
