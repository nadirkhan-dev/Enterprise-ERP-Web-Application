/**
 * Message protocol for the reference data Web Worker.
 *
 * All communication is request/response via postMessage.
 * Each request gets a unique `requestId` so the client wrapper
 * can match responses to their Promise resolvers.
 */

/**
 * Actions the worker can perform on any collection.
 *
 * - normalize: transform raw API response into store-ready shape
 * - merge:     apply an incremental update (e.g. from WebSocket)
 * - filter:    search/filter a dataset by query string
 * - buildIndex: create a lookup map keyed by ID for fast access
 */
export type WorkerAction = 'normalize' | 'merge' | 'filter' | 'buildIndex'

export interface WorkerRequest<T = unknown> {
  type: 'request'
  requestId: string
  collection: string
  action: WorkerAction
  payload: T
}

export interface WorkerSuccessResponse<T = unknown> {
  type: 'result'
  requestId: string
  collection: string
  action: WorkerAction
  data: T
}

export interface WorkerErrorResponse {
  type: 'error'
  requestId: string
  collection: string
  action: WorkerAction
  error: string
}

export type WorkerResponse<T = unknown> = WorkerSuccessResponse<T> | WorkerErrorResponse

export interface NormalizePayload<T = unknown> {
  rawData: T[]
}

export interface MergePayload<T = unknown> {
  currentData: T[]
  updates: Partial<T>[]
  /** Items to add if their ID doesn't exist in currentData */
  additions?: T[]
  /** IDs of items to remove */
  removals?: (number | string)[]
}

export interface FilterPayload<T = unknown> {
  data: T[]
  query: string
  fields: (keyof T)[]
}

export interface BuildIndexPayload<T = unknown> {
  data: T[]
  keyField: keyof T
}
