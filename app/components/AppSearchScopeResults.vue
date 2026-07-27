<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import type { CrossScopeResult } from '~/stores/search'

const searchStore = useSearchStore()
const toast = useToast()

const customerFilter = useCustomerFilterStore()
const suppliersFilter = useSuppliersFilterStore()
const itemsFilter = useItemsFilterStore()

function resultLabel(result: CrossScopeResult): string {
  const noun = result.count === 1 ? 'result' : 'results'
  return `${result.count.toLocaleString()} ${noun} in ${result.label}`
}

// '' = empty selection (all / none); a comma list = those values.
function listParam(values: Array<string | number>): string {
  return values.length ? values.join(',') : ''
}

function scopeResultQuery(result: CrossScopeResult, query: string): LocationQueryRaw {
  const base: LocationQueryRaw = { q: query }

  switch (result.key) {
    case 'customers':
      return {
        ...base,
        status: listParam(customerFilter.selectedStatuses),
        account_manager_id: listParam(customerFilter.selectedAccountManagerIds),
        business_partner_groups_id: listParam(customerFilter.selectedBusinessPartnerGroupIds),
        is_national_account: customerFilter.isNationalAccountOnly ? '1' : 'false',
      }
    case 'suppliers':
      return {
        ...base,
        status: listParam(suppliersFilter.selectedStatuses),
        business_partner_groups_id: listParam(suppliersFilter.selectedBusinessPartnerGroupIds),
        manufacturers_id: listParam(suppliersFilter.selectedManufacturerIds),
      }
    case 'items':
      return {
        ...base,
        status: listParam(itemsFilter.selectedStatuses),
        manufacturers_id: listParam(itemsFilter.selectedManufacturerIds),
        is_standard_sku: itemsFilter.isSpecialOrderOnly ? 'false' : 'true',
      }
    default:
      return base
  }
}

const SEARCH_DEBOUNCE_MS = 600

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let shownToasts: Record<string, unknown>[] = []

function cancelPendingToasts(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function removeShownToasts(): void {
  shownToasts.forEach((message) => toast.remove(message))
  shownToasts = []
}

function showResultToast(result: CrossScopeResult, query: string): void {
  const message = {
    group: 'cross-scope-results',
    severity: 'info',
    summary: 'Results found',
    detail: resultLabel(result),
    styleClass: 'search-scope-results-toast',
    data: {
      kind: 'cross-scope-results',
      path: result.listRoute,
      query: scopeResultQuery(result, query),
    },
  }
  toast.add(message as any)
  shownToasts.push(message)
}

watch(
  () => ({
    query: searchStore.crossScopeQuery,
    results: searchStore.crossScopeResults,
  }),
  ({ query, results }) => {
    cancelPendingToasts()
    if (!query || !results.length) { return }

    debounceTimer = setTimeout(() => {
      debounceTimer = null
      removeShownToasts()
      results.forEach((result) => showResultToast(result, query))
      searchStore.clearCrossScopeResults()
    }, SEARCH_DEBOUNCE_MS)
  },
)

watch(() => searchStore.inputQuery, () => {
  cancelPendingToasts()
  removeShownToasts()
})

onBeforeUnmount(() => {
  cancelPendingToasts()
})
</script>

<template>
  <span class="visually-hidden" />
</template>
