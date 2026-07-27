<script setup lang="ts">
const ROWS_PER_PAGE = 10
const SEARCH_DEBOUNCE_MS = 400

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

interface Props {
  collapsed?: boolean
  businessPartnerId?: number | null
  // The parent customer's group name (e.g. "Homeowner"), forwarded to the contact
  // drawer so it can disable fields that don't apply to a homeowner.
  customerGroup?: string | null
  addresses?: Record<string, any>[]
  mapContacts: (rawContacts: any[]) => any[]
  initialContacts?: Record<string, any>[] | null
  defaultSalesContactJunctionId?: number | null
  defaultBillingContactJunctionId?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  collapsed: false,
  businessPartnerId: null,
  customerGroup: null,
  addresses: () => [],
  initialContacts: null,
  defaultSalesContactJunctionId: null,
  defaultBillingContactJunctionId: null,
})

const isClientSide = computed(() => props.initialContacts !== null)

const emit = defineEmits<{
  saved: []
  'update:count': [value: number]
}>()

const { fetchPartnerContacts, fetchPartnerContactsCount, reorderPartnerContacts } = useBusinessPartners()
const toast = useToast()

const sortField = ref<string>('sortOrder')
const sortOrder = ref<number>(1)
// The first column is the manual drag order = `sortOrder` *ascending*. Only that
// exact state is "the home order" (reorder allowed). Every other sort — including
// `sortOrder` descending — is a real active sort, like the Name/Job Title columns.
const isManualOrder = computed(() => sortField.value === 'sortOrder' && sortOrder.value === 1)
// First data column after the manual-sort column. When no contact has a manual
// order yet (every row's sortOrder is null) the table defaults to this column and
// the sort column's header trigger is hidden — there's nothing to sort by yet.
const FIRST_DATA_SORT_FIELD = 'name'
// Flips true once the user explicitly sorts a column. Until then the table tracks
// the section default (manual order if sort values exist, else the first column).
const userHasSorted = ref(false)
let isReorderSaving = false
let pendingReorderOrder: Record<string, any>[] | null = null

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const contactsTableRef = ref<any>(null)
const contactDrawerVisible = ref(false)
const contactDrawerData = ref<Record<string, any> | null>(null)

// Highlight the row whose contact edit drawer is currently open.
function rowClass(contact: Record<string, any>): string {
  return contactDrawerVisible.value && contact.id === contactDrawerData.value?.id
    ? 'is-drawer-active'
    : ''
}

const selectedFilterValues = ref<string[]>([])

const contacts = ref<Record<string, any>[]>([])
const totalRecords = ref(0)
const currentPage = ref(1)
const hasMore = ref(true)
const isLoading = ref(true)
const isLoadingMore = ref(false)
const isSearching = ref(false)
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let loadRequestId = 0

// Client-side filtering (when initialContacts provided)
const allContacts = ref<Record<string, any>[]>([])

const clientFilteredContacts = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) {return allContacts.value}
  return allContacts.value.filter((contact) =>
    [contact.name, contact.jobTitle, contact.email, contact.phone, contact.notes, contact.status]
      .filter(Boolean)
      .some((field) => field.toLowerCase().includes(query)),
  )
})

const isColumnFilterActive = computed(() => selectedFilterValues.value.length > 0)

const columnFilteredContacts = computed(() => {
  const baseList = isClientSide.value ? clientFilteredContacts.value : contacts.value
  if (!isColumnFilterActive.value) {return baseList}
  const values = selectedFilterValues.value
  return baseList.filter((contact) => values.includes(String(contact.status ?? '')))
})

const displayedContacts = computed(() => columnFilteredContacts.value)

// True when at least one loaded contact carries a manual sort value. Drives both
// the sort column's icon visibility and which column is the on-load default sort.
const hasSortValues = computed(() => {
  const rows = isClientSide.value ? allContacts.value : contacts.value
  return rows.some((contact) => contact.sortOrder !== null && contact.sortOrder !== undefined)
})

// Apply the on-load default sort: the manual-order column when sort values exist,
// otherwise the first data column. Skipped once the user has chosen their own sort.
function applyDefaultSort() {
  if (userHasSorted.value) { return }
  sortField.value = hasSortValues.value ? 'sortOrder' : FIRST_DATA_SORT_FIELD
  sortOrder.value = 1
}

function stampDefaultFlags(rows: Record<string, any>[] | null) {
  const salesId = props.defaultSalesContactJunctionId
  const billingId = props.defaultBillingContactJunctionId
  rows?.forEach((row) => {
    row.isDefaultSalesContact = row.id === salesId
    row.isDefaultBillingContact = row.id === billingId
    row.isDefaultContact = row.isDefaultSalesContact || row.isDefaultBillingContact
  })
}

watch(
  [() => props.defaultSalesContactJunctionId, () => props.defaultBillingContactJunctionId],
  () => {
    stampDefaultFlags(allContacts.value)
    stampDefaultFlags(contacts.value)
  },
)

const canReorder = computed(() =>
  !isLoading.value
  && !isSearching.value
  && !isLoadingMore.value
  && !filterText.value.trim()
  // Manual order normally, but also the empty state (no sort values yet) so a
  // drag can *define* the first order — that's how the sort column gets enabled.
  && (isManualOrder.value || !hasSortValues.value)
  && displayedContacts.value.length > 1,
)

function handleSort(event: { sortField?: unknown, sortOrder?: unknown }) {
  const field = typeof event.sortField === 'string' ? event.sortField : null
  // `removable-sort` cleared the active sort → fall back to the section default.
  if (!field) {
    userHasSorted.value = false
    applyDefaultSort()
    return
  }
  userHasSorted.value = true
  sortField.value = field
  sortOrder.value = typeof event.sortOrder === 'number' ? event.sortOrder : 1
}

function handleRowReorder(event: { value: Record<string, any>[] }) {
  if (!canReorder.value) { return }
  // A drag defines the manual order — switch the active sort onto the manual
  // column so the dropped order sticks (PrimeVue won't re-sort by the first
  // column) and its sort icon reveals once the saved values land.
  userHasSorted.value = false
  sortField.value = 'sortOrder'
  sortOrder.value = 1
  const reorderedVisible = event.value
  const target = isClientSide.value ? allContacts : contacts

  let fullOrder: Record<string, any>[]
  if (isColumnFilterActive.value) {
    // Only a subset is visible — drop the reordered visible rows back into the
    // visible "slots" of the full list, leaving hidden rows where they are.
    const visibleIds = new Set(reorderedVisible.map((contact) => contact.id))
    const queue = [...reorderedVisible]
    fullOrder = target.value.map((row) => (visibleIds.has(row.id) ? queue.shift()! : row))
  } else {
    fullOrder = reorderedVisible
  }

  target.value = fullOrder
  flushReorderSave(fullOrder)
}

// Serialize background saves: the latest dropped order always wins, but only one
// write runs at a time. On failure, pull the truthful order back via the
// parent's reload (re-seeds initialContacts).
async function flushReorderSave(reordered: Record<string, any>[]) {
  pendingReorderOrder = reordered
  if (isReorderSaving) { return }

  isReorderSaving = true
  while (pendingReorderOrder) {
    const orderToSave = pendingReorderOrder
    pendingReorderOrder = null

    const orderedRows = orderToSave.map((contact) => ({
      id: contact.id,
      currentSort: contact.sortOrder ?? null,
    }))
    const { error } = await reorderPartnerContacts(orderedRows)

    if (error) {
      if (!pendingReorderOrder) {
        toast.add({
          severity: 'error',
          summary: 'Reorder failed',
          detail: 'The contact order could not be saved. Reloading the saved order.',
          life: 4000,
        })
        emit('saved')
        break
      }
      continue
    }

    // Advance the baseline to the just-saved positions so coalesced drops diff
    // correctly against what the server now holds.
    orderToSave.forEach((contact, index) => { contact.sortOrder = index })
  }
  isReorderSaving = false
}

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(contactsTableRef, () => displayedContacts.value.length)

const displayedTotalRecords = computed(() => {
  if (isColumnFilterActive.value) {return columnFilteredContacts.value.length}
  if (!isClientSide.value) {return totalRecords.value}
  return clientFilteredContacts.value.length
})

const isCompactTable = computed(() => displayedTotalRecords.value <= ROWS_PER_PAGE)
const showFilter = computed(() => {
  if (filterText.value.trim()) {return true}
  return (isClientSide.value ? allContacts.value.length : totalRecords.value) > 0
})

// Server-side fetching (when no initialContacts)
async function loadContacts(page = 1, search = null) {
  if (isClientSide.value) {return}

  const currentRequestId = ++loadRequestId
  const searchTerm = search || null

  if (page === 1) {
    isLoading.value = true
    contacts.value = []
  } else {
    isLoadingMore.value = true
  }

  const [listResult, countResult] = await Promise.all([
    fetchPartnerContacts(props.businessPartnerId, {
      limit: ROWS_PER_PAGE,
      page,
      search: searchTerm,
    }),
    page === 1
      ? fetchPartnerContactsCount(props.businessPartnerId, searchTerm)
      : Promise.resolve(null),
  ])

  if (currentRequestId !== loadRequestId) {return}

  if (!listResult.error) {
    const mapped = props.mapContacts(listResult.data)
    stampDefaultFlags(mapped)
    if (page === 1) {
      contacts.value = mapped
    } else {
      contacts.value = [...contacts.value, ...mapped]
    }
    hasMore.value = listResult.data.length === ROWS_PER_PAGE
  }
  if (countResult && !countResult.error) {
    totalRecords.value = countResult.data
    emit('update:count', countResult.data)
  }

  isLoading.value = false
  isLoadingMore.value = false
  isSearching.value = false
  currentPage.value = page

  if (page === 1) { applyDefaultSort() }
}

watch(filterText, (query) => {
  if (isClientSide.value) {return}

  clearTimeout(searchDebounceTimer)
  const trimmed = query.trim()

  if (!trimmed) {
    currentPage.value = 1
    hasMore.value = true
    loadContacts(1)
    return
  }

  isSearching.value = true

  searchDebounceTimer = setTimeout(() => {
    currentPage.value = 1
    hasMore.value = true
    loadContacts(1, trimmed)
  }, SEARCH_DEBOUNCE_MS)
})

watch(() => props.initialContacts, (rawContacts) => {
  if (rawContacts !== null) {
    allContacts.value = props.mapContacts(rawContacts)
    stampDefaultFlags(allContacts.value)
    totalRecords.value = allContacts.value.length
    emit('update:count', allContacts.value.length)
    isLoading.value = false
    applyDefaultSort()
  }
}, { immediate: true })

onBeforeUnmount(() => {
  clearTimeout(searchDebounceTimer)
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
  if (nearBottom && hasMore.value && !isLoadingMore.value && !isLoading.value) {
    loadContacts(currentPage.value + 1, filterText.value.trim() || null)
  }
}

function attachScrollListener() {
  const container =
    contactsTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    contactsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.addEventListener('scroll', handleScroll)
  }
}

function detachScrollListener() {
  const container =
    contactsTableRef.value?.$el?.querySelector('.p-virtualscroller') ||
    contactsTableRef.value?.$el?.querySelector('.p-datatable-table-container')
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
  if (!isClientSide.value && props.businessPartnerId) {
    loadContacts(1)
  }
})

onUnmounted(() => {
  detachScrollListener()
})

watch(() => props.businessPartnerId, (partnerId) => {
  selectedFilterValues.value = []
  if (!isClientSide.value && partnerId) {
    currentPage.value = 1
    hasMore.value = true
    loadContacts(1)
  }
})

const emptyMessage = computed(() => {
  if (!isClientSide.value && (isSearching.value || isLoading.value)) {return 'Searching...'}
  if ((filterText.value.trim() || isColumnFilterActive.value) && !displayedContacts.value.length) {
    const total = isClientSide.value ? allContacts.value.length : totalRecords.value
    return `0 of ${total} contacts match`
  }
  if (!displayedTotalRecords.value) {return 'No associated contacts'}
  return `0 of ${displayedTotalRecords.value} contacts`
})

const { showFooterShadow } = useTableFooterShadow(contactsTableRef, computed(() => displayedContacts.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(contactsTableRef, computed(() => displayedTotalRecords.value))

function openAddContact() {
  contactDrawerData.value = null
  contactDrawerVisible.value = true
}

function openEditContact(contact) {
  contactDrawerData.value = contact
  contactDrawerVisible.value = true
}

function handleSaved() {
  emit('saved')
}
</script>

<template>
  <BasePanel
    id="contacts"
    :title="`Contacts (${isClientSide ? allContacts.length.toLocaleString() : totalRecords.toLocaleString()})`"
    :collapsed="collapsed"
  >
    <template #actions>
      <div
        v-if="showFilter"
        class="section-filter section-contacts__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Contacts"
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
        :class="['section-contacts__filter', { 'section-contacts__filter--active': filterText }]"
        aria-label="Search Contacts"
        @click="handleMobileFilterClick"
      />

      <BaseFilterToolbar
        v-if="showFilter"
        inline
        :filter-count="selectedFilterValues.length"
        aria-label="Filter contacts by status"
        @clear-all="selectedFilterValues = []"
      >
        <BaseFilterSection
          title="Status"
          :active-count="selectedFilterValues.length"
          is-last
          @clear="selectedFilterValues = []"
        >
          <div class="filter-section__options-row">
            <div
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              class="filter-section__option"
            >
              <Checkbox
                v-model="selectedFilterValues"
                :input-id="`contacts-filter-status-${option.value}`"
                :value="option.value"
              />
              <label :for="`contacts-filter-status-${option.value}`">
                <Tag
                  :value="option.label"
                  :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
                />
              </label>
            </div>
          </div>
        </BaseFilterSection>
      </BaseFilterToolbar>
      <Button
        size="small"
        label="Add"
        icon="pi pi-plus"
        class="section-contacts__add"
        @click="openAddContact"
      />
    </template>
    <DataTable
      ref="contactsTableRef"
      class="is-row-hoverable"
      :value="displayedContacts"
      data-key="id"
      :row-class="rowClass"
      scrollable
      removable-sort
      :sort-field="sortField"
      :sort-order="sortOrder"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      :table-style="{ minWidth: '100%' }"
      @row-reorder="handleRowReorder"
      @sort="handleSort"
    >
      <template
        v-if="isFilterExpanded || filterText"
        #header
      >
        <div class="section-contacts__filter-row">
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Contacts"
            aria-label="Search contacts"
            size="small"
            class="section-contacts__filter-input"
          />
        </div>
      </template>
      <Column
        row-reorder
        row-reorder-icon="pi pi-equals"
        field="sortOrder"
        :sortable="hasSortValues"
        style="width: 48px; min-width: 48px"
      >
        <!-- No sort order set yet: keep the sort icon visible but disabled with
             a tooltip (rather than hiding it). Once a sort order exists the
             column is sortable and PrimeVue renders its own active sort icon. -->
        <template
          v-if="!hasSortValues"
          #header
        >
          <i
            v-tooltip.top="'No sort order has been defined yet'"
            class="pi pi-sort-alt sort-icon-size sort-icon-size--disabled"
            aria-label="Sorting unavailable until a sort order is set"
          />
        </template>
      </Column>
      <Column style="width: 44px; min-width: 44px">
        <template #body="{ data: contact }">
          <span class="section-contacts__utility-cell">
            <i
              v-if="contact.isDefaultContact"
              v-tooltip.top="contact.isDefaultSalesContact && contact.isDefaultBillingContact ? 'Default sales and billing contact' : contact.isDefaultSalesContact ? 'Default sales contact' : 'Default billing contact'"
              class="pi pi-star-fill section-contacts__default-star"
              aria-hidden="true"
            />
          </span>
        </template>
      </Column>
      <Column
        field="name"
        header="Name"
        sortable
        style="min-width: 160px"
      />
      <Column
        field="jobTitle"
        header="Job Title"
        sortable
        style="min-width: 150px"
      />
      <Column
        field="email"
        header="Email Address"
        sortable
        style="min-width: 290px"
      >
        <template #body="{ data: contact }">
          <BaseCopyText
            :value="contact.email"
            label-color="var(--p-gray-800)"
          />
        </template>
      </Column>
      <Column
        field="phone"
        header="Phone Number"
        sortable
        style="min-width: 180px"
      />
      <Column
        field="status"
        header="Status"
        sortable
        style="min-width: 140px"
      >
        <template #body="{ data: contact }">
          <Tag
            :value="contact.status === 'active' ? 'Active' : 'Inactive'"
            :class="contact.status === 'active' ? 'status-active' : 'status-inactive'"
          />
        </template>
      </Column>
      <BaseFrozenColumn
        key="frozen"
        :table-ref="contactsTableRef"
        :actions="[{ icon: 'pi pi-pencil', handler: openEditContact }]"
      />
      <template
        #footer
      >
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :loading="isSearching || isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="displayedTotalRecords"
          page-label="contacts"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
        />
      </template>
    </DataTable>
  </BasePanel>

  <DrawerContactInfo
    v-model:visible="contactDrawerVisible"
    :contact="contactDrawerData"
    :business-partner-id="businessPartnerId"
    :customer-group="customerGroup"
    :addresses="addresses"
    :default-sales-contact-junction-id="defaultSalesContactJunctionId"
    :default-billing-contact-junction-id="defaultBillingContactJunctionId"
    :is-first-contact="totalRecords === 0"
    @saved="handleSaved"
  />

</template>

<style scoped>
:deep(.p-datatable-tbody > tr > td) {
    cursor: default;
}

/* Centre the order column's sort icon over the drag handle below it (the body
   handle is centred, so the header icon must be too). */
:deep(.p-datatable-thead > tr > th:first-child .p-datatable-column-header-content) {
    justify-content: center;
}

/* PrimeVue renders the drag handle (`row-reorder-icon`) itself, so scoped icon
   classes can't reach it — style its handle class directly to match the gray
   reorder grip used by the addresses table. */
:deep(.p-datatable-reorderable-row-handle) {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-500);
    cursor: grab;
}

:deep(.p-datatable-reorderable-row-handle:active) {
    cursor: grabbing;
}

.section-contacts__utility-cell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
}

.section-contacts__default-star {
    font-size: var(--p-font-size-sm);
    color: var(--p-yellow-500);
}

.section-contacts__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-contacts__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

:deep(.section-contacts__add .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

:deep(.section-contacts__add.p-button) {
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

.section-contacts__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-contacts__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-contacts__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

.section-contacts__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

:deep(.section-contacts__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}

/* Tuck the active-count badge into the filter button's corner instead of
   overflowing outward, so it never crowds the adjacent Add button. */
:deep(.filter-toolbar__filter-badge--inline .p-badge) {
    inset-block-start: -10px;
    inset-inline-end: -5px;
    transform: none;
}
</style>
