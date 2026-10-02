/**
 * Web Worker for CPU-heavy reference data processing.
 *
 * This worker handles:
 * - normalize: reshape raw API responses into store-ready structures
 * - merge:     apply incremental updates (additions, patches, removals)
 * - filter:    case-insensitive search across specified fields
 * - buildIndex: create a Map-like lookup object keyed by ID
 *
 * Collection-specific logic is registered via `handlers`. To add a
 * new collection, add a handler object with the actions it supports.
 *
 * IMPORTANT: This worker does NOT make API calls — it only processes data.
 */
import type {
  WorkerRequest,
  WorkerResponse,
  NormalizePayload,
  MergePayload,
  FilterPayload,
  BuildIndexPayload,
  WorkerAction,
} from '~/types/worker'

/**
 * Default normalize — pass-through (no transformation needed).
 * Collections override this when they need reshaping.
 */
function defaultNormalize<T>(payload: NormalizePayload<T>): T[] {
  return payload.rawData
}

/**
 * Merge incremental updates into a dataset.
 * Handles patches, additions, and removals in a single pass.
 */
function genericMerge<T extends { id: number | string }>(payload: MergePayload<T>): T[] {
  const { currentData, updates = [], additions = [], removals = [] } = payload

  const removalSet = new Set(removals.map(String))

  // Start with current data, apply patches and filter removals
  let merged = currentData
    .filter((item) => !removalSet.has(String(item.id)))
    .map((item) => {
      const patch = updates.find((u) => (u as any).id === item.id)
      return patch ? { ...item, ...patch } : item
    })

  if (additions.length > 0) {
    const existingIds = new Set(merged.map((item) => String(item.id)))
    const newItems = additions.filter((item) => !existingIds.has(String(item.id)))
    merged = [...merged, ...newItems]
  }

  return merged
}

/**
 * Case-insensitive substring search across specified fields.
 */
function genericFilter<T>(payload: FilterPayload<T>): T[] {
  const { data, query, fields } = payload
  if (!query.trim()) return data

  const lowerQuery = query.toLowerCase()
  return data.filter((item) =>
    fields.some((field) => {
      const value = item[field]
      if (typeof value === 'string') {
        return value.toLowerCase().includes(lowerQuery)
      }
      if (typeof value === 'number') {
        return String(value).includes(lowerQuery)
      }
      return false
    }),
  )
}

/**
 * Build a lookup object keyed by the specified field (typically 'id').
 */
function genericBuildIndex<T>(payload: BuildIndexPayload<T>): Record<string, T> {
  const { data, keyField } = payload
  const index: Record<string, T> = {}
  for (const item of data) {
    const key = String(item[keyField])
    index[key] = item
  }
  return index
}

interface CollectionHandler {
  normalize?: (payload: any) => any
  merge?: (payload: any) => any
  filter?: (payload: any) => any
  buildIndex?: (payload: any) => any
}

/**
 * Countries handler — sorts regions within each country during normalize.
 */
const countriesHandler: CollectionHandler = {
  normalize(payload: NormalizePayload) {
    return payload.rawData.map((country: any) => ({
      ...country,
      regions: (country.regions || []).sort((a: any, b: any) =>
        a.name.localeCompare(b.name),
      ),
    }))
  },
  merge: genericMerge,
  filter: genericFilter,
  buildIndex: genericBuildIndex,
}

/**
 * Default handler — used for collections without custom logic.
 * New collections get all generic operations out of the box.
 */
const defaultHandler: CollectionHandler = {
  normalize: defaultNormalize,
  merge: genericMerge,
  filter: genericFilter,
  buildIndex: genericBuildIndex,
}

const handlers: Record<string, CollectionHandler> = {
  countries: countriesHandler,
}

function getHandler(collection: string): CollectionHandler {
  return handlers[collection] || defaultHandler
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { type, requestId, collection, action, payload } = event.data

  if (type !== 'request') return

  try {
    const handler = getHandler(collection)
    const actionFn = handler[action as keyof CollectionHandler]
      || defaultHandler[action as keyof CollectionHandler]

    if (!actionFn) {
      throw new Error(`Unknown action "${action}" for collection "${collection}"`)
    }

    const result = actionFn(payload)

    const response: WorkerResponse = {
      type: 'result',
      requestId,
      collection,
      action,
      data: result,
    }

    self.postMessage(response)
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId,
      collection,
      action,
      error: error instanceof Error ? error.message : String(error),
    }

    self.postMessage(response)
  }
}
