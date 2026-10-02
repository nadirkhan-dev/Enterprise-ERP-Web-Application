import { defineStore } from 'pinia'
import { useTableStateStore } from '~/stores/tableState'
import {
  UNASSIGNED_ACCOUNT_MANAGER,
  UNASSIGNED_ACCOUNT_MANAGER_ID,
  type AccountManagerOption,
} from '~/config/accountManagers'
import { useDirectusUsers } from '~/composables/useDirectusUsers'
import { useBusinessPartnerGroups } from '~/composables/useBusinessPartnerGroups'

export const CUSTOMER_DEFAULT_SORT_FIELD = 'account_number'
// Descending, so the newest accounts lead the list: the page opens on
// something that changes as accounts are added, rather than the same
// first row every time (CONNECT-1064).
export const CUSTOMER_DEFAULT_SORT_ORDER = -1

export type { AccountManagerOption } from '~/config/accountManagers'

export interface BusinessPartnerGroupOption {
  id: number
  name: string
}

interface CustomerFilterState {
  selectedStatuses: string[]
  selectedAccountManagerIds: string[]
  selectedBusinessPartnerGroupIds: number[]
  isNationalAccountOnly: boolean
  sortField: string
  sortOrder: number
  accountManagers: AccountManagerOption[]
  isAccountManagersLoading: boolean
  accountManagersLoaded: boolean
  businessPartnerGroups: BusinessPartnerGroupOption[]
  isBusinessPartnerGroupsLoading: boolean
  businessPartnerGroupsLoaded: boolean
  // Persisted flag — true once resetToDefaults has run for this browser.
  // Lets the list page apply dynamic defaults (e.g. current user as
  // account-manager filter) on first visit only, so subsequent reloads
  // don't clobber user-cleared filter state.
  hasInitializedDefaults: boolean
}

export const useCustomerFilterStore = defineStore('customerFilter', {
  state: (): CustomerFilterState => ({
    selectedStatuses: [],
    selectedAccountManagerIds: [],
    selectedBusinessPartnerGroupIds: [],
    isNationalAccountOnly: false,
    sortField: CUSTOMER_DEFAULT_SORT_FIELD,
    sortOrder: CUSTOMER_DEFAULT_SORT_ORDER,
    accountManagers: [],
    isAccountManagersLoading: false,
    accountManagersLoaded: false,
    businessPartnerGroups: [],
    isBusinessPartnerGroupsLoading: false,
    businessPartnerGroupsLoaded: false,
    hasInitializedDefaults: false,
  }),

  getters: {
    totalFilterCount: (state): number =>
      state.selectedStatuses.length
      + state.selectedAccountManagerIds.length
      + state.selectedBusinessPartnerGroupIds.length
      + (state.isNationalAccountOnly ? 1 : 0),

    /**
     * What the Account Manager filter actually offers: the real managers plus the
     * "Unassigned" pseudo-user, so the team can see the accounts nobody owns.
     * Empty until the managers land, so the list doesn't flash a lone "Unassigned"
     * next to the loading spinner.
     */
    accountManagerOptions: (state): AccountManagerOption[] =>
      state.accountManagersLoaded
        ? [...state.accountManagers, UNASSIGNED_ACCOUNT_MANAGER]
        : [],

    getAccountManagerById(state) {
      return (id: string): AccountManagerOption | undefined => {
        // Resolved without waiting on the user fetch, so a filter chip restored from
        // the URL renders as "Unassigned" immediately rather than being dropped.
        if (id === UNASSIGNED_ACCOUNT_MANAGER_ID) { return UNASSIGNED_ACCOUNT_MANAGER }
        return state.accountManagers.find((manager) => manager.id === id)
      }
    },

    getBusinessPartnerGroupById(state) {
      return (id: number): BusinessPartnerGroupOption | undefined =>
        state.businessPartnerGroups.find((group) => group.id === id)
    },
  },

  actions: {
    setStatuses(values: string[]): void {
      this.selectedStatuses = [...values]
      useTableStateStore().clearTableState('/customers')
    },

    setAccountManagerIds(values: string[]): void {
      this.selectedAccountManagerIds = [...values]
      useTableStateStore().clearTableState('/customers')
    },

    setBusinessPartnerGroupIds(values: number[]): void {
      this.selectedBusinessPartnerGroupIds = [...values]
      useTableStateStore().clearTableState('/customers')
    },

    setNationalAccountOnly(value: boolean): void {
      this.isNationalAccountOnly = value
      useTableStateStore().clearTableState('/customers')
    },

    setSort(field: string | null, order: number | null): void {
      this.sortField = field || CUSTOMER_DEFAULT_SORT_FIELD
      this.sortOrder = field ? (order ?? CUSTOMER_DEFAULT_SORT_ORDER) : CUSTOMER_DEFAULT_SORT_ORDER
      useTableStateStore().clearTableState('/customers')
    },

    clearAll(): void {
      this.selectedStatuses = []
      this.selectedAccountManagerIds = []
      this.selectedBusinessPartnerGroupIds = []
      this.isNationalAccountOnly = false
      useTableStateStore().clearTableState('/customers')
    },

    resetToDefaults(): void {
      // Both the status and account-manager filters start OFF for everyone —
      // Account Managers used to default to their own accounts, and the list
      // used to open on Active only. Both stay selectable in the filter; only
      // the initial state is unfiltered.
      this.selectedStatuses = []
      this.selectedAccountManagerIds = []
      this.selectedBusinessPartnerGroupIds = []
      this.isNationalAccountOnly = false
      this.sortField = CUSTOMER_DEFAULT_SORT_FIELD
      this.sortOrder = CUSTOMER_DEFAULT_SORT_ORDER
      this.hasInitializedDefaults = true
    },

    async ensureAccountManagersLoaded(): Promise<void> {
      if (this.accountManagersLoaded || this.isAccountManagersLoading) { return }

      this.isAccountManagersLoading = true
      const { fetchAccountManagers } = useDirectusUsers()
      const { data, error } = await fetchAccountManagers()

      if (error || !data) {
        this.isAccountManagersLoading = false
        return
      }

      this.accountManagers = data.map((user) => ({
        id: user.id,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Unnamed',
        avatarId: user.avatar ?? null,
      }))
      this.accountManagersLoaded = true
      this.isAccountManagersLoading = false
    },

    async ensureBusinessPartnerGroupsLoaded(): Promise<void> {
      if (this.businessPartnerGroupsLoaded || this.isBusinessPartnerGroupsLoading) { return }

      this.isBusinessPartnerGroupsLoading = true
      const { fetchBusinessPartnerGroups } = useBusinessPartnerGroups()
      const { data, error } = await fetchBusinessPartnerGroups({ relationshipType: 'customer' })

      if (error || !data) {
        this.isBusinessPartnerGroupsLoading = false
        return
      }

      this.businessPartnerGroups = data.map((group) => ({ id: group.id, name: group.name }))
      this.businessPartnerGroupsLoaded = true
      this.isBusinessPartnerGroupsLoading = false
    },
  },

  // sessionStorage (not localStorage): filters default fresh each session, keep
  // within-session edits, and reset to defaults on tab-close / logout / login.
  persist: {
    storage: piniaPluginPersistedstate.sessionStorage(),
    pick: [
      'selectedStatuses',
      'selectedAccountManagerIds',
      'selectedBusinessPartnerGroupIds',
      'isNationalAccountOnly',
      'sortField',
      'sortOrder',
      'hasInitializedDefaults',
    ],
    // Migrate a sort persisted before the `sap_id` → `account_number` rename;
    // the old value would sort on a dropped column.
    afterHydrate: (context) => {
      // CONNECT-1064: sessions persisted while the list still opened ascending
      // carry that order and would keep it until the next sign-in, since
      // resetToDefaults only runs for a session that has never initialised.
      // Move exactly the old default across; a sort the user chose themselves —
      // another field, or a direction they picked — is left alone.
      if (context.store.sortField === CUSTOMER_DEFAULT_SORT_FIELD && context.store.sortOrder === 1) {
        context.store.sortOrder = CUSTOMER_DEFAULT_SORT_ORDER
      }
      if (context.store.sortField === 'sap_id') {
        context.store.sortField = CUSTOMER_DEFAULT_SORT_FIELD
      }
    },
  },
})
