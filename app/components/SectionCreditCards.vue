<script setup lang="ts">
const INITIAL_LIMIT = 10

interface Props {
  creditCards?: Record<string, any>[]
  contacts?: Record<string, any>[]
  addresses?: Record<string, any>[]
  referenceId?: string | null
  collapsed?: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  creditCards: () => [],
  contacts: () => [],
  addresses: () => [],
  referenceId: null,
  collapsed: false,
  loading: false,
})

const emit = defineEmits<{
  saved: []
}>()

const drawerVisible = ref(false)

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const creditCardsTableRef = ref<any>(null)
const displayLimit = ref(INITIAL_LIMIT)
const isLoadingMore = ref(false)
let loadMoreTimer: ReturnType<typeof setTimeout> | null = null

const hasFullDataset = ref(false)

const filteredCreditCards = computed(() => {
  if (!hasFullDataset.value) {
    return props.creditCards.slice(0, INITIAL_LIMIT)
  }

  const query = filterText.value.toLowerCase().trim()
  if (!query) {return props.creditCards}
  return props.creditCards.filter((creditCard) => [creditCard.card, creditCard.cardholder, creditCard.status, creditCard.expires]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(query)))
})

const displayedCreditCards = computed(() =>
  hasFullDataset.value
    ? filteredCreditCards.value.slice(0, displayLimit.value)
    : filteredCreditCards.value,
)

const isCompactTable = computed(() => {
  if (hasFullDataset.value) {return filteredCreditCards.value.length <= INITIAL_LIMIT}
  return props.creditCards.length <= INITIAL_LIMIT
})

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(creditCardsTableRef, () => displayedCreditCards.value.length)
const showFilter = computed(() => props.creditCards.length > INITIAL_LIMIT || !!filterText.value.trim())

watch(filterText, () => {
  displayLimit.value = INITIAL_LIMIT
})

function handleSearchInteraction() {
  if (!hasFullDataset.value) {
    hasFullDataset.value = true
  }
}
function handleSort(event: { sortField?: unknown }) {
  if (event?.sortField) {
    hasFullDataset.value = true
    displayLimit.value = props.creditCards.length
  }
}

function handleFilterIconClick() {
  if (filterText.value) {
    filterText.value = ''
    isFilterExpanded.value = false
  } else {
    isFilterExpanded.value = !isFilterExpanded.value
    if (isFilterExpanded.value) {
      nextTick(() => filterInputRef.value?.$el?.focus())
      handleSearchInteraction()
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
  if (isFilterExpanded.value) {
    handleSearchInteraction()
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
  if (!nearBottom) {return}

  if (!hasFullDataset.value) {
    handleSearchInteraction()
    return
  }

  if (displayLimit.value < filteredCreditCards.value.length && !isLoadingMore.value) {
    isLoadingMore.value = true
    loadMoreTimer = setTimeout(() => {
      displayLimit.value = Math.min(
        displayLimit.value + INITIAL_LIMIT,
        filteredCreditCards.value.length,
      )
      isLoadingMore.value = false
    }, 300)
  }
}

function attachScrollListener() {
  const container =
    creditCardsTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    creditCardsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.addEventListener('scroll', handleScroll)
  }
}

function detachScrollListener() {
  const container =
    creditCardsTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    creditCardsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
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
  if (loadMoreTimer) {
    clearTimeout(loadMoreTimer)
  }
})

const emptyMessage = computed(() => {
  if (!props.creditCards.length) {return 'No associated credit cards'}
  if (filterText.value.trim() && !filteredCreditCards.value.length) {
    return `0 of ${props.creditCards.length} credit cards match`
  }
  return `0 of ${props.creditCards.length} credit cards`
})

const { showFooterShadow } = useTableFooterShadow(creditCardsTableRef, computed(() => displayedCreditCards.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(creditCardsTableRef, computed(() => filteredCreditCards.value.length))
</script>

<template>
  <BasePanel
    id="credit-cards"
    :title="`Credit Cards (${creditCards.length.toLocaleString()})`"
    :collapsed="collapsed"
    :loading="loading"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-credit-cards__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Credit Cards"
          size="small"
          :class="[
            'section-filter__input',
            { 'section-filter__input--collapsed': !isFilterExpanded }
          ]"
          @focus="isFilterExpanded = true; handleSearchInteraction()"
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
        :class="['section-credit-cards__filter', { 'section-credit-cards__filter--active': filterText }]"
        aria-label="Search Credit Cards"
        @click="handleMobileFilterClick"
      />
      <Button
        size="small"
        label="Add"
        icon="pi pi-plus"
        class="section-credit-cards__add"
        @click="drawerVisible = true"
      />
    </template>
    <DataTable
      ref="creditCardsTableRef"
      class="is-row-hoverable"
      :value="displayedCreditCards"
      data-key="id"
      scrollable
      removable-sort
      sort-field="card"
      :sort-order="-1"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      :table-style="{ minWidth: '100%' }"
      @sort="handleSort"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-credit-cards__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Credit Cards"
            size="small"
            class="section-credit-cards__filter-input"
            @focus="handleSearchInteraction"
          />
        </div>
      </template>
      <Column
        field="card"
        header="Card"
        sortable
        style="min-width: 200px"
      />
      <Column
        field="status"
        header="Status"
        sortable
        style="min-width: 120px"
      >
        <template #body="{ data: creditCard }">
          <Tag
            v-if="creditCard.status"
            :value="creditCard.status === 'active' ? 'Active' : 'Inactive'"
            :class="creditCard.status === 'active' ? 'status-active' : 'status-inactive'"
          />
        </template>
      </Column>
      <Column
        field="cardholder"
        header="Cardholder"
        sortable
        style="min-width: 200px"
      />
      <Column
        field="expires"
        header="Expires"
        sortable
        style="min-width: 150px"
      />
      <BaseFrozenColumn
        key="frozen"
        :table-ref="creditCardsTableRef"
      />
      <template
        #footer
      >
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :loading="isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="creditCards.length"
          page-label="credit cards"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
        />
      </template>
    </DataTable>
  </BasePanel>

  <DrawerCreditCard
    v-model:visible="drawerVisible"
    :reference-id="referenceId"
    :contacts="contacts"
    :addresses="addresses"
    @saved="emit('saved')"
  />
</template>

<style scoped>
:deep(.p-datatable-tbody > tr > td) {
    cursor: default;
}

:deep(.p-datatable-thead > tr > th .p-datatable-column-header-content) {
    display: flex;
    align-items: center;
}

.section-credit-cards__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-credit-cards__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-credit-cards__add .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

:deep(.section-credit-cards__add.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;

    @media (min-width: 768px) {
        width: auto;
        height: auto;
        min-width: auto;
        padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    }
}

.section-credit-cards__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-credit-cards__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-credit-cards__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-credit-cards__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.section-credit-cards__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}
</style>
