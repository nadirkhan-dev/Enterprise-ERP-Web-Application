import { defineStore } from 'pinia'
import { useTableStateStore } from '~/stores/tableState'
import { useManufacturers } from '~/composables/useManufacturers'

const DEFAULT_SORT_FIELD = 'sku'
const DEFAULT_SORT_ORDER = 1

interface ManufacturerOption {
  id: number
  name: string
}

interface ItemsFilterState {
  selectedStatuses: string[]
  selectedManufacturerIds: number[]
  isSpecialOrderOnly: boolean
  sortField: string
  sortOrder: number
  manufacturers: ManufacturerOption[]
  isManufacturersLoading: boolean
  manufacturersLoaded: boolean
}

export const useItemsFilterStore = defineStore('itemsFilter', {
  state: (): ItemsFilterState => ({
    selectedStatuses: [],
    selectedManufacturerIds: [],
    isSpecialOrderOnly: false,
    sortField: DEFAULT_SORT_FIELD,
    sortOrder: DEFAULT_SORT_ORDER,
    manufacturers: [],
    isManufacturersLoading: false,
    manufacturersLoaded: false,
  }),

  getters: {
    totalFilterCount: (state): number =>
      state.selectedStatuses.length
      + state.selectedManufacturerIds.length
      + (state.isSpecialOrderOnly ? 1 : 0),

    getManufacturerById(state) {
      return (id: number): ManufacturerOption | undefined =>
        state.manufacturers.find((manufacturer) => manufacturer.id === id)
    },
  },

  actions: {
    setStatuses(values: string[]): void {
      this.selectedStatuses = [...values]
      useTableStateStore().clearTableState('/items')
    },

    setManufacturerIds(values: number[]): void {
      this.selectedManufacturerIds = [...values]
      useTableStateStore().clearTableState('/items')
    },

    setSpecialOrderOnly(value: boolean): void {
      this.isSpecialOrderOnly = value
      useTableStateStore().clearTableState('/items')
    },

    setSort(field: string | null, order: number | null): void {
      this.sortField = field || DEFAULT_SORT_FIELD
      this.sortOrder = field ? (order ?? DEFAULT_SORT_ORDER) : DEFAULT_SORT_ORDER
      useTableStateStore().clearTableState('/items')
    },

    clearAll(): void {
      this.selectedStatuses = []
      this.selectedManufacturerIds = []
      this.isSpecialOrderOnly = false
      useTableStateStore().clearTableState('/items')
    },

    resetToDefaults(): void {
      this.selectedStatuses = []
      this.selectedManufacturerIds = []
      this.isSpecialOrderOnly = false
      this.sortField = DEFAULT_SORT_FIELD
      this.sortOrder = DEFAULT_SORT_ORDER
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
  },

  // sessionStorage (not localStorage): filters default fresh each session, keep
  // within-session edits, and reset to defaults on tab-close / logout / login.
  persist: {
    storage: piniaPluginPersistedstate.sessionStorage(),
    pick: [
      'selectedStatuses',
      'selectedManufacturerIds',
      'isSpecialOrderOnly',
      'sortField',
      'sortOrder',
    ],
  },
})
