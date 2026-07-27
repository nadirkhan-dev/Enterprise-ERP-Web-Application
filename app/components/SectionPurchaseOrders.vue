<script setup lang="ts">
interface Props {
  purchaseOrders?: Record<string, any>[]
  totalCount?: number
  collapsed?: boolean
  loading?: boolean
  lookerUrl?: string | null
  isLoadingMore?: boolean
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  purchaseOrders: () => [],
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
const purchaseOrdersTableRef = ref<any>(null)

const filteredPurchaseOrders = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) { return props.purchaseOrders }
  return props.purchaseOrders.filter((purchaseOrder) =>
    [
      purchaseOrder.orderNumber,
      purchaseOrder.status,
      purchaseOrder.created_on,
      purchaseOrder.promise_ship_by,
      purchaseOrder.requested_by,
      purchaseOrder.document_total,
    ]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

// The selector sets how many rows are visible; the table scrolls when there
// are more. The full dataset is also reachable via the Looker link.
const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(purchaseOrdersTableRef, () => filteredPurchaseOrders.value.length)

const showFilter = computed(() =>
  props.purchaseOrders.length > DEFAULT_TABLE_ROWS_PER_PAGE || !!filterText.value.trim(),
)
// Whenever the user opens search, fetch the full dataset so client-side
// filtering matches every PO — not just the rows already paged in. The
// page handler no-ops if already fully loaded, so emitting redundantly
// is safe.
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
useTableInfiniteScroll(
  purchaseOrdersTableRef,
  virtualScrollerOptions,
  () => props.hasMore && !props.isLoadingMore && !props.loading,
  () => emit('scroll-near-bottom'),
)

onBeforeUnmount(() => {
  isFilterExpanded.value = false
  filterText.value = ''
})

// Total document count for the section header + empty-state copy.
const purchaseOrderTotal = computed(() => props.totalCount)

const emptyMessage = computed(() => {
  if (!purchaseOrderTotal.value) { return 'No associated purchase orders' }
  if (filterText.value.trim() && !filteredPurchaseOrders.value.length) {
    return `0 of ${purchaseOrderTotal.value} purchase orders match`
  }
  return `0 of ${purchaseOrderTotal.value} purchase orders`
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(
  purchaseOrdersTableRef,
  computed(() => filteredPurchaseOrders.value.length),
)

const { showFooterShadow } = useTableFooterShadow(
  purchaseOrdersTableRef,
  computed(() => filteredPurchaseOrders.value.length),
)

const toast = useToast()
const { downloadDocument, pendingAction } = useDocumentDownload()
const detailsDrawerVisible = ref(false)

function purchaseOrderRenderInput(purchaseOrder: Record<string, any>) {
  return {
    template: 'purchase-orders',
    docEntry: purchaseOrder.docEntry,
    filename: buildDocumentFilename(purchaseOrder.orderNumber, 'PurchaseOrder'),
  }
}

function notifyMissingDocId() {
  toast.add({
    severity: 'warn',
    summary: 'Document ID unavailable',
    detail: 'This purchase order has no document ID yet.',
    life: 3000,
  })
}

// CONNECT-617: the in-app transaction detail panel isn't built yet — open the
// "Under Construction" placeholder for now. The PDF download stays available.
function handlePurchaseOrderOpen() {
  detailsDrawerVisible.value = true
}

function handlePurchaseOrderDownload(purchaseOrder: Record<string, any>) {
  if (!purchaseOrder.docEntry) { notifyMissingDocId(); return }
  downloadDocument(purchaseOrderRenderInput(purchaseOrder))
}

const purchaseOrderActions = [
  {
    icon: (purchaseOrder: Record<string, unknown>) =>
      pendingAction(purchaseOrder.docEntry as string | number) === 'download'
        ? 'pi pi-spin pi-spinner'
        : 'pi pi-download',
    handler: handlePurchaseOrderDownload,
  },
  {
    icon: 'pi pi-file',
    handler: handlePurchaseOrderOpen,
  },
]
</script>

<template>
  <BasePanel
    id="purchase-orders"
    :title="`Purchase Orders (${purchaseOrderTotal.toLocaleString()})`"
    :collapsed="collapsed"
    :loading="loading"
  >
    <template #title>
      <span class="section-purchase-orders__title-prefix">Purchase </span>Orders ({{ purchaseOrderTotal.toLocaleString() }})
    </template>
    <template #actions>
      <BaseLookerLink
        v-if="lookerUrl"
        :url="lookerUrl"
      />
      <div
        v-if="showFilter"
        class="section-filter section-purchase-orders__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Purchase Orders"
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
        :class="['section-purchase-orders__filter', { 'section-purchase-orders__filter--active': filterText }]"
        aria-label="Search Purchase Orders"
        @click="handleMobileFilterClick"
      />
    </template>
    <DataTable
      ref="purchaseOrdersTableRef"
      class="is-row-hoverable"
      :value="filteredPurchaseOrders"
      data-key="id"
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
          class="section-purchase-orders__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Purchase Orders"
            size="small"
            class="section-purchase-orders__filter-input"
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
        <template #body="{ data: purchaseOrder }">
          <Tag
            v-if="purchaseOrder.status"
            :value="getStatusTag(purchaseOrder.status).label"
            :class="getStatusTag(purchaseOrder.status).class"
          />
        </template>
      </Column>
      <Column
        field="created_on"
        header="Created On"
        sortable
        style="width: 150px; min-width: 150px; max-width: 150px"
      />
      <Column
        field="promise_ship_by"
        header="Promise Ship By"
        sortable
        style="width: 170px; min-width: 170px; max-width: 170px"
      />
      <Column
        field="requested_by"
        header="Requested By"
        sortable
        style="width: 160px; min-width: 160px; max-width: 160px"
      />
      <Column
        field="document_total"
        header="Document Total"
        sortable
        sort-field="document_total_raw"
        style="width: 160px; min-width: 160px; max-width: 160px"
      />
      <BaseFrozenColumn
        key="frozen"
        :table-ref="purchaseOrdersTableRef"
        :actions="purchaseOrderActions"
      />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :loading="isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="totalCount"
          :rows-per-page-options="rowsPerPageOptions"
          page-label="purchase orders"
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
/* Mobile: the long "Purchase Orders" title crowds the header and pushes the
   search button out, so drop the "Purchase " prefix below 768 (title reads
   "Orders (n)"). Desktop keeps the full title. */
.section-purchase-orders__title-prefix {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

.section-purchase-orders__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-purchase-orders__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-purchase-orders__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

.section-purchase-orders__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-purchase-orders__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-purchase-orders__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-purchase-orders__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}
</style>
