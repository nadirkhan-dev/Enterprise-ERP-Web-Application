<script setup lang="ts">
interface Props {
  quotes?: Record<string, any>[]
  totalCount?: number
  collapsed?: boolean
  loading?: boolean
  lookerUrl?: string | null
  isLoadingMore?: boolean
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  quotes: () => [],
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
const quotesTableRef = ref<any>(null)

const filteredQuotes = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) { return props.quotes }
  return props.quotes.filter((quote) =>
    [quote.quoteNumber, quote.status, quote.createdOn, quote.createdBy, quote.requestedBy]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query)),
  )
})

// The selector sets how many rows are visible; the table scrolls when there
// are more. The full dataset is also reachable via the Looker link.
const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(quotesTableRef, () => filteredQuotes.value.length)

const showFilter = computed(() =>
  props.quotes.length > DEFAULT_TABLE_ROWS_PER_PAGE || !!filterText.value.trim(),
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
  quotesTableRef,
  virtualScrollerOptions,
  () => props.hasMore && !props.isLoadingMore && !props.loading,
  () => emit('scroll-near-bottom'),
)

onBeforeUnmount(() => {
  isFilterExpanded.value = false
  filterText.value = ''
})

// Total document count for the section header + empty-state copy.
const quoteTotal = computed(() => props.totalCount)

const emptyMessage = computed(() => {
  if (!quoteTotal.value) { return 'No associated quotes' }
  if (filterText.value.trim() && !filteredQuotes.value.length) {
    return `0 of ${quoteTotal.value} quotes match`
  }
  return `0 of ${quoteTotal.value} quotes`
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(
  quotesTableRef,
  computed(() => filteredQuotes.value.length),
)

const { showFooterShadow } = useTableFooterShadow(
  quotesTableRef,
  computed(() => filteredQuotes.value.length),
)

const toast = useToast()
const { downloadDocument, pendingAction } = useDocumentDownload()
const detailsDrawerVisible = ref(false)

function quoteRenderInput(quote: Record<string, any>) {
  return {
    template: 'sales-quotes',
    docEntry: quote.docEntry,
    filename: buildDocumentFilename(quote.quoteNumber, 'Quote'),
  }
}

function notifyMissingDocId() {
  toast.add({
    severity: 'warn',
    summary: 'Document ID unavailable',
    detail: 'This quote has no document ID yet.',
    life: 3000,
  })
}

// CONNECT-617: the in-app transaction detail panel isn't built yet — open the
// "Under Construction" placeholder for now. The PDF download stays available.
function handleQuoteOpen() {
  detailsDrawerVisible.value = true
}

function handleQuoteDownload(quote: Record<string, any>) {
  if (!quote.docEntry) { notifyMissingDocId(); return }
  downloadDocument(quoteRenderInput(quote))
}

const quoteActions = [
  {
    icon: (quote: Record<string, unknown>) =>
      pendingAction(quote.docEntry as string | number) === 'download'
        ? 'pi pi-spin pi-spinner'
        : 'pi pi-download',
    handler: handleQuoteDownload,
  },
  {
    icon: 'pi pi-file',
    handler: handleQuoteOpen,
  },
]
</script>

<template>
  <BasePanel
    id="quotes"
    :title="`Quotes (${quoteTotal.toLocaleString()})`"
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
        class="section-filter section-quotes__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Quotes"
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
        :class="['section-quotes__filter', { 'section-quotes__filter--active': filterText }]"
        aria-label="Search Quotes"
        @click="handleMobileFilterClick"
      />
    </template>
    <DataTable
      ref="quotesTableRef"
      class="is-row-hoverable"
      :value="filteredQuotes"
      data-key="quoteNumber"
      scrollable
      removable-sort
      sort-field="quoteNumber"
      :sort-order="-1"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      @sort="$emit('load-all')"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-quotes__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Quotes"
            size="small"
            class="section-quotes__filter-input"
          />
        </div>
      </template>
      <Column
        field="quoteNumber"
        header="Quote #"
        sortable
        style="width: 140px; min-width: 140px; max-width: 140px"
      />
      <Column
        field="status"
        header="Status"
        sortable
        style="width: 120px; min-width: 120px; max-width: 120px"
      >
        <template #body="{ data: quote }">
          <StatusTag :status="quote.status" />
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
        <template #body="{ data: quote }">
          {{ quote.documentTotal != null ? `$${quote.documentTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '' }}
        </template>
      </Column>
      <BaseFrozenColumn
        key="frozen"
        :table-ref="quotesTableRef"
        :actions="quoteActions"
      />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :loading="isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="totalCount"
          :rows-per-page-options="rowsPerPageOptions"
          page-label="quotes"
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
.section-quotes__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-quotes__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

.section-quotes__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-quotes__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-quotes__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-quotes__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.section-quotes__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}
</style>
