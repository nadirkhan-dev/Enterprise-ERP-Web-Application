import type { TryCatchResult } from '~/types/api'

/**
 * Normalizes async operations into { data, error } pattern.
 *
 * @example
 * const { data, error } = await tryCatch(fetchUserData(userId))
 */
export async function tryCatch<T>(operation: Promise<T>): Promise<TryCatchResult<T>> {
  try {
    const data = await operation
    return { data, error: null }
  } catch (error) {
    return { data: null, error: error as Error }
  }
}

/**
 * Normalizes sync operations into { data, error } pattern.
 *
 * @example
 * const { data, error } = tryCatchSync(() => buildConfig(options))
 */
export function tryCatchSync<T>(fn: () => T): TryCatchResult<T> {
  try {
    const data = fn()
    return { data, error: null }
  } catch (error) {
    return { data: null, error: error as Error }
  }
}
