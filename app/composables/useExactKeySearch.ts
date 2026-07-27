/**
 * Detects whether a search term looks like an exact primary-key identifier
 * (SAP account number, SKU, etc.) rather than a free-text/name search.
 *
 * Heuristic: a single token of letters, digits and dashes, at least three
 * characters long, containing at least one letter AND at least one digit.
 * Primary keys in this system always carry both (SAP IDs like `C121301`,
 * SKUs like `AMC01-0005`); pure-letter tokens are name searches, and
 * pure-digit tokens are phone-number fragments.
 *
 * This only decides whether an exact-match lookup is *worth attempting* — the
 * database `_eq` query remains the source of truth for whether a match exists.
 */
export function isExactKeySearch(term: string): boolean {
  const trimmed = term.trim()
  if (trimmed.length < 3) return false
  if (!/\d/.test(trimmed)) return false
  if (!/[A-Za-z]/.test(trimmed)) return false
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(trimmed)
}

/**
 * Builds an exact-key search handler so an exact identifier match can never be
 * hidden by active list filters. When the term looks like a primary key and
 * resolves to a single entity, navigation jumps straight to its detail page.
 *
 * Redirect is driven only by an active search (the list page's searchQuery
 * watcher), never on mount — so navigating back from a detail page to a list
 * URL that still carries `?q=<key>` does not bounce the user forward again.
 *
 * @param resolveDetailPath returns the detail-page path for an exact match,
 *   or `null` when the term is not an exact key for this entity type.
 */
export function useExactKeySearch(
  resolveDetailPath: (term: string) => Promise<string | null>,
): { redirectIfExactKey: (term: string) => Promise<boolean> } {
  async function redirectIfExactKey(term: string): Promise<boolean> {
    const trimmed = term.trim()
    if (!isExactKeySearch(trimmed)) {
      return false
    }

    // Primary keys (SAP IDs, SKUs) are stored uppercase and Directus `_eq`
    // is case-sensitive — normalise so a lowercase-typed search ("v100001")
    // still resolves to its exact match.
    const key = trimmed.toUpperCase()

    const detailPath = await resolveDetailPath(key)
    if (!detailPath) {
      return false
    }

    useSearchStore().markClearOnNavigate()
    await navigateTo(detailPath)
    return true
  }

  return { redirectIfExactKey }
}
