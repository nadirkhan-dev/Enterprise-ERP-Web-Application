import { getSearchModules } from '~/config/searchModules'

const NO_RESULTS_TOAST_LIFE = 3000
const NO_RESULTS_SETTLE_MS = 600


let settleTimer: ReturnType<typeof setTimeout> | null = null
let settleResolve: ((settled: boolean) => void) | null = null
let shownNoResultsToast: Record<string, unknown> | null = null

export function useScopeResultsSearch() {
  const searchStore = useSearchStore()
  const toast = useToast()

  function cancelPendingNoResults(): void {
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
    if (settleResolve) {
      settleResolve(false)
      settleResolve = null
    }
  }

  function removeShownNoResults(): void {
    if (shownNoResultsToast) {
      toast.remove(shownNoResultsToast)
      shownNoResultsToast = null
    }
  }
  watch(() => searchStore.inputQuery, () => {
    cancelPendingNoResults()
    removeShownNoResults()
  })
  function waitForQueryToSettle(term: string): Promise<boolean> {
    return new Promise((resolve) => {
      settleResolve = resolve
      settleTimer = setTimeout(() => {
        settleTimer = null
        settleResolve = null
        resolve(searchStore.inputQuery === term && searchStore.searchQuery === term)
      }, NO_RESULTS_SETTLE_MS)
    })
  }
  const { fetchBusinessPartnerCount } = useBusinessPartners()
  const { fetchItemCount } = useItems()
  const { fetchManufacturerCount } = useManufacturers()
  const customerFilter = useCustomerFilterStore()
  const suppliersFilter = useSuppliersFilterStore()
  const itemsFilter = useItemsFilterStore()

  function buildItemsFilter(): Record<string, unknown> | null {
    const conditions: Record<string, unknown>[] = []
    if (itemsFilter.selectedStatuses.length) {
      conditions.push({ status: { _in: [...itemsFilter.selectedStatuses] } })
    }
    if (itemsFilter.selectedManufacturerIds.length) {
      conditions.push({ manufacturers_id: { _in: [...itemsFilter.selectedManufacturerIds] } })
    }
    conditions.push({ is_standard_sku: { _eq: !itemsFilter.isSpecialOrderOnly } })
    return conditions.length ? { _and: conditions } : null
  }
  async function countForScope(scopeKey: string, query: string): Promise<number> {
    switch (scopeKey) {
      case 'customers': {
        const { data } = await fetchBusinessPartnerCount({
          relationshipType: 'customer',
          search: query,
          statusValues: customerFilter.selectedStatuses.length ? [...customerFilter.selectedStatuses] : null,
          accountManagerIds: customerFilter.selectedAccountManagerIds.length ? [...customerFilter.selectedAccountManagerIds] : null,
          businessPartnerGroupIds: customerFilter.selectedBusinessPartnerGroupIds.length ? [...customerFilter.selectedBusinessPartnerGroupIds] : null,
          isNationalAccountOnly: customerFilter.isNationalAccountOnly,
        })
        return data ?? 0
      }
      case 'suppliers': {
        const { data } = await fetchBusinessPartnerCount({
          relationshipType: 'supplier',
          search: query,
          statusValues: suppliersFilter.selectedStatuses.length ? [...suppliersFilter.selectedStatuses] : null,
          businessPartnerGroupIds: suppliersFilter.selectedBusinessPartnerGroupIds.length ? [...suppliersFilter.selectedBusinessPartnerGroupIds] : null,
          manufacturerIds: suppliersFilter.selectedManufacturerIds.length ? [...suppliersFilter.selectedManufacturerIds] : null,
        })
        return data ?? 0
      }
      case 'items': {
        const { data } = await fetchItemCount(buildItemsFilter(), query)
        return data ?? 0
      }
      case 'manufacturers': {
        const { data } = await fetchManufacturerCount(null, query)
        return data ?? 0
      }
      default:
        return 0
    }
  }

  /**
   * @param scopeKey active scope that returned no results ('customers', …)
   * @param query    the search term that came back empty
   */
  async function handleNoResults(scopeKey: string, query: string): Promise<void> {
    const term = (query || '').trim()
    cancelPendingNoResults()
    removeShownNoResults()
    if (!term) { return }
    if (!await waitForQueryToSettle(term)) { return }

    const modules = getSearchModules()
    const active = modules.find((module) => module.key === scopeKey)

    // 1. Auto-dismissing toast for the empty active scope. Lives in the same
    // group as the cross-scope results so the two stack together and the
    // results reflow up when this one times out.
    const noResultsToast = {
      group: 'cross-scope-results',
      severity: 'error',
      summary: `No ${active?.singular ?? 'result'} results found`,
      life: NO_RESULTS_TOAST_LIFE,
      styleClass: 'search-scope-results-toast',
      data: { kind: 'no-results' },
    }
    toast.add(noResultsToast as any)
    shownNoResultsToast = noResultsToast

    // 2. Fan the query out across the other scopes, concurrently.
    const others = modules.filter((module) => module.key !== scopeKey)
    const counts = await Promise.all(
      others.map(async (module) => ({ module, count: await countForScope(module.key, term) })),
    )

    if (searchStore.inputQuery !== term || searchStore.searchQuery !== term) { return }

    const withResults = counts
      .filter(({ count }) => count > 0)
      .map(({ module, count }) => ({
        key: module.key,
        label: module.label,
        listRoute: module.listRoute,
        count,
      }))

    if (!withResults.length) { return }

    // Surface the cross-scope results immediately — they stack directly beneath
    // the still-visible "No results" toast, then reflow up when it times out.
    searchStore.setCrossScopeResults(term, withResults)
  }

  return { handleNoResults }
}
