<script setup lang="ts">
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'
import { useCustomerFilterStore } from '~/stores/customerFilter'
import { useAuthStore } from '~/stores/auth'

useHead({ title: 'Customers' })

const tableRef = ref(null)
const { showFooterShadow } = useTableFooterShadow(tableRef)

const searchStore = useSearchStore()
const tableStateStore = useTableStateStore()
const filterStore = useCustomerFilterStore()
const authStore = useAuthStore()
const toast = useToast()
const { handleNoResults } = useScopeResultsSearch()

interface FilterChip {
  key: string
  label: string
  remove: () => void
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
}

const activeFilterChips = computed<FilterChip[]>(() => {
  const chips: FilterChip[] = []

  filterStore.selectedStatuses.forEach((statusValue) => {
    chips.push({
      key: `status-${statusValue}`,
      label: STATUS_LABELS[statusValue] ?? statusValue,
      remove: () => filterStore.setStatuses(
        filterStore.selectedStatuses.filter((value) => value !== statusValue),
      ),
    })
  })

  filterStore.selectedAccountManagerIds.forEach((managerId) => {
    const isCurrentUser = authStore.user?.id === managerId
    const selfName = isCurrentUser ? authStore.fullName : ''
    const manager = filterStore.getAccountManagerById(managerId)
    if (!isCurrentUser && !manager) return

    chips.push({
      key: `manager-${managerId}`,
      label: selfName || manager?.name || '',
      remove: () => filterStore.setAccountManagerIds(
        filterStore.selectedAccountManagerIds.filter((value) => value !== managerId),
      ),
    })
  })

  filterStore.selectedBusinessPartnerGroupIds.forEach((groupId) => {
    const group = filterStore.getBusinessPartnerGroupById(groupId)
    // Same defer-until-loaded pattern as account managers above.
    if (!group) return
    chips.push({
      key: `group-${groupId}`,
      label: group.name,
      remove: () => filterStore.setBusinessPartnerGroupIds(
        filterStore.selectedBusinessPartnerGroupIds.filter((value) => value !== groupId),
      ),
    })
  })

  if (filterStore.isNationalAccountOnly) {
    chips.push({
      key: 'national-account',
      label: 'National Customers',
      remove: () => filterStore.setNationalAccountOnly(false),
    })
  }

  return chips
})

// Apply dynamic defaults (e.g. the current user as the account-manager filter)
// on the first-ever visit — guarded by the persisted `hasInitializedDefaults`
// flag so it runs exactly once and never resurrects filters the user cleared.
// Gated on `import.meta.client` (not `isHydrating`) because the default depends
// on the logged-in user, who isn't known during SSR — and because the page can
// be reached by SPA navigation, where `isHydrating` is false. Using
// `isHydrating` here meant arriving via in-app navigation skipped the defaults
// until a manual refresh.
if (import.meta.client && !filterStore.hasInitializedDefaults) {
  filterStore.resetToDefaults()
}

if (useNuxtApp().isHydrating) {
  tableStateStore.clearTableState('/customers')
}

// Mirror resetToDefaults: the account-manager filter starts OFF (unfiltered) for
// everyone. This is the URL-sync default, so an absent `account_manager_id` param
// resolves to "no filter" rather than the current user.
const defaultAccountManagerIds: string[] = []

useUrlSyncedListState({
  status: {
    get: () => filterStore.selectedStatuses,
    set: (value: string[]) => filterStore.setStatuses(value),
    defaultValue: [],
    parse: (raw) => {
      if (raw === '') return []
      return raw.split(',').filter((value) => value === 'active' || value === 'inactive')
    },
    serialize: (value: string[]) => (value.length ? value.join(',') : null),
  },
  account_manager_id: {
    get: () => filterStore.selectedAccountManagerIds,
    set: (value: string[]) => filterStore.setAccountManagerIds(value),
    defaultValue: defaultAccountManagerIds,
    parse: (raw) => {
      if (raw === '') return []
      return raw.split(',').filter(Boolean)
    },
    serialize: (value: string[]) => (value.length ? value.join(',') : null),
  },
  business_partner_groups_id: {
    get: () => filterStore.selectedBusinessPartnerGroupIds,
    set: (value: number[]) => filterStore.setBusinessPartnerGroupIds(value),
    defaultValue: [],
    parse: (raw) => {
      if (raw === '') return []
      return raw.split(',').map(Number).filter((value) => Number.isFinite(value) && value > 0)
    },
    serialize: (value: number[]) => (value.length ? value.join(',') : null),
  },
  is_national_account: {
    get: () => filterStore.isNationalAccountOnly,
    set: (value: boolean) => filterStore.setNationalAccountOnly(value),
    defaultValue: false,
    parse: (raw) => raw === '1' || raw === 'true',
    serialize: (value: boolean) => (value ? '1' : null),
  },
  sort: {
    get: () => ({ field: filterStore.sortField, order: filterStore.sortOrder }),
    set: ({ field, order }: { field: string; order: number }) => filterStore.setSort(field, order),
    defaultValue: { field: 'account_number', order: 1 },
    parse: (raw) => {
      if (!raw) return undefined
      if (raw.startsWith('-')) return { field: raw.slice(1), order: -1 }
      return { field: raw, order: 1 }
    },
    serialize: ({ field, order }) => {
      if (!field) return null
      if (field === 'account_number' && order === 1) return null
      return order === -1 ? `-${field}` : field
    },
  },
})

const customers = ref<Record<string, any>[]>([])
const totalRecords = ref(0)
const isLoading = ref(true)
const hasLoadError = ref(false)
const { showLoader } = useDeferredLoading(isLoading)

const currentPage = ref(1)
const hasMore = ref(true)
const isLoadingMore = ref(false)
const rowsPerPage = 46

const skeletonRows = Array.from({ length: rowsPerPage }, (_, index) => ({
  id: `skeleton-${index}`,
  _skeleton: true,
}))

// `account_number` is appended as a tiebreaker so the order stays deterministic — the
// detail-page Next/Prev window relies on matching this exact ordering.
function buildSortParam() {
  return buildCustomerSort(filterStore.sortField, filterStore.sortOrder)
}

function handleSort(event: any) {
  filterStore.setSort(event.sortField ?? null, event.sortOrder ?? null)
  currentPage.value = 1
  hasMore.value = true
  loadCustomers(1, searchStore.searchQuery)
}

const drawerVisible = ref(false)
const activeContacts = ref<Record<string, any>[]>([])
const activeCustomer = ref<Record<string, any> | null>(null)
const activeTotalCount = ref(0)

const CUSTOMER_LIST_FIELDS = [
  'id',
  'account_number',
  'name',
  'website',
  'status',
  'business_partner_groups_id.name',
  'addresses.id',
  'addresses.is_billing_address',
  'addresses.addresses_id.city',
  'addresses.addresses_id.regions_id.name',
  'contacts.id',
  'contacts.contacts_sort',
  'contacts.status',
  'contacts.contacts_id.id',
  'contacts.contacts_id.first_name',
  'contacts.contacts_id.last_name',
  'contacts.contacts_id.job_title',
  'contacts.contacts_id.email_address',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.number',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.extension',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.phone_code',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.code',
  'default_sales_business_partners_contacts_id.id',
  'default_billing_business_partners_contacts_id.id',
]

const { fetchBusinessPartners, fetchBusinessPartnerCount, fetchBusinessPartnerByAccountNumber, reorderPartnerContacts, updateBusinessPartner } =
    useBusinessPartners()

// Exact account-number searches bypass filters and jump straight to the
// customer's detail page so active filters can never hide an exact match.
const { redirectIfExactKey } = useExactKeySearch(async (term) => {
  const { data, error } = await fetchBusinessPartnerByAccountNumber(term)
  if (error || !data || data.relationship_type !== 'customer') {
    return null
  }
  // Prefer the SAP id; fall back to the Directus id for new customers that
  // haven't been assigned a SAP id yet. The detail route resolves either.
  return `/customers/${data.account_number || data.id}`
})

// Cross-entity exact match: if search term is an exact key for a different
// entity type (e.g., Item SKU while on Customers list), redirect there.
const { redirectIfCrossScopeMatch } = useCrossScopeExactMatch()

let loadRequestId = 0
let tailRequestId = 0
let isInitialMount = true

async function loadCustomers(page = 1, search: string | null = null) {
  const currentRequestId = ++loadRequestId
  const searchTerm = search || null

  if (page === 1) {
    isLoading.value = true
    hasLoadError.value = false
    customers.value = []
    totalRecords.value = 0
  } else {
    isLoadingMore.value = true
  }

  // An exact account-number search takes precedence over active filters so
  // the matching customer is never filtered out of the results.
  const bypassFilters = !!searchTerm && isExactKeySearch(searchTerm)
  const statusValues = !bypassFilters && filterStore.selectedStatuses.length
    ? [...filterStore.selectedStatuses]
    : null
  const accountManagerIds = !bypassFilters && filterStore.selectedAccountManagerIds.length
    ? [...filterStore.selectedAccountManagerIds]
    : null
  const businessPartnerGroupIds = !bypassFilters && filterStore.selectedBusinessPartnerGroupIds.length
    ? [...filterStore.selectedBusinessPartnerGroupIds]
    : null
  const isNationalAccountOnly = !bypassFilters && filterStore.isNationalAccountOnly

  const [listResult, countResult] = await Promise.all([
    fetchBusinessPartners({
      relationshipType: 'customer',
      fields: CUSTOMER_LIST_FIELDS,
      deep: { contacts: { _limit: -1 } },
      limit: rowsPerPage,
      page,
      search: searchTerm,
      sort: buildSortParam(),
      statusValues,
      accountManagerIds,
      businessPartnerGroupIds,
      isNationalAccountOnly,
    }),
    page === 1
      ? fetchBusinessPartnerCount({
        relationshipType: 'customer',
        search: searchTerm,
        statusValues,
        accountManagerIds,
        businessPartnerGroupIds,
        isNationalAccountOnly,
      })
      : Promise.resolve(null),
  ])

  if (currentRequestId !== loadRequestId) {
    return
  }

  if (!listResult.error) {
    if (page === 1) {
      customers.value = listResult.data
    } else {
      customers.value = [...customers.value, ...listResult.data]
    }
    hasMore.value = listResult.data.length === rowsPerPage
  } else if (page === 1 && isServerError(listResult.error)) {
    hasLoadError.value = true
  }
  if (countResult && !countResult.error) {
    totalRecords.value = countResult.data
  }

  isLoading.value = false
  isLoadingMore.value = false
  currentPage.value = page
  searchStore.setResultCount(customers.value.length)

  if (page === 1 && !hasLoadError.value && customers.value.length === 0 && searchStore.searchQuery) {
    handleNoResults('customers', searchStore.searchQuery)
  }
}

// Pre-warm the navigation TAIL in the background: the last rows of the current
// filtered/sorted sequence, fetched once under the reversed sort (id only) and
// stashed in tableState. The customer detail page seeds its tail segment from
// this, so Previous on the first customer — the wrap to the LAST customer — is
// instant instead of waiting on a round-trip. Skipped when a matching tail is
// already warm, or for an exact-key search (which redirects straight to detail).
async function prefetchTail() {
  const currentTailRequestId = ++tailRequestId
  const searchTerm = searchStore.searchQuery || null
  if (searchTerm && isExactKeySearch(searchTerm)) { return }

  const search = searchStore.searchQuery || ''
  const sortField = filterStore.sortField
  const sortOrder = filterStore.sortOrder

  const existing = tableStateStore.getTailState('/customers')
  if (existing
    && existing.searchQuery === search
    && existing.sortField === sortField
    && existing.sortOrder === sortOrder) {
    return
  }

  const { data, error } = await fetchBusinessPartners({
    relationshipType: 'customer',
    fields: ['account_number', 'name'],
    sort: reverseSort(buildSortParam()),
    statusValues: filterStore.selectedStatuses.length
      ? [...filterStore.selectedStatuses] : null,
    accountManagerIds: filterStore.selectedAccountManagerIds.length
      ? [...filterStore.selectedAccountManagerIds] : null,
    businessPartnerGroupIds: filterStore.selectedBusinessPartnerGroupIds.length
      ? [...filterStore.selectedBusinessPartnerGroupIds] : null,
    isNationalAccountOnly: filterStore.isNationalAccountOnly,
    search: searchTerm,
    limit: TAIL_PREFETCH_SIZE,
    page: 1,
  })
  // Discard if a newer prefetch (filter/sort/search change) superseded this one.
  if (currentTailRequestId !== tailRequestId || error || !data) { return }

  // Fetched descending; store forward order so the nav store uses it directly.
  tableStateStore.saveTailState('/customers', {
    rows: [...data].reverse(),
    reachedStart: data.length < TAIL_PREFETCH_SIZE,
    sortField,
    sortOrder,
    searchQuery: search,
  })
}

function handleScroll(event: Event) {
  const container = event.target as HTMLElement
  const threshold = 100
  const nearBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <
        threshold
  if (
    nearBottom &&
        hasMore.value &&
        !isLoadingMore.value &&
        !isLoading.value
  ) {
    loadCustomers(currentPage.value + 1, searchStore.searchQuery)
  }
}

function getDefaultBillingAddress(customer: Record<string, any>) {
  const billingJunction = customer.addresses?.find(
    (junction) => junction.is_billing_address,
  )
  return billingJunction?.addresses_id ?? null
}

function openContactsDrawer(customer: Record<string, any>) {
  const defaultSalesJunctionId = customer.default_sales_business_partners_contacts_id?.id ?? null
  const defaultBillingJunctionId = customer.default_billing_business_partners_contacts_id?.id ?? null
  const flatContacts = (customer.contacts ?? [])
    .filter((junction) => junction.contacts_id)
    .map((junction) => ({
      ...junction.contacts_id,
      // Active/inactive status is a junction-level field (per business-partner
      // relationship), not a property of the shared contact record.
      status: junction.status,
      junctionId: junction.id,
      contactsSort: junction.contacts_sort ?? null,
      isDefaultSalesContact: junction.id === defaultSalesJunctionId,
      isDefaultBillingContact: junction.id === defaultBillingJunctionId,
    }))
  activeCustomer.value = customer
  activeContacts.value = flatContacts
  activeTotalCount.value = flatContacts.length
  drawerVisible.value = true
}

function rowClass(rowData: Record<string, any>): string {
  if (rowData._skeleton) { return 'skeleton-row' }
  if (drawerVisible.value && activeCustomer.value && rowData.id === activeCustomer.value.id) {
    return 'customers-table__row--active-drawer'
  }
  return ''
}

async function handleContactsReorder(reordered: Record<string, any>[]) {
  activeContacts.value = reordered
  const orderedRows = reordered.map((contact) => ({
    id: contact.junctionId,
    currentSort: contact.contactsSort ?? null,
  }))
  const { error } = await reorderPartnerContacts(orderedRows)
  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Could not save the new contact order.',
      life: 3000,
    })
    return
  }
  reordered.forEach((contact, index) => { contact.contactsSort = index })
  const junctions = activeCustomer.value?.contacts
  if (Array.isArray(junctions)) {
    const junctionById = new Map(junctions.map((junction) => [junction.id, junction]))
    const nextOrder = reordered
      .map((contact) => junctionById.get(contact.junctionId))
      .filter(Boolean)
    junctions.splice(0, junctions.length, ...nextOrder)
  }
}

// Persist a default sales/billing contact chosen in the view-contact drawer.
// `junctionId` is the contact junction id (or null to clear). Mirrors how the
// Account Information drawer writes these pointers.
async function handleSetDefaultContact(payload: { type: 'sales' | 'billing'; junctionId: number | null }) {
  const customerId = activeCustomer.value?.id
  if (!customerId) { return }

  const field = payload.type === 'sales'
    ? 'default_sales_business_partners_contacts_id'
    : 'default_billing_business_partners_contacts_id'

  const { error } = await updateBusinessPartner(customerId, { [field]: payload.junctionId })
  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: `Could not update the default ${payload.type} contact.`,
      life: 3000,
    })
    return
  }

  // Re-flag the contacts so the star and the drawer's selects reflect the new
  // default, and update the cached customer pointer so reopening stays correct.
  activeContacts.value = activeContacts.value.map((contact) => ({
    ...contact,
    isDefaultSalesContact: payload.type === 'sales'
      ? contact.junctionId === payload.junctionId
      : contact.isDefaultSalesContact,
    isDefaultBillingContact: payload.type === 'billing'
      ? contact.junctionId === payload.junctionId
      : contact.isDefaultBillingContact,
  }))
  if (activeCustomer.value) {
    const pointer = payload.junctionId ? { id: payload.junctionId } : null
    activeCustomer.value[field] = pointer
  }
}

const {
  handleRowClick,
  handleRowContextMenu,
  contextMenuRef,
  contextMenuItems,
} = useRowNavigation((rowData) => `/customers/${rowData.account_number || rowData.id}`)

const enrichedCustomers = computed(() =>
  customers.value.map((customer): Record<string, any> => ({
    ...customer,
    _billingAddress: getDefaultBillingAddress(customer),
    _contactCount: customer.contacts?.length ?? 0,
  })),
)

const filteredCustomers = computed(() => {
  if (showLoader.value) {return skeletonRows}
  const term = searchStore.filterText.toLowerCase()
  if (!term) {
    return enrichedCustomers.value
  }

  return enrichedCustomers.value.filter((customer) => {
    const searchableValues = [
      customer.account_number,
      customer.name,
      customer.status,
      customer.business_partner_groups_id?.name,
      customer._billingAddress?.city,
      customer._billingAddress?.regions_id?.name,
    ]
    return searchableValues.some(
      (value) => value && String(value).toLowerCase().includes(term),
    )
  })
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(tableRef, computed(() => filteredCustomers.value.length))

const sortFieldRef = computed(() => filterStore.sortField)
const sortOrderRef = computed(() => filterStore.sortOrder)

const { hasCachedState, saveBeforeLeave, restoreScrollPosition } =
  useTableStateRestore('/customers', {
    rows: customers,
    currentPage,
    hasMore,
    totalRecords,
    sortField: sortFieldRef,
    sortOrder: sortOrderRef,
    isLoading,
  }, tableRef)

watch(
  () => searchStore.searchQuery,
  async (query) => {
    tableStateStore.clearTableState('/customers')
    currentPage.value = 1
    hasMore.value = true
    // Only redirect on user-initiated searches, not on mount/restore
    if (!isInitialMount) {
      if (query && await redirectIfExactKey(query)) {
        return
      }
      if (query && await redirectIfCrossScopeMatch(query)) {
        return
      }
    }
    loadCustomers(1, query)
    prefetchTail()
  },
)

watch(
  [
    () => filterStore.selectedStatuses,
    () => filterStore.selectedAccountManagerIds,
    () => filterStore.selectedBusinessPartnerGroupIds,
    () => filterStore.isNationalAccountOnly,
  ],
  () => {
    tableStateStore.clearTableState('/customers')
    currentPage.value = 1
    hasMore.value = true
    loadCustomers(1, searchStore.searchQuery)
    prefetchTail()
  },
  { deep: true },
)

onMounted(() => {
  filterStore.ensureAccountManagersLoaded()
  filterStore.ensureBusinessPartnerGroupsLoaded()

  if (!hasCachedState.value) {
    loadCustomers(1, searchStore.searchQuery)
  }
  // Warm the tail regardless of head cache state (it self-skips when already
  // warm), so returning to the list also refreshes a stale/expired tail.
  prefetchTail()

  const container =
        tableRef.value?.$el?.querySelector('.p-virtualscroller') ||
        tableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.addEventListener('scroll', handleScroll)
  }

  if (hasCachedState.value) {
    restoreScrollPosition()
  }

  isInitialMount = false
})

onBeforeRouteLeave(() => {
  saveBeforeLeave()
})

onUnmounted(() => {
  const container =
        tableRef.value?.$el?.querySelector('.p-virtualscroller') ||
        tableRef.value?.$el?.querySelector('.p-datatable-table-container')
  if (container) {
    container.removeEventListener('scroll', handleScroll)
  }
})
</script>

<template>
  <div class="customers-page">
    <div
      v-if="!hasLoadError"
      class="customers-page__header"
    >
      <h1 class="customers-page__title">Customers</h1>
      <BaseFilterChips
        :chips="activeFilterChips"
        class="customers-page__chips-row"
      />
      <div class="customers-page__header-actions">
        <CustomerToolbar />
        <NuxtLink to="/customers/create">
          <Button
            label="New"
            icon="pi pi-plus"
            size="small"
          />
        </NuxtLink>
      </div>
    </div>

    <Error500 v-if="hasLoadError" />

    <div
      v-else
      class="customers-card"
    >
      <DataTable
        ref="tableRef"
        class="customers-table is-row-clickable"
        :value="filteredCustomers"
        data-key="id"
        lazy
        removable-sort
        row-hover
        scrollable
        scroll-height="max(calc(100dvh - var(--list-table-offset, 230px)), 218px)"
        :virtual-scroller-options="{itemSize: 46}"
        :sort-field="filterStore.sortField"
        :sort-order="filterStore.sortOrder"
        :row-class="rowClass"
        @sort="handleSort"
        @row-click="handleRowClick"
        @row-contextmenu="handleRowContextMenu"
      >
        <Column
          field="account_number"
          header="Account"
          sortable
          style="width: clamp(140px, 11vw, 150px); min-width: 140px"
        >
          <template #body="{data: customer}">
            <div
              v-if="customer._skeleton"
              class="skeleton-block"
            />
            <BaseCopyText
              v-else
              :value="customer.account_number"
              label-color="var(--p-gray-800)"
              class="account-copy"
            />
          </template>
        </Column>

        <Column
          field="name"
          header="Company Name"
          sortable
          style="width: 320px; min-width: 320px"
        >
          <template #body="{data: customer}">
            <div
              v-if="customer._skeleton"
              class="skeleton-block"
            />
            <span
              v-else
              class="company-name-cell"
            >
              <BaseWebsiteLink
                :website="customer.website"
                :name="customer.name"
              />
              <span class="company-name-cell__text">{{ customer.name }}</span>
            </span>
          </template>
        </Column>

        <Column
          field="status"
          header="Status"
          sortable
          style="width: 100px; min-width: 100px"
        >
          <template #body="{data: customer}">
            <div
              v-if="customer._skeleton"
              class="skeleton-block"
            />
            <Tag
              v-else
              :value="formatStatus(customer.status)"
              :class="
                customer.status === 'active'
                  ? 'status-active'
                  : 'status-inactive'
              "
            />
          </template>
        </Column>

        <Column
          field="business_partner_groups_id.name"
          header="Customer Group"
          sortable
          style="min-width: 180px"
        >
          <template #body="{data: customer}">
            <div
              v-if="customer._skeleton"
              class="skeleton-block"
            />
            <template v-else>
              {{ customer.business_partner_groups_id?.name }}
            </template>
          </template>
        </Column>

        <Column
          field="addresses.addresses_id.city"
          header="Bill to City"
          sortable
          style="min-width: 150px"
        >
          <template #body="{data: customer}">
            <div
              v-if="customer._skeleton"
              class="skeleton-block"
            />
            <template v-else>
              {{ customer._billingAddress?.city }}
            </template>
          </template>
        </Column>

        <Column
          field="addresses.addresses_id.regions_id.name"
          header="Bill to State"
          sortable
          style="min-width: 130px"
        >
          <template #body="{data: customer}">
            <div
              v-if="customer._skeleton"
              class="skeleton-block"
            />
            <template v-else>
              {{ customer._billingAddress?.regions_id?.name }}
            </template>
          </template>
        </Column>

        <!-- Contacts — drawer trigger -->
        <Column
          header="Contacts"
          style="min-width: 150px;"
        >
          <template #body="{data: customer}">
            <div
              v-if="customer._skeleton"
              class="skeleton-block"
            />
            <Button
              v-else-if="customer._contactCount"
              text
              class="contacts-btn"
              @click.stop="openContactsDrawer(customer)"
            >
              <span class="contacts-btn__count">
                {{ customer._contactCount.toLocaleString() }} contacts
              </span>
              <i class="pi pi-ellipsis-h contacts-btn__icon" />
            </Button>
          </template>
        </Column>

        <!-- Row itself opens the customer (clickable row); the frozen column
             remains for horizontal scroll navigation only. -->
        <BaseFrozenColumn
          key="frozen"
          scrollable-only
          :table-ref="tableRef"
          :actions="[]"
        />

        <template #footer>
          <BaseDataTableFooterLoader
            :loading="isLoadingMore"
            :first-row="firstVisibleRow"
            :last-row="lastVisibleRow"
            :total-records="totalRecords"
            :show-shadow="showFooterShadow"
            :filter-text="searchStore.filterText"
            empty-msg="No results found"
            page-label="customers"
          />
        </template>
      </DataTable>
      <ContextMenu
        ref="contextMenuRef"
        :model="contextMenuItems"
      />
    </div>

    <DrawerViewContactInfo
      v-model:visible="drawerVisible"
      :contacts="activeContacts"
      title="Contact Information"
      @reorder="handleContactsReorder"
      @set-default="handleSetDefaultContact"
    />
  </div>
</template>

<style scoped>
.customers-page {
    --list-table-offset: 260px;

    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: 0;
    margin-bottom: calc(-1 * var(--p-spacing-4));

    @media (min-width: 768px) {
        --list-table-offset: 230px;
    }
}

.customers-page__header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
        "title actions"
        "chips chips";
    column-gap: clamp(var(--p-spacing-2), 2vw, var(--p-spacing-4));
    row-gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
    align-items: center;

    @media (min-width: 768px) {
        grid-template-columns: auto minmax(0, 1fr) auto;
        grid-template-areas: "title chips actions";
        margin-top: 0;
    }
}

.customers-page__title {
    grid-area: title;
}

.customers-page__chips-row {
    grid-area: chips;
}

.customers-page__header-actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
}

h1 {
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-spacing-8);
    margin: 0;
}

.account-copy {
    color: var(--p-gray-500);
}

.customers-card {
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-sm);
    overflow: hidden;
    padding: var(--p-spacing-4) clamp(var(--p-spacing-2), 2vw, var(--p-spacing-4));
}

:deep(.customers-table.p-datatable) {
    min-height: 218px;
}

:deep(.customers-table .p-datatable-table-container),
:deep(.customers-table .p-virtualscroller) {
    min-height: 218px;
}

/* Row hover is the clickable affordance — the whole row navigates, so it tints
   deepblue-50 (Figma #e8f2f9) instead of the framework-default neutral gray.
   Applied on the cells (not the row) to mirror the --active-drawer override and
   sit above PrimeVue's tr-level hover token. */
:deep(.customers-table .p-datatable-tbody > tr:hover > td) {
    background-color: var(--p-deepblue-50);
}

/* Exception: when the pointer is over a specific control in the row (the Contacts
   pill, or any icon button — copy, globe, row action), that control carries its
   own outlined hover, so the row stays neutral gray (Figma #f3f5f6) rather than
   also lighting up blue. */
:deep(.customers-table .p-datatable-tbody > tr:has(.contacts-btn:hover) > td),
:deep(.customers-table .p-datatable-tbody > tr:has(.base-icon-button:hover) > td) {
    background-color: var(--p-surface-50);
}

/* Customer row the open contacts drawer belongs to — the same deepblue-50
   (Figma #e8f2f9) used for the clickable-row hover, so the highlighted list row
   reads consistently, plus a bold left accent bar on the leading cell that stays
   visible to the left of the drawer. */
:deep(.customers-table .customers-table__row--active-drawer > td) {
    background-color: var(--p-deepblue-50) !important;
}

:deep(.customers-table .customers-table__row--active-drawer > td:first-child) {
    box-shadow: inset var(--p-spacing-1) 0 0 0 var(--p-deepblue-900);
}

/* "N contacts ⋯" — skyblue link text (Figma text/accent #009bd4) that hugs its
   content. On hover it becomes a compact bordered pill: tideblue-50 fill,
   skyblue-200 border, 2px (radius-xs) corners — matching the Figma hover state.
   A transparent 1px border is reserved at rest so the label never shifts. */
:deep(.contacts-btn.p-button) {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
    width: fit-content;
    height: auto;
    padding: 0 0 0 var(--p-spacing-2);
    color: var(--p-primary-500);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-5);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--p-border-radius-xs);
}

:deep(.contacts-btn.p-button:hover) {
    background: var(--p-tideblue-50);
    border-color: var(--p-skyblue-200);
}

.contacts-btn__count {
    white-space: nowrap;
}

/* Ellipsis toggle — a 24px circular footprint mirroring the Figma
   node-toggle-button (24.5px, fully rounded, 14px icon). */
.contacts-btn__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-6);
    height: var(--p-spacing-6);
    border-radius: var(--p-border-radius-full);
    font-size: var(--p-font-size-sm);
}

</style>
