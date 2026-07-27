import type { TryCatchResult } from '~/types/api'
import type { Item } from '~/types/directus'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

const LIST_FIELDS: string[] = [
  'id',
  'sku',
  'status',
  'mpn',
  'description',
  'manufacturers_id.id',
  'manufacturers_id.name',
]

const DETAIL_FIELDS: string[] = [
  ...LIST_FIELDS,
  'base_cost',
  'offer_price',
  'mfr_list_price',
  'shipping_groups_id.id',
  'shipping_groups_id.name',
  'shipping_groups_id.code',
  'shipping_length_in',
  'shipping_width_in',
  'shipping_height_in',
  'shipping_weight_lb',
  'shipping_volume_in',
  'unit_weight_lb',
  'production_type',
  'allow_returns',
  'item_groups_id.id',
  'item_groups_id.name',
  'barcode',
  'hs_code',
  'min_sale_qty',
]

// Text fields matched server-side with a case-insensitive "contains" — mirrors
// the fields Directus's global `search` covered, minus enum/numeric fields.
// `model` is handled separately (client-side, normalised) — see findModelMatchIds.
const SEARCH_FIELDS = ['sku', 'mpn', 'description', 'barcode', 'hs_code']

/** Lowercase and strip to alphanumerics for space/punctuation-insensitive comparison. */
function normalizeModel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Session cache of (id, normalized model) for items with a model value, used to
// match `model` regardless of spacing/punctuation. Lazily filled on first model
// search. Cleared so newly saved models are picked up — see clearModelIndexCache.
let modelIndexCache: Array<{ id: number, normalized: string }> | null = null

/** Invalidate the cached model index (call after a model value is created/edited). */
export function clearModelIndexCache(): void {
  modelIndexCache = null
}

/**
 * Build the items free-text search filter. The text fields match
 * case-insensitively anywhere; `model` matches come in pre-resolved as item ids
 * (`modelMatchIds`) so a model can be found regardless of how spaces/punctuation
 * differ between the query and the stored value — something Directus can't do
 * server-side. Returns null for an empty term.
 */
function buildItemsSearchFilter(search: string, modelMatchIds: number[]): Record<string, unknown> | null {
  const term = search.trim()
  if (!term) { return null }

  const conditions: Record<string, unknown>[] = SEARCH_FIELDS.map((field) => ({
    [field]: { _icontains: term },
  }))

  if (modelMatchIds.length) {
    conditions.push({ id: { _in: modelMatchIds } })
  }

  return { _or: conditions }
}

/** AND any provided filters together, dropping nulls. */
function combineFilters(...filters: Array<Record<string, unknown> | null>): Record<string, unknown> | null {
  const parts = filters.filter((entry): entry is Record<string, unknown> => entry != null)
  if (parts.length === 0) { return null }
  if (parts.length === 1) { return parts[0] }
  return { _and: parts }
}

interface FetchItemsOptions {
  search?: string | null
  limit?: number
  page?: number
  // Absolute row offset. When provided, supersedes `page` — Directus accepts
  // one or the other. Lets the navigation window fetch arbitrary chunks that
  // need not align with the list's page boundaries.
  offset?: number | null
  sort?: string[] | null
  fields?: string[] | null
  filter?: Record<string, unknown> | null
}

interface UseItemsReturn {
  fetchItems: (options?: FetchItemsOptions) => Promise<TryCatchResult<Item[]>>
  fetchItem: (itemId: number | string) => Promise<TryCatchResult<Item>>
  fetchItemBySku: (sku: string) => Promise<TryCatchResult<Item | null>>
  fetchItemCount: (filter?: Record<string, unknown> | null, search?: string | null) => Promise<TryCatchResult<number>>
  createItem: (payload: Record<string, unknown>) => Promise<TryCatchResult<Item>>
}

/**
 * Composable for the items collection.
 */
export function useItems(): UseItemsReturn {
  const itemsCrud = useDirectusCrud('items')

  /**
   * Resolve the item ids whose `model` matches `search` after normalising both
   * sides to lowercase alphanumerics. Directus filters compare the raw stored
   * string, so this is done client-side: load the (id, model) pairs once per
   * session and match in JS. Lets "This Is a test model", "ThisIsaTestModel",
   * "this-is-a-test-model", etc. all find the same item.
   */
  async function findModelMatchIds(search: string): Promise<number[]> {
    const normalizedTerm = normalizeModel(search)
    if (!normalizedTerm) { return [] }

    const index = await loadModelIndex()
    return index
      .filter((entry) => entry.normalized.includes(normalizedTerm))
      .map((entry) => entry.id)
  }

  /** Load and cache (id, normalized model) for every item that has a model value. */
  async function loadModelIndex(): Promise<Array<{ id: number, normalized: string }>> {
    if (modelIndexCache) { return modelIndexCache }

    const { data: rows, error } = await itemsCrud.fetchMany({
      fields: ['id', 'model'],
      filter: { model: { _nnull: true } },
      limit: -1,
    })
    if (error) { return [] }

    modelIndexCache = (rows || [])
      .filter((row): row is { id: number, model: string } => Boolean(row?.model))
      .map((row) => ({ id: row.id, normalized: normalizeModel(row.model) }))
    return modelIndexCache
  }

  async function fetchItems(options: FetchItemsOptions = {}): Promise<TryCatchResult<Item[]>> {
    const { limit = 25, page = 1, offset = null, search = null, sort = null, fields = null, filter = null } = options

    const query: Record<string, unknown> = {
      fields: fields || LIST_FIELDS,
      sort: sort || ['sku'],
      limit,
    }

    // Directus accepts `offset` or `page`, not both — prefer an explicit
    // offset so the navigation window can request chunks at any row
    // boundary. An unlimited query (`limit: -1`) sends neither: pagination
    // is meaningless there, and `page` alongside `limit: -1` yields an
    // empty result set.
    if (offset != null) {
      query.offset = offset
    } else if (limit >= 0) {
      query.page = page
    }

    // Search runs as an explicit filter (not the global `search`) so `model`
    // can use a normalised, space/punctuation-insensitive match. AND it with any
    // caller filter (e.g. status).
    const modelMatchIds = search ? await findModelMatchIds(search) : []
    const combinedFilter = combineFilters(filter, search ? buildItemsSearchFilter(search, modelMatchIds) : null)
    if (combinedFilter) {
      query.filter = combinedFilter
    }

    return await itemsCrud.fetchMany(query)
  }

  async function fetchItem(itemId: number | string): Promise<TryCatchResult<Item>> {
    return await itemsCrud.fetchOne(itemId, { fields: DETAIL_FIELDS })
  }

  async function fetchItemCount(filter: Record<string, unknown> | null = null, search: string | null = null): Promise<TryCatchResult<number>> {
    // Mirror fetchItems so the count matches the same search logic.
    const modelMatchIds = search ? await findModelMatchIds(search) : []
    const combinedFilter = combineFilters(filter, search ? buildItemsSearchFilter(search, modelMatchIds) : null)
    return await itemsCrud.fetchCount(combinedFilter, null)
  }

  async function createItem(payload: Record<string, unknown>): Promise<TryCatchResult<Item>> {
    return await itemsCrud.createOne(payload)
  }

  async function fetchItemBySku(sku: string): Promise<TryCatchResult<Item | null>> {
    const { data: items, error } = await itemsCrud.fetchMany({
      fields: DETAIL_FIELDS,
      filter: { sku: { _eq: sku } },
      limit: 1,
    })

    if (error) {
      return { data: null, error }
    }

    return { data: items?.[0] || null, error: null }
  }

  return {
    fetchItems,
    fetchItem,
    fetchItemBySku,
    fetchItemCount,
    createItem,
  }
}
