/**
 * Per-user sliding-window rate limiter (server-only, nitro-storage backed).
 *
 * Backed by `useStorage('rate-limit')` so that swapping the underlying driver
 * (e.g. to Redis via `nitro.storage` config) makes the limiter distributed
 * across workers without code changes. With the default `memory` driver it
 * still works correctly for single-worker dev.
 */

interface SlidingWindowEntry {
  timestamps: number[]
}

export class RateLimitError extends Error {
  statusCode = 429
  retryAfterSeconds: number

  constructor(retryAfterSeconds: number) {
    super(`Rate limit exceeded. Try again in ${retryAfterSeconds}s.`)
    this.name = 'RateLimitError'
    this.retryAfterSeconds = retryAfterSeconds
  }
}

interface EnforceRateLimitOptions {
  key: string
  limit: number
  windowMs: number
}

/**
 * Allow up to `limit` calls per `windowMs` for a given `key`.
 * Throws RateLimitError when the caller exceeds the budget.
 */
export async function enforceRateLimit({ key, limit, windowMs }: EnforceRateLimitOptions): Promise<void> {
  const storage = useStorage('rate-limit')
  const now = Date.now()
  const cutoff = now - windowMs

  const existing = (await storage.getItem<SlidingWindowEntry>(key)) ?? { timestamps: [] }
  const recentTimestamps = existing.timestamps.filter(timestamp => timestamp >= cutoff)

  if (recentTimestamps.length >= limit) {
    const oldest = recentTimestamps[0]!
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
    throw new RateLimitError(retryAfterSeconds)
  }

  recentTimestamps.push(now)
  await storage.setItem(key, { timestamps: recentTimestamps } satisfies SlidingWindowEntry)
}
