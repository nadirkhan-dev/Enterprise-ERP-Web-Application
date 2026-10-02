/**
 * Square Application IDs encode their environment in the prefix:
 *   - `sandbox-sq0idb-…` → sandbox
 *   - `sq0idp-…`         → production
 *
 * One source of truth — both the Web Payments SDK CDN (client-side) and the
 * Square API host (server-side) derive from this.
 */
export type SquareEnv = 'sandbox' | 'production'

export function getSquareEnv(applicationId: string | null | undefined): SquareEnv {
  return typeof applicationId === 'string' && applicationId.startsWith('sandbox-')
    ? 'sandbox'
    : 'production'
}
