import { defineStore } from 'pinia'
import { useTableStateStore } from '~/stores/tableState'
import { useManufacturers } from '~/composables/useManufacturers'
import { useBusinessPartnerGroups } from '~/composables/useBusinessPartnerGroups'

const DEFAULT_SORT_FIELD = 'account_number'
const DEFAULT_SORT_ORDER = 1

interface ManufacturerOption {
  id: number
  name: string
}

interface SupplierGroupOption {
  id: number
  name: string
}

interface SuppliersFilterState {
  selectedStatuses: string[]
  selectedBusinessPartnerGroupIds: number[]
  selectedManufacturerIds: number[]
  sortField: string
  sortOrder: number
  manufacturers: ManufacturerOption[]
  isManufacturersLoading: boolean
  manufacturersLoaded: boolean
  businessPartnerGroups: SupplierGroupOption[]
  isBusinessPartnerGroupsLoading: boolean
  businessPartnerGroupsLoaded: boolean
  pendingDefaultGroupName: string | null
  // Persisted resolved IDs for the named default groups so the
  // page can default to "Product" synchronously on subsequent visits
  // without waiting for the supplier-groups fetch to resolve.
  cachedProductGroupId: number | null
  // Persisted flag — true once resetToDefaults has run for this browser.
  // Lets the list page apply dynamic defaults (e.g. the "Product" supplier
  // group) on first visit only, so subsequent reloads don't clobber
  // user-cleared filter state.
  hasInitializedDefaults: boolean
}

const PRODUCT_GROUP_NAME = 'Product'
const OPERATING_EXPENSE_GROUP_NAME = 'Operating Expense'

export const useSuppliersFilterStore = defineStore('suppliersFilter', {
  state: (): SuppliersFilterState => ({
    selectedStatuses: [],
    selectedBusinessPartnerGroupIds: [],
    selectedManufacturerIds: [],
    sortField: DEFAULT_SORT_FIELD,
    sortOrder: DEFAULT_SORT_ORDER,
    manufacturers: [],
    isManufacturersLoading: false,
    manufacturersLoaded: false,
    businessPartnerGroups: [],
    isBusinessPartnerGroupsLoading: false,
    businessPartnerGroupsLoaded: false,
    pendingDefaultGroupName: PRODUCT_GROUP_NAME,
    cachedProductGroupId: null,
    hasInitializedDefaults: false,
  }),

  getters: {
    totalFilterCount: (state): number =>
      state.selectedStatuses.length
      + state.selectedBusinessPartnerGroupIds.length
      + state.selectedManufacturerIds.length,

    getManufacturerById(state) {
      return (id: number): ManufacturerOption | undefined =>
        state.manufacturers.find((manufacturer) => manufacturer.id === id)
    },

    getBusinessPartnerGroupById(state) {
      return (id: number): SupplierGroupOption | undefined =>
        state.businessPartnerGroups.find((group) => group.id === id)
    },

    productGroupId: (state): number | null =>
      state.businessPartnerGroups.find((group) => group.name === PRODUCT_GROUP_NAME)?.id ?? null,

    operatingExpenseGroupId: (state): number | null =>
      state.businessPartnerGroups.find((group) => group.name === OPERATING_EXPENSE_GROUP_NAME)?.id ?? null,

    /**
     * True when the current Supplier Group selection is exactly
     * "Operating Expense" (and only that). Used to hide the
     * Manufacturers section in the dropdown.
     */
    isOperatingExpenseOnly(state): boolean {
      const oeId = state.businessPartnerGroups.find((group) => group.name === OPERATING_EXPENSE_GROUP_NAME)?.id ?? null
      if (oeId === null) { return false }
      const selected = state.selectedBusinessPartnerGroupIds
      return selected.length > 0 && selected.every((id) => id === oeId)
    },
  },

  actions: {
    setStatuses(values: string[]): void {
      this.selectedStatuses = [...values]
      useTableStateStore().clearTableState('/suppliers')
    },

    setBusinessPartnerGroupIds(values: number[]): void {
      this.selectedBusinessPartnerGroupIds = [...values]
      useTableStateStore().clearTableState('/suppliers')
    },

    setManufacturerIds(values: number[]): void {
      this.selectedManufacturerIds = [...values]
      useTableStateStore().clearTableState('/suppliers')
    },

    setSort(field: string | null, order: number | null): void {
      this.sortField = field || DEFAULT_SORT_FIELD
      this.sortOrder = field ? (order ?? DEFAULT_SORT_ORDER) : DEFAULT_SORT_ORDER
      useTableStateStore().clearTableState('/suppliers')
    },

    clearAll(): void {
      this.selectedStatuses = []
      this.selectedBusinessPartnerGroupIds = []
      this.selectedManufacturerIds = []
      useTableStateStore().clearTableState('/suppliers')
    },

    resetToDefaults(): void {
      this.selectedStatuses = []
      this.selectedManufacturerIds = []
      this.sortField = DEFAULT_SORT_FIELD
      this.sortOrder = DEFAULT_SORT_ORDER
      // Apply the Product group default synchronously when we already
      // know its ID from a previous visit. Otherwise schedule the
      // pending lookup so ensureBusinessPartnerGroupsLoaded can apply
      // it once the fetch resolves.
      if (this.cachedProductGroupId !== null) {
        this.selectedBusinessPartnerGroupIds = [this.cachedProductGroupId]
        this.pendingDefaultGroupName = null
      } else {
        this.selectedBusinessPartnerGroupIds = []
        this.pendingDefaultGroupName = PRODUCT_GROUP_NAME
      }
      this.hasInitializedDefaults = true
    },

    async ensureManufacturersLoaded(): Promise<void> {
      if (this.manufacturersLoaded || this.isManufacturersLoading) { return }

      this.isManufacturersLoading = true
      const { fetchManufacturers } = useManufacturers()
      const { data, error } = await fetchManufacturers({
        limit: -1,
        sort: ['name'],
        fields: ['id', 'name'],
      })

      if (error || !data) {
        this.isManufacturersLoading = false
        return
      }

      this.manufacturers = data.map((manufacturer) => ({
        id: Number(manufacturer.id),
        name: manufacturer.name,
      }))
      this.manufacturersLoaded = true
      this.isManufacturersLoading = false
    },

    async ensureBusinessPartnerGroupsLoaded(): Promise<void> {
      if (this.businessPartnerGroupsLoaded || this.isBusinessPartnerGroupsLoading) { return }

      this.isBusinessPartnerGroupsLoading = true
      const { fetchBusinessPartnerGroups } = useBusinessPartnerGroups()
      const { data, error } = await fetchBusinessPartnerGroups({ relationshipType: 'supplier' })

      if (error || !data) {
        this.isBusinessPartnerGroupsLoading = false
        return
      }

      // Preserve SupplyHub's curated order as returned by the composable (its
      // `sort` field) rather than re-ranking here — Product/Operating Expense
      // placement is now driven by the SupplyHub backend, not a hardcoded map.
      this.businessPartnerGroups = data.map((group) => ({ id: group.id, name: group.name }))
      this.businessPartnerGroupsLoaded = true
      this.isBusinessPartnerGroupsLoading = false

      // Cache the Product group ID for synchronous default application
      // on subsequent visits. Persisted across reloads.
      const productGroup = this.businessPartnerGroups.find(
        (group) => group.name === PRODUCT_GROUP_NAME,
      )
      if (productGroup) {
        this.cachedProductGroupId = productGroup.id
      }

      // Apply the pending default group (e.g. "Product") once the list
      // is available. Skip if the user already has a selection.
      if (this.pendingDefaultGroupName && this.selectedBusinessPartnerGroupIds.length === 0) {
        const defaultGroup = this.businessPartnerGroups.find(
          (group) => group.name === this.pendingDefaultGroupName,
        )
        if (defaultGroup) {
          this.selectedBusinessPartnerGroupIds = [defaultGroup.id]
        }
      }
      this.pendingDefaultGroupName = null
    },
  },

  // sessionStorage (not localStorage): filters default fresh each session, keep
  // within-session edits, and reset to defaults on tab-close / logout / login.
  persist: {
    storage: piniaPluginPersistedstate.sessionStorage(),
    pick: [
      'selectedStatuses',
      'selectedBusinessPartnerGroupIds',
      'selectedManufacturerIds',
      'sortField',
      'sortOrder',
      'cachedProductGroupId',
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
