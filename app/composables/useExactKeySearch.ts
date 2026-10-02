
export function isExactKeySearch(term: string): boolean {
  const trimmed = term.trim()
  if (trimmed.length < 3) return false
  if (!/\d/.test(trimmed)) return false
  if (!/[A-Za-z]/.test(trimmed)) return false
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(trimmed)
}
export function getDetailPathKey(detailPath: string): string {
  return detailPath.slice(detailPath.lastIndexOf('/') + 1)
}

/**
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

    const searchStore = useSearchStore()
    const originListRoute = searchStore.activeModule?.listRoute ?? null

    searchStore.markCarrySearchOnNavigate()
    searchStore.markExactKeyJump(getDetailPathKey(detailPath))
    await navigateTo(detailPath)
    if (originListRoute) {
      useTableStateStore().clearTableState(originListRoute)
    }
    return true
  }

  return { redirectIfExactKey }
}
