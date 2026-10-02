/**
 * Checks whether an error represents a 500-series server error.
 *
 * Directus SDK errors include the fetch `Response` object, so we can
 * inspect `response.status` directly.  When no response is available
 * (e.g. network failure / server unreachable), we default to `true`.
 */
export function isServerError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const response = (error as Record<string, unknown>).response
  if (response && typeof response === 'object' && 'status' in response) {
    return (response as { status: number }).status >= 500
  }

  // No response (network failure, etc.) — treat as server error
  return true
}
