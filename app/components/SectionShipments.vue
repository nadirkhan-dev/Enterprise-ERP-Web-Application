<script setup lang="ts">
interface Props {
  shipments?: Record<string, any>[]
  totalCount?: number
  collapsed?: boolean
  loading?: boolean
  lookerUrl?: string | null
  isLoadingMore?: boolean
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  shipments: () => [],
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
const shipmentsTableRef = ref<any>(null)

const filteredShipments = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) { return props.shipments }
  return props.shipments.filter((shipment) =>
    [shipment.order_number, shipment.method, shipment.tracking]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

// The selector sets how many rows are visible; the table scrolls when there
// are more. The full dataset is also reachable via the Looker link.
const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(shipmentsTableRef, () => filteredShipments.value.length)

const showFilter = computed(() =>
  props.shipments.length > DEFAULT_TABLE_ROWS_PER_PAGE || !!filterText.value.trim(),
)
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
  shipmentsTableRef,
  virtualScrollerOptions,
  () => props.hasMore && !props.isLoadingMore && !props.loading,
  () => emit('scroll-near-bottom'),
)

onBeforeUnmount(() => {
  isFilterExpanded.value = false
  filterText.value = ''
})

// Total document count for the section header + empty-state copy.
const shipmentTotal = computed(() => props.totalCount)

const emptyMessage = computed(() => {
  if (!shipmentTotal.value) { return 'No associated shipments' }
  if (filterText.value.trim() && !filteredShipments.value.length) {
    return `0 of ${shipmentTotal.value} shipments match`
  }
  return `0 of ${shipmentTotal.value} shipments`
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(
  shipmentsTableRef,
  computed(() => filteredShipments.value.length),
)

const { showFooterShadow } = useTableFooterShadow(
  shipmentsTableRef,
  computed(() => filteredShipments.value.length),
)

const toast = useToast()
const { downloadDocument, pendingAction } = useDocumentDownload()
const detailsDrawerVisible = ref(false)

function shipmentRenderInput(shipment: Record<string, any>) {
  return {
    template: 'sales-deliveries',
    docEntry: shipment.docEntry,
    filename: buildDocumentFilename(shipment.order_number, 'Shipment'),
  }
}

function notifyMissingDocId() {
  toast.add({
    severity: 'warn',
    summary: 'Document ID unavailable',
    detail: 'This shipment has no document ID yet.',
    life: 3000,
  })
}

// CONNECT-617: the in-app transaction detail panel isn't built yet — open the
// "Under Construction" placeholder for now. The PDF download stays available.
function handleShipmentOpen() {
  detailsDrawerVisible.value = true
}

function handleShipmentDownload(shipment: Record<string, any>) {
  if (!shipment.docEntry) { notifyMissingDocId(); return }
  downloadDocument(shipmentRenderInput(shipment))
}

const shipmentActions = [
  {
    icon: (shipment: Record<string, unknown>) =>
      pendingAction(shipment.docEntry as string | number) === 'download'
        ? 'pi pi-spin pi-spinner'
        : 'pi pi-download',
    handler: handleShipmentDownload,
  },
  {
    icon: 'pi pi-file',
    handler: handleShipmentOpen,
  },
]
</script>

<template>
  <BasePanel
    id="shipments"
    :title="`Shipments (${shipmentTotal.toLocaleString()})`"
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
        class="section-filter section-shipments__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Shipments"
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
        :class="['section-shipments__filter', { 'section-shipments__filter--active': filterText }]"
        aria-label="Search Shipments"
        @click="handleMobileFilterClick"
      />
    </template>
    <DataTable
      ref="shipmentsTableRef"
      class="is-row-hoverable"
      :value="filteredShipments"
      data-key="tracking"
      scrollable
      removable-sort
      sort-field="order_number"
      :sort-order="-1"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      @sort="$emit('load-all')"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-shipments__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Shipments"
            size="small"
            class="section-shipments__filter-input"
          />
        </div>
      </template>
      <Column
        field="order_number"
        header="Order #"
        sortable
        style="width: 140px; min-width: 140px; max-width: 140px"
      />
      <Column
        field="order_date"
        header="Ordered On"
        sortable
        style="width: 140px; min-width: 140px; max-width: 140px"
      />
      <Column
        field="shipment_date"
        header="Shipped On"
        sortable
        style="width: 170px; min-width: 170px; max-width: 170px"
      />
      <Column
        field="method"
        header="Shipping Method"
        sortable
        style="width: 180px; min-width: 180px; max-width: 180px"
      />
      <Column
        field="tracking"
        header="Tracking"
        sortable
        style="width: 220px; min-width: 220px; max-width: 220px"
      >
        <template #body="{ data: shipment }">
          <BaseCopyText
            :value="shipment.tracking"
            label-color="var(--p-gray-800)"
          />
        </template>
      </Column>
      <BaseFrozenColumn
        key="frozen"
        :table-ref="shipmentsTableRef"
        :actions="shipmentActions"
      />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :loading="isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="totalCount"
          :rows-per-page-options="rowsPerPageOptions"
          page-label="shipments"
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
.section-shipments__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-shipments__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

.section-shipments__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-shipments__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-shipments__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-shipments__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.section-shipments__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}
</style>
