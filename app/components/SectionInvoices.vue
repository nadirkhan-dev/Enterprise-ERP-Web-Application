<script setup lang="ts">
interface Props {
  invoices?: Record<string, any>[]
  totalCount?: number
  collapsed?: boolean
  loading?: boolean
  lookerUrl?: string | null
  isLoadingMore?: boolean
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  invoices: () => [],
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
const invoicesTableRef = ref<any>(null)

const filteredInvoices = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) { return props.invoices }
  return props.invoices.filter((invoice) =>
    [invoice.invoiceNumber, invoice.status, invoice.postingDate, invoice.paymentDue]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

// The selector sets how many rows are visible; the table scrolls when there
// are more. The full dataset is also reachable via the Looker link.
const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(invoicesTableRef, () => filteredInvoices.value.length)

const showFilter = computed(() =>
  props.invoices.length > DEFAULT_TABLE_ROWS_PER_PAGE || !!filterText.value.trim(),
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
  invoicesTableRef,
  virtualScrollerOptions,
  () => props.hasMore && !props.isLoadingMore && !props.loading,
  () => emit('scroll-near-bottom'),
)

onBeforeUnmount(() => {
  isFilterExpanded.value = false
  filterText.value = ''
})

// Total document count for the section header + empty-state copy.
const invoiceTotal = computed(() => props.totalCount)

const emptyMessage = computed(() => {
  if (!invoiceTotal.value) { return 'No associated invoices' }
  if (filterText.value.trim() && !filteredInvoices.value.length) {
    return `0 of ${invoiceTotal.value} invoices match`
  }
  return `0 of ${invoiceTotal.value} invoices`
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(
  invoicesTableRef,
  computed(() => filteredInvoices.value.length),
)

const { showFooterShadow } = useTableFooterShadow(
  invoicesTableRef,
  computed(() => filteredInvoices.value.length),
)

const toast = useToast()
const { downloadDocument, openDocument, pendingAction } = useDocumentDownload()

function invoiceRenderInput(invoice: Record<string, any>) {
  return {
    template: 'sales-invoices',
    docEntry: invoice.docEntry,
    filename: buildDocumentFilename(invoice.invoiceNumber, 'Invoice'),
  }
}

function notifyMissingDocId() {
  toast.add({
    severity: 'warn',
    summary: 'Document ID unavailable',
    detail: 'This invoice has no document ID yet.',
    life: 3000,
  })
}

function handleInvoiceOpen(invoice: Record<string, any>) {
  if (!invoice.docEntry) { notifyMissingDocId(); return }
  openDocument(invoiceRenderInput(invoice))
}

function handleInvoiceDownload(invoice: Record<string, any>) {
  if (!invoice.docEntry) { notifyMissingDocId(); return }
  downloadDocument(invoiceRenderInput(invoice))
}

const invoiceActions = [
  {
    icon: (invoice: Record<string, unknown>) =>
      pendingAction(invoice.docEntry as string | number) === 'download'
        ? 'pi pi-spin pi-spinner'
        : 'pi pi-download',
    handler: handleInvoiceDownload,
  },
  {
    icon: (invoice: Record<string, unknown>) =>
      pendingAction(invoice.docEntry as string | number) === 'open'
        ? 'pi pi-spin pi-spinner'
        : 'pi pi-file',
    handler: handleInvoiceOpen,
  },
]

// An open invoice whose Payment Due date has passed is overdue — the cell is
// flagged red with a warning icon.
function isPaymentOverdue(invoice: Record<string, any>): boolean {
  if (String(invoice.status ?? '').toLowerCase() !== 'open') {return false}
  if (!invoice.paymentDue) {return false}
  const dueDate = new Date(invoice.paymentDue)
  if (Number.isNaN(dueDate.getTime())) {return false}
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return dueDate < today
}
</script>

<template>
  <BasePanel
    id="invoices"
    :title="`Invoices (${invoiceTotal.toLocaleString()})`"
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
        class="section-filter section-invoices__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Invoices"
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
        :class="['section-invoices__filter', { 'section-invoices__filter--active': filterText }]"
        aria-label="Search Invoices"
        @click="handleMobileFilterClick"
      />
    </template>
    <DataTable
      ref="invoicesTableRef"
      class="is-row-hoverable"
      :value="filteredInvoices"
      data-key="invoiceNumber"
      scrollable
      removable-sort
      sort-field="invoiceNumber"
      :sort-order="-1"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      @sort="$emit('load-all')"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-invoices__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Invoices"
            size="small"
            class="section-invoices__filter-input"
          />
        </div>
      </template>
      <Column
        field="invoiceNumber"
        header="Invoice #"
        sortable
        style="width: 140px; min-width: 140px; max-width: 140px"
      />
      <Column
        field="status"
        header="Status"
        sortable
        style="width: 120px; min-width: 120px; max-width: 120px"
      >
        <template #body="{ data: invoice }">
          <StatusTag :status="invoice.status" />
        </template>
      </Column>
      <Column
        field="postingDate"
        header="Posting Date"
        sortable
        style="width: 150px; min-width: 150px; max-width: 150px"
      />
      <Column
        field="paymentDue"
        header="Payment Due"
        sortable
        style="width: 150px; min-width: 150px; max-width: 150px"
      >
        <template #body="{ data: invoice }">
          <span :class="{ 'section-invoices__overdue': isPaymentOverdue(invoice) }">
            <i
              v-if="isPaymentOverdue(invoice)"
              class="pi pi-exclamation-triangle"
            />
            {{ invoice.paymentDue }}
          </span>
        </template>
      </Column>
      <Column
        field="documentTotal"
        header="Document Total"
        sortable
        style="width: 160px; min-width: 160px; max-width: 160px"
      >
        <template #body="{ data: invoice }">
          {{ invoice.documentTotal != null ? `$${invoice.documentTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '' }}
        </template>
      </Column>
      <Column
        field="balanceDue"
        header="Balance Due"
        sortable
        style="width: 160px; min-width: 160px; max-width: 160px"
      >
        <template #body="{ data: invoice }">
          {{ invoice.balanceDue != null ? `$${invoice.balanceDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '' }}
        </template>
      </Column>
      <BaseFrozenColumn
        key="frozen"
        :table-ref="invoicesTableRef"
        :actions="invoiceActions"
      />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :loading="isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="totalCount"
          :rows-per-page-options="rowsPerPageOptions"
          page-label="invoices"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
          :show-shadow="showFooterShadow"
        />
      </template>
    </DataTable>
  </BasePanel>
</template>

<style scoped>
/* Overdue Payment Due — an open invoice past its due date. The icon inherits
   the red via currentColor. */
.section-invoices__overdue {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
    color: var(--p-red-700);
    vertical-align: middle;
}

.section-invoices__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-invoices__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

.section-invoices__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-invoices__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-invoices__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-invoices__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.section-invoices__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}
</style>
