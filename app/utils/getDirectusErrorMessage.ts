/**
 * Extract the human-readable message from a Directus SDK error.
 *
 * Directus carries the real reason in `errors[0].message` — e.g.
 * `You don't have permission to perform "read" for collection "directus_fields"
 * or it does not exist.` — so we surface that verbatim rather than a generic
 * catch-all. Falls back to the thrown error's own `message`, then `fallback`.
 *
 * @param error – the caught error (Directus SDK error, network error, etc.)
 * @param fallback – message to use when nothing readable can be extracted
 */
export function getDirectusErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const errors = (error as { errors?: unknown }).errors
    if (Array.isArray(errors) && errors[0] && typeof errors[0] === 'object') {
      const message = (errors[0] as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) {
        return message
      }
    }

    const topMessage = (error as { message?: unknown }).message
    if (typeof topMessage === 'string' && topMessage.trim()) {
      return topMessage
    }
  }

  return fallback
}
