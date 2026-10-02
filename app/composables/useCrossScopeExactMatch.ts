

interface EntityPattern {
  name: string
  isMatch: (term: string) => boolean
  fetch: (term: string) => Promise<{ data: any; error: any }>
  getPath: (entity: any) => string
  getScope: (path: string) => string
}

export function useCrossScopeExactMatch(): {
  redirectIfCrossScopeMatch: (term: string) => Promise<boolean>
  redirectIfAnyExactMatch: (term: string) => Promise<boolean>
} {
  const route = useRoute()
  const businessPartners = useBusinessPartners()
  const items = useItems()
  const searchStore = useSearchStore()

  const entityPatterns: EntityPattern[] = [
    {
      name: 'customer',
      // Pattern: C + exactly 6 digits (C061120, C100001, C100009, etc.)
      // Matched against business_partners.account_number (case-insensitive via
      // the upper-cased key + uppercase storage).
      isMatch: (term) => /^C\d{6}$/.test(term),
      fetch: (term) => businessPartners.fetchBusinessPartnerByAccountNumber(term),
      getPath: (entity) => `/customers/${entity.account_number || entity.id}`,
      getScope: (path) => 'customers',
    },
    {
      name: 'supplier',
      // Pattern: V + exactly 6 digits (V100001, V100010, etc.)
      // NOTE: Suppliers use V prefix, NOT S!
      // Matched against business_partners.account_number.
      isMatch: (term) => /^V\d{6}$/.test(term),
      fetch: (term) => businessPartners.fetchBusinessPartnerByAccountNumber(term),
      getPath: (entity) => `/suppliers/${entity.account_number || entity.id}`,
      getScope: (path) => 'suppliers',
    },
    {
      name: 'item',
      // Use the same broad exact-key detection the Items page uses, so SKUs of
      // any format (including non-dashed ones like LSI0J70BP2) can redirect from
      // other pages. The items.sku _eq lookup remains the source of truth.
      isMatch: (term) => isExactKeySearch(term),
      fetch: (term) => items.fetchItemBySku(term),
      getPath: (entity) => `/items/${entity.sku}`,
      getScope: (path) => 'items',
    },
  ]

  /**
   * @param skipCurrentScope leave the active entity's pattern to that list
   *   page's own `useExactKeySearch`. False when the caller is not that page
   *   and nothing else will handle the term.
   */
  async function resolveExactMatch(
    term: string,
    { skipCurrentScope = true }: { skipCurrentScope?: boolean } = {},
  ): Promise<boolean> {
    const trimmed = term.trim()
    if (trimmed.length < 3) {
      return false
    }

    // Normalize to uppercase for database comparison (Directus _eq is case-sensitive)
    const key = trimmed.toUpperCase()
    const currentScope = getCurrentScope(route.path)

    // Try patterns in priority order until we find a match
    for (const pattern of entityPatterns) {
      if (skipCurrentScope && currentScope === pattern.getScope(route.path)) {
        continue
      }

      // Check if the term matches this entity's pattern
      if (!pattern.isMatch(key)) {
        continue
      }

      // Query the database using Directus _eq (exact match, case-sensitive)
      const { data: entity, error } = await pattern.fetch(key)
      if (error || !entity) {
        continue // Pattern matched but no entity found; try next pattern
      }

      // For business partners (customers/suppliers), verify relationship type
      if (pattern.name === 'customer' && entity.relationship_type !== 'customer') {
        continue
      }
      if (pattern.name === 'supplier' && entity.relationship_type !== 'supplier') {
        continue
      }
      const detailPath = pattern.getPath(entity)
      if (detailPath === route.path) {
        return true
      }
      const originListRoute = searchStore.activeModule?.listRoute ?? null

      searchStore.markCarrySearchOnNavigate()
      searchStore.markExactKeyJump(getDetailPathKey(detailPath))
      await navigateTo(detailPath)
      if (originListRoute) {
        useTableStateStore().clearTableState(originListRoute)
      }
      return true
    }

    return false
  }
  async function redirectIfCrossScopeMatch(term: string): Promise<boolean> {
    return await resolveExactMatch(term)
  }

  async function redirectIfAnyExactMatch(term: string): Promise<boolean> {
    return await resolveExactMatch(term, { skipCurrentScope: false })
  }

  /**
   * Extract current entity scope from route path.
   * Handles both list routes (/customers) and detail routes (/customers/ID).
   */
  function getCurrentScope(path: string): string {
    const match = path.match(/^\/([a-z]+)/)
    return match ? match[1] : ''
  }

  return { redirectIfCrossScopeMatch, redirectIfAnyExactMatch }
}
