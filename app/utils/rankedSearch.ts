import type { TryCatchResult } from '~/types/api'

export const SEARCH_RANKS = ['exact', 'starts', 'word-start', 'partial', 'other-fields'] as const

export type SearchRank = (typeof SEARCH_RANKS)[number]

const FALLBACK_RANKS: SearchRank[] = ['starts', 'other-fields']

/** Ceiling on the id lists that keeps a bucket's URL sane. */
export const MAX_RANKED_IDS = 500

/** Ids of the rows each bucket includes or excludes. */
export interface SearchRankIds {
  exact: Array<number | string>
  wordStart: Array<number | string>
  partial: Array<number | string>
  /** Every row whose primary field contains the term, in any position. */
  primaryContains: Array<number | string>
}

const EMPTY_RANK_IDS: SearchRankIds = { exact: [], wordStart: [], partial: [], primaryContains: [] }


function excludesStart(field: string, term: string): Record<string, unknown> {
  return { _or: [{ [field]: { _null: true } }, { [field]: { _nistarts_with: term } }] }
}

/** Rows whose primary field contains the term anywhere — the ranking's raw material. */
export function buildPrimaryContainsFilter(fields: string[], term: string): Record<string, unknown> {
  return { _or: fields.map((field) => ({ [field]: { _icontains: term } })) }
}

/** How one row's primary field matched the term, ignoring case and outer space. */
export function classifyPrimaryMatch(
  row: Record<string, any>,
  fields: string[],
  term: string,
): SearchRank {
  const wanted = term.trim().toLowerCase()
  const values = fields.map((field) => String(row[field] ?? '').trim().toLowerCase())

  if (values.some((value) => value === wanted)) { return 'exact' }
  if (values.some((value) => value.startsWith(wanted))) { return 'starts' }
  if (values.some((value) => value.includes(` ${wanted}`))) { return 'word-start' }
  // Contains it somewhere, or — for a row that matched on a contact or a phone —
  // does not contain it at all.
  return values.some((value) => value.includes(wanted)) ? 'partial' : 'other-fields'
}

/**
 * @param fields - the primary fields relevance is judged on
 * @param term - the raw search term
 * @param rank - which bucket to isolate
 * @param ids - the id sets measured for this search
 */
export function buildSearchRankFilter(
  fields: string[],
  term: string,
  rank: SearchRank,
  ids: SearchRankIds = EMPTY_RANK_IDS,
): Record<string, unknown> {
  const startsWithAny = { _or: fields.map((field) => ({ [field]: { _istarts_with: term } })) }
  const startsWithNone = { _and: fields.map((field) => excludesStart(field, term)) }

  if (rank === 'exact') {
    return { id: { _in: ids.exact } }
  }

  if (rank === 'starts') {
    return ids.exact.length
      ? { _and: [startsWithAny, { id: { _nin: ids.exact } }] }
      : startsWithAny
  }

  if (rank === 'word-start') {
    return ids.wordStart.length
      ? { id: { _in: ids.wordStart } }
      : { _and: [{ _or: fields.map((field) => ({ [field]: { _icontains: ` ${term}` } })) }, startsWithNone] }
  }

  // The primary field contains the term, but not at the start of it or of any
  // word in it.
  if (rank === 'partial') {
    return ids.partial.length
      ? { id: { _in: ids.partial } }
      : { _and: [buildPrimaryContainsFilter(fields, term), startsWithNone] }
  }

  return ids.primaryContains.length
    ? { id: { _nin: ids.primaryContains } }
    : startsWithNone
}

export interface RankedPageSlice {
  rank: SearchRank
  offset: number
  limit: number
}

/**
 * Which slice of which bucket a page is made of.
 * @param leadingCounts - row count per bucket, excluding the last
 * @param ranks - the buckets in play
 * @param page - 1-based
 */
export function buildRankedPagePlan(
  leadingCounts: number[],
  ranks: SearchRank[],
  page: number,
  limit: number,
): RankedPageSlice[] {
  const slices: RankedPageSlice[] = []
  let cursor = Math.max(0, (page - 1) * limit)
  let remaining = limit

  for (let index = 0; index < ranks.length && remaining > 0; index += 1) {
    const isLastRank = index === ranks.length - 1
    const available = isLastRank ? Number.POSITIVE_INFINITY : Math.max(0, leadingCounts[index] ?? 0)

    // The page starts past the end of this bucket — skip it, carrying the rest
    // of the offset into the next.
    if (cursor >= available) {
      cursor -= available
      continue
    }

    const take = Math.min(remaining, available - cursor)
    slices.push({ rank: ranks[index], offset: cursor, limit: take })
    remaining -= take
    cursor = 0
  }

  return slices
}

/** What one search's ranking needs to know before any page can be read. */
export interface SearchRanking {
  ranks: SearchRank[]
  leadingCounts: number[]
  ids: SearchRankIds
}

/**
 * Bucket sizes per search, so pages 2+ don't re-measure. Page 1 always
 * re-measures, which is what makes a changed term, filter or sort take effect —
 * callers key this on all three.
 */
const rankingCache = new Map<string, SearchRanking>()

/** Drop every measured ranking — for a data change that invalidates the counts. */
export function clearSearchRankingCache(): void {
  rankingCache.clear()
}

export interface RankedPageRequest<T> {
  /** Describes the search AND its filters: a different key is a different measurement. */
  cacheKey: string
  page: number
  limit: number
  fetchPrimaryMatches: () => Promise<TryCatchResult<Record<string, any>[]>>
  /** How many rows start with the term — the fallback's only measurement. */
  fetchStartsCount: () => Promise<TryCatchResult<number>>
  fetchRankPage: (
    rank: SearchRank,
    offset: number,
    limit: number,
    ids: SearchRankIds,
  ) => Promise<TryCatchResult<T[]>>
}

/** Measure the buckets once per search, deciding whether all five are usable. */
async function resolveRanking<T>(
  request: RankedPageRequest<T>,
  fields: string[],
  term: string,
): Promise<TryCatchResult<SearchRanking>> {
  const { data: primaryRows, error } = await request.fetchPrimaryMatches()
  if (error) {
    return { data: null, error }
  }

  if ((primaryRows?.length ?? 0) > MAX_RANKED_IDS) {
    const { data: startsCount, error: countError } = await request.fetchStartsCount()
    if (countError) {
      return { data: null, error: countError }
    }
    return {
      data: { ranks: FALLBACK_RANKS, leadingCounts: [startsCount ?? 0], ids: EMPTY_RANK_IDS },
      error: null,
    }
  }

  const buckets: Record<SearchRank, Array<number | string>> = {
    'exact': [],
    'starts': [],
    'word-start': [],
    'partial': [],
    'other-fields': [],
  }
  for (const row of primaryRows ?? []) {
    buckets[classifyPrimaryMatch(row, fields, term)].push(row.id)
  }

  return {
    data: {
      ranks: [...SEARCH_RANKS],
      leadingCounts: [
        buckets.exact.length,
        buckets.starts.length,
        buckets['word-start'].length,
        buckets.partial.length,
      ],
      ids: {
        exact: buckets.exact,
        wordStart: buckets['word-start'],
        partial: buckets.partial,
        primaryContains: (primaryRows ?? []).map((row) => row.id),
      },
    },
    error: null,
  }
}

/**
 * Read one page across the ranked buckets, in order.
 *
 * @param fields - the primary fields relevance is judged on
 * @param term - the raw search term
 * @returns the page's rows, or the first error any of its reads returned
 */
export async function fetchRankedPage<T>(
  request: RankedPageRequest<T>,
  fields: string[],
  term: string,
): Promise<TryCatchResult<T[]>> {
  const { cacheKey, page, limit } = request

  let ranking = rankingCache.get(cacheKey)
  if (!ranking || page === 1) {
    const { data: measured, error } = await resolveRanking(request, fields, term)
    if (error || !measured) {
      return { data: null, error: error ?? new Error('Search ranking failed.') }
    }
    ranking = measured
    rankingCache.set(cacheKey, ranking)
  }

  const slices = buildRankedPagePlan(ranking.leadingCounts, ranking.ranks, page, limit)
  if (slices.length === 0) {
    return { data: [], error: null }
  }

  const measured = ranking
  const reads = await Promise.all(
    slices.map((slice) => request.fetchRankPage(slice.rank, slice.offset, slice.limit, measured.ids)),
  )
  const failedRead = reads.find((result) => result.error)
  if (failedRead?.error) {
    return { data: null, error: failedRead.error }
  }

  return { data: reads.flatMap((result) => result.data ?? []), error: null }
}
