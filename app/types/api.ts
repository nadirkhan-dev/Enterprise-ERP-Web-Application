/**
 * API utility types — tryCatch results, pagination.
 */

export interface TryCatchResult<T> {
  data: T | null
  error: Error | null
}

export interface PaginationParams {
  page?: number
  limit?: number
  sort?: string | string[]
  search?: string
}

export interface PaginatedResponse<T> {
  data: T[]
  meta?: {
    total_count?: number
    filter_count?: number
  }
}
