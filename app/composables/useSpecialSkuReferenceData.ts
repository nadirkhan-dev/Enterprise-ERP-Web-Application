import { useSpecialSkuReferenceDataStore } from '~/stores/specialSkuReferenceData'

export function useSpecialSkuReferenceData() {
  const store = useSpecialSkuReferenceDataStore()

  return {
    manufacturers: computed(() => store.manufacturers),
    itemGroups: computed(() => store.itemGroups),
    loading: computed(() => store.loading),
    syncing: computed(() => store.syncing),
    error: computed(() => store.error),
    hydrate: (force = false) => store.hydrate(force),
    refresh: () => store.refresh(),
  }
}
