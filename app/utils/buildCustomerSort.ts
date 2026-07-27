/**
 * Builds the Directus `sort` array for customer (business_partner) list and
 * Next/Prev navigation queries.
 *
 * `account_number` is always appended as a tiebreaker so rows with equal
 * primary-sort values keep a stable, deterministic order. The list query, the
 * navigation window chunks, and the position lookup must all agree on this
 * ordering — otherwise a chunk fetched at an arbitrary offset would not line up
 * with the rows the list already rendered.
 *
 * @param sortField primary sort field; falls back to `account_number` when null
 * @param sortOrder 1 for ascending, -1 for descending
 * @returns Directus sort tokens, e.g. `['-name', 'account_number']`
 */
export function buildCustomerSort(sortField: string | null, sortOrder: number = 1): string[] {
  const primaryField = sortField || 'account_number'
  const primaryToken = sortOrder === -1 ? `-${primaryField}` : primaryField

  if (primaryField === 'account_number') {
    return [primaryToken]
  }
  return [primaryToken, 'account_number']
}
