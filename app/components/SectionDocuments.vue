<script setup lang="ts">
const ROWS_PER_BATCH = 10

interface Props {
  documents?: Record<string, any>[]
  collapsed?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  documents: () => [],
  collapsed: false,
})

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const documentsTableRef = ref<any>(null)
const displayLimit = ref(ROWS_PER_BATCH)

const filteredDocuments = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) {return props.documents}
  return props.documents.filter((document) => {
    const tags = Array.isArray(document.tags) ? document.tags.join(' ') : document.tags
    return [document.name, tags]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(query))
  })
})

const isCompactTable = computed(() => filteredDocuments.value.length <= ROWS_PER_BATCH)
const showFilter = computed(() => props.documents.length > ROWS_PER_BATCH || !!filterText.value.trim())

const displayedDocuments = computed(() =>
  filteredDocuments.value.slice(0, displayLimit.value),
)
function handleSort(event: { sortField?: unknown }) {
  if (event?.sortField) {
    displayLimit.value = filteredDocuments.value.length
  }
}

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(documentsTableRef, () => displayedDocuments.value.length)

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
  if (nearBottom && displayLimit.value < filteredDocuments.value.length) {
    displayLimit.value = Math.min(
      displayLimit.value + ROWS_PER_BATCH,
      filteredDocuments.value.length,
    )
  }
}

function attachScrollListener() {
  const container =
    documentsTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    documentsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.addEventListener('scroll', handleScroll)
  }
}

function detachScrollListener() {
  const container =
    documentsTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    documentsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
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
  if (filterText.value.trim() && !filteredDocuments.value.length) {
    return `0 of ${props.documents.length} documents match`
  }
  if (!props.documents.length) {return 'No associated documents'}
  return `0 of ${props.documents.length} documents`
})

const { showFooterShadow } = useTableFooterShadow(documentsTableRef, computed(() => displayedDocuments.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(documentsTableRef, computed(() => displayedDocuments.value.length))
</script>

<template>
  <BasePanel
    id="documents"
    :title="`Documents (${documents.length.toLocaleString()})`"
    :collapsed="collapsed"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-documents__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Documents"
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
        :class="['section-documents__filter', { 'section-documents__filter--active': filterText }]"
        aria-label="Search Documents"
        @click="handleMobileFilterClick"
      />
    </template>
    <DataTable
      ref="documentsTableRef"
      class="is-row-hoverable"
      :value="displayedDocuments"
      data-key="id"
      scrollable
      removable-sort
      sort-field="name"
      :sort-order="-1"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      @sort="handleSort"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-documents__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Documents"
            size="small"
            class="section-documents__filter-input"
          />
        </div>
      </template>
      <Column style="width: 40px">
        <template #header>
          <i class="pi pi-sort-alt section-doc__reorder-icon" />
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
      <Column
        field="name"
        header="Name"
        sortable
      >
        <template #body="{ data: document }">
          <span class="section-doc__name">
            <i class="pi pi-file section-doc__name-icon" />
            {{ document.name }}
          </span>
        </template>
      </Column>
      <Column
        field="tags"
        header="Tags"
        sortable
      >
        <template #body="{ data: document }">
          <div class="section-doc__tags">
            <Tag
              v-for="tag in document.tags"
              :key="tag"
              :value="tag"
              class="section-doc__tag"
            />
          </div>
        </template>
      </Column>
      <BaseFrozenColumn
        key="frozen"
        :table-ref="documentsTableRef"
        :actions="[
          { icon: 'pi pi-download' },
          { icon: 'pi pi-external-link' },
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
          :total-records="filteredDocuments.length"
          page-label="documents"
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

.section-documents__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-documents__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-documents__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

.section-documents__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-documents__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-documents__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-documents__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

.section-doc__reorder-icon {
    font-size: var(--p-font-size-sm);
    color: var(--p-text-muted-color);
}

.section-doc__name {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    font-size: var(--p-font-size-sm);
    color: var(--p-deepblue-900);
}

.section-doc__name-icon {
    font-size: var(--p-font-size-sm);
    color: var(--p-text-muted-color);
}

.section-doc__tags {
    display: flex;
    gap: var(--p-spacing-2);
    flex-wrap: wrap;
}

:deep(.section-doc__tag.p-tag) {
    background: transparent;
    border: 1px solid var(--p-surface-300);
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-normal);
    border-radius: var(--p-border-radius-full);
}
</style>
