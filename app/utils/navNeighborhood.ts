
export const NEIGHBORHOOD_BUCKET_SIZE = 100

const MAX_PROBES = 4

/** Reads one prefix bucket, already filtered and sorted by the caller. */
export type NeighborhoodProbe<TEntry> = (prefix: string, limit: number) => Promise<TEntry[] | null>


export function readFieldPath(row: Record<string, any> | null, path: string): unknown {
  if (!row) { return null }
  return path.split('.').reduce<any>(
    (branch, segment) => (branch == null ? null : branch[segment]),
    row,
  )
}

export function buildFieldPathFilter(
  path: string,
  condition: Record<string, unknown>,
): Record<string, unknown> {
  return path.split('.').reduceRight<Record<string, unknown>>(
    (branch, segment) => ({ [segment]: branch }),
    condition,
  )
}

/** ANDs the provided filters together, dropping the null ones. */
export function combineNavFilters(
  ...filters: Array<Record<string, unknown> | null>
): Record<string, unknown> | null {
  const parts = filters.filter((entry): entry is Record<string, unknown> => entry != null)
  if (parts.length === 0) { return null }
  if (parts.length === 1) { return parts[0] as Record<string, unknown> }
  return { _and: parts }
}

/**
 * @param matches identifies the current record among the fetched rows.
 */
export async function findNeighborhood<TEntry>(
  sortValue: string,
  probe: NeighborhoodProbe<TEntry>,
  matches: (entry: TEntry) => boolean,
): Promise<TEntry[] | null> {
  const value = sortValue.trim()
  if (!value) { return null }


  const exact = await probe(value, NEIGHBORHOOD_BUCKET_SIZE)
  if (!exact || exact.length >= NEIGHBORHOOD_BUCKET_SIZE) { return null }

  let widest = exact
  let shortestLength = 1
  let longestLength = value.length - 1

  for (let probes = 0; probes < MAX_PROBES && shortestLength <= longestLength; probes += 1) {
    const length = Math.floor((shortestLength + longestLength) / 2)
    const rows = await probe(value.slice(0, length), NEIGHBORHOOD_BUCKET_SIZE)
    if (!rows) { break }

    if (rows.length >= NEIGHBORHOOD_BUCKET_SIZE) {
      // Truncated — this prefix is too short to read in one page. Lengthen it.
      shortestLength = length + 1
      continue
    }
    // Complete. Keep it if it is the widest so far, then try a shorter prefix
    // for a wider one.
    if (rows.length > widest.length) { widest = rows }
    longestLength = length - 1
  }

  if (widest.length < 2 || !widest.some(matches)) { return null }
  return widest
}
