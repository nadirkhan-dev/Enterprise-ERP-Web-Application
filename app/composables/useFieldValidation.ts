import { readFieldsByCollection } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'
import type { TryCatchResult } from '~/types/api'
import type { FieldRulesMap } from '~/utils/validationRules'

// Module-level cache: rules persist for the app session
const rulesCache: Record<string, FieldRulesMap> = {}

/**
 * Composable that fetches Directus field metadata and builds validation rules.
 *
 * Rules are cached per collection — the first call fetches from the API,
 * subsequent calls return the cached result instantly.
 */
export function useFieldValidation() {
  const directus = useDirectus()
  // Captured at setup (composable always runs in setup). Guarded because a few
  // non-component callers may lack a toast provider.
  const toast = tryCatchSync(() => useToast()).data

  /**
   * Fetch and cache validation rules for a Directus collection.
   *
   * @param collection – Directus collection name
   */
  async function fetchRules(collection: string): Promise<TryCatchResult<FieldRulesMap>> {
    if (rulesCache[collection]) {
      return { data: rulesCache[collection], error: null }
    }

    const { data: fields, error } = await tryCatch(
      (directus as any).request(readFieldsByCollection(collection)),
    )

    if (error) {
      // 5xx/unreachable failures are escalated to a full-screen Error500 by the
      // consuming views (via isServerError), so only surface a toast for the
      // otherwise-silent client errors — e.g. a role denied read on
      // `directus_fields` — which would previously vanish into a null rule set.
      // Surface Directus's own message so the real reason (permission, etc.) shows.
      if (!isServerError(error)) {
        showApiFailureToast(
          toast,
          getDirectusErrorMessage(error, 'Some form settings could not be loaded. Please try again later.'),
        )
      }
      return { data: null, error }
    }

    const rules: FieldRulesMap = buildFieldRules(fields as any)
    rulesCache[collection] = rules
    return { data: rules, error: null }
  }

  /**
   * Get cached rules synchronously (returns empty object if not yet fetched).
   *
   * @param collection
   */
  function getRules(collection: string): FieldRulesMap {
    return rulesCache[collection] || {}
  }

  return {
    fetchRules,
    getRules,
  }
}
