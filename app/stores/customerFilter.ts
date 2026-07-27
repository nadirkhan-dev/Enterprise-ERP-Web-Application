import { defineStore } from 'pinia'
import { useTableStateStore } from '~/stores/tableState'
import {
  UNASSIGNED_ACCOUNT_MANAGER,
  UNASSIGNED_ACCOUNT_MANAGER_ID,
  type AccountManagerOption,
} from '~/config/accountManagers'
import { useDirectusUsers } from '~/composables/useDirectusUsers'
import { useBusinessPartnerGroups } from '~/composables/useBusinessPartnerGroups'
import { useAssetUrl } from '~/composables/useAssetUrl'

const DEFAULT_SORT_FIELD = 'account_number'
const DEFAULT_SORT_ORDER = 1

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
    sortField: DEFAULT_SORT_FIELD,
    sortOrder: DEFAULT_SORT_ORDER,
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
      this.sortField = field || DEFAULT_SORT_FIELD
      this.sortOrder = field ? (order ?? DEFAULT_SORT_ORDER) : DEFAULT_SORT_ORDER
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
      this.sortField = DEFAULT_SORT_FIELD
      this.sortOrder = DEFAULT_SORT_ORDER
      this.hasInitializedDefaults = true
    },

    async ensureAccountManagersLoaded(): Promise<void> {
      if (this.accountManagersLoaded || this.isAccountManagersLoading) { return }

      this.isAccountManagersLoading = true
      const { fetchAccountManagers } = useDirectusUsers()
      const { getAssetUrl } = useAssetUrl()
      const { data, error } = await fetchAccountManagers()

      if (error || !data) {
        this.isAccountManagersLoading = false
        return
      }

      const urls = await Promise.all(
        data.map((user) => getAssetUrl(user.avatar, { width: 56, height: 56, fit: 'cover', quality: 80, format: 'auto' })),
      )
      this.accountManagers = data.map((user, index) => ({
        id: user.id,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Unnamed',
        avatarUrl: urls[index],
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
      if (context.store.sortField === 'sap_id') {
        context.store.sortField = DEFAULT_SORT_FIELD
      }
    },
  },
})
