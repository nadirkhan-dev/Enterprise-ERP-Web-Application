import { readItems, readItem, createItem, updateItem, updateItemsBatch, deleteItem, aggregate } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'
import type { TryCatchResult } from '~/types/api'

// The Directus SDK generic functions resolve parameters to `never` when the
// schema type is unspecified. Since this composable accepts dynamic collection
// names at runtime, we cast the SDK functions to accept `any` arguments.
// Domain composables layer proper types on top of the returns.
const _readItems = readItems as any
const _readItem = readItem as any
const _createItem = createItem as any
const _updateItem = updateItem as any
const _updateItemsBatch = updateItemsBatch as any
const _deleteItem = deleteItem as any
const _aggregate = aggregate as any

/**
 * Generic CRUD composable for any Directus collection.
 */
export function useDirectusCrud(collection: string) {
  const directus = useDirectus()

  async function fetchMany(query: Record<string, unknown> = {}): Promise<TryCatchResult<any[]>> {
    return await tryCatch(directus.request(_readItems(collection, query)))
  }

  async function fetchOne(
    itemId: number | string,
    options: Record<string, unknown> = {},
  ): Promise<TryCatchResult<any>> {
    return await tryCatch(directus.request(_readItem(collection, itemId, options)))
  }

  async function createOne(payload: Record<string, unknown>): Promise<TryCatchResult<any>> {
    return await tryCatch(directus.request(_createItem(collection, payload)))
  }

  async function updateOne(
    itemId: number | string,
    payload: Record<string, unknown>,
    query: Record<string, unknown> = {},
  ): Promise<TryCatchResult<any>> {
    return await tryCatch(directus.request(_updateItem(collection, itemId, payload, query)))
  }

  async function removeOne(itemId: number | string): Promise<TryCatchResult<void>> {
    return await tryCatch(directus.request(_deleteItem(collection, itemId)))
  }

  /**
   * Update many items with differing values in a single request. Each entry must
   * include its primary key; Directus applies each object's own fields. Use this
   * instead of N `updateOne` calls when patching a batch (e.g. persisting sort
   * order across rows).
   */
  async function updateBatch(items: Record<string, unknown>[]): Promise<TryCatchResult<any[]>> {
    return await tryCatch(directus.request(_updateItemsBatch(collection, items)))
  }

  /**
   * Count rows matching an optional filter. Pass `distinctField` (usually the
   * primary key) to count DISTINCT values instead of `count(*)` — required when
   * the filter reaches into a to-many relation, where a plain count(*) would
   * multiply the parent across the join and inflate the total.
   */
  async function fetchCount(
    filter: Record<string, unknown> | null = null,
    search: string | null = null,
    distinctField: string | null = null,
  ): Promise<TryCatchResult<number>> {
    const aggregateQuery = {
      aggregate: distinctField ? { countDistinct: [distinctField] } : { count: ['*'] },
      query: {} as Record<string, unknown>,
    }
    if (filter) {
      aggregateQuery.query.filter = filter
    }
    if (search) {
      aggregateQuery.query.search = search
    }
    const { data: aggregateResult, error } = await tryCatch(
      directus.request(_aggregate(collection, aggregateQuery)),
    )
    if (error) {
      return { data: null, error }
    }
    const row = (aggregateResult as any)?.[0]
    const count = Number(
      (distinctField ? row?.countDistinct?.[distinctField] : row?.count) ?? 0,
    )
    return { data: count, error: null }
  }

  return {
    fetchMany,
    fetchOne,
    createOne,
    updateOne,
    updateBatch,
    removeOne,
    fetchCount,
  }
}
