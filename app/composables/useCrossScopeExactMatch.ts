/**
 * Cross-entity exact match resolver — tries to match a search term against
 * multiple entity types using entity-specific patterns (Customer SAP ID,
 * Item SKU, Supplier SAP ID) and redirects automatically.
 *
 * Pattern-based approach: each entity type has a characteristic pattern
 * (length, format, character composition). We try patterns in priority order
 * and query the database using Directus _eq filters (exact case-sensitive match).
 *
 * Same-entity searches use the page's own `useExactKeySearch` — this handles
 * cross-entity detection as a fallback after same-entity checks fail.
 */

interface EntityPattern {
  name: string
  isMatch: (term: string) => boolean
  fetch: (term: string) => Promise<{ data: any; error: any }>
  getPath: (entity: any) => string
  getScope: (path: string) => string
}

export function useCrossScopeExactMatch(): {
  redirectIfCrossScopeMatch: (term: string) => Promise<boolean>
} {
  const route = useRoute()
  const businessPartners = useBusinessPartners()
  const items = useItems()
  const searchStore = useSearchStore()

  /**
   * Entity patterns derived from actual Directus data storage.
   * Each pattern matches how data is stored in the database.
   *
   * PATTERNS (From Directus business_partners & items):
   * 1. Customer SAP ID: Letter C + exactly 6 digits (e.g., C061120, C100001)
   *    - Directus field: business_partners.account_number (type: string)
   *    - Filter: { account_number: { _eq: "C100001" }, relationship_type: { _eq: "customer" } }
   *
   * 2. Supplier SAP ID: Letter V + exactly 6 digits (e.g., V100001, V100010)
   *    - Directus field: business_partners.account_number (type: string)
   *    - Filter: { account_number: { _eq: "V100001" }, relationship_type: { _eq: "supplier" } }
   *
   * 3. Item SKU: Pattern [A-Z]{2,4}[0-9]{2,4}-[0-9]{4} (e.g., AMC01-0005)
   *    - Directus field: items.sku (type: string)
   *    - Filter: { sku: { _eq: "AMC01-0005" } }
   *
   * Priority Order:
   *   Customer → Supplier → Item
   *   (Customer checked first, then supplier, then item)
   */
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

  async function redirectIfCrossScopeMatch(term: string): Promise<boolean> {
    const trimmed = term.trim()
    if (trimmed.length < 3) {
      return false
    }

    // Normalize to uppercase for database comparison (Directus _eq is case-sensitive)
    const key = trimmed.toUpperCase()
    const currentScope = getCurrentScope(route.path)

    // Try patterns in priority order until we find a match
    for (const pattern of entityPatterns) {
      // Skip if we're already in this entity's scope (let same-entity search handle it)
      if (currentScope === pattern.getScope(route.path)) {
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

      // Match found! Redirect to detail page
      searchStore.markClearOnNavigate()
      await navigateTo(pattern.getPath(entity))
      return true
    }

    return false
  }

  /**
   * Extract current entity scope from route path.
   * Handles both list routes (/customers) and detail routes (/customers/ID).
   */
  function getCurrentScope(path: string): string {
    const match = path.match(/^\/([a-z]+)/)
    return match ? match[1] : ''
  }

  return { redirectIfCrossScopeMatch }
}
