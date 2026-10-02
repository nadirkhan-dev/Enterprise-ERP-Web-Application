import { useDirectusCrud } from '~/composables/useDirectusCrud'
import type { TryCatchResult } from '~/types/api'
import type { ActivityGroup } from '~/types/directus'

const LIST_FIELDS: string[] = ['id', 'name', 'type', 'direction']

// Session-level cache — activity groups are small, static reference data
// used to populate the activity "Action" select.
let cachedActivityGroups: ActivityGroup[] | null = null

/**
 * Composable for the activity_groups reference collection.
 */
export function useActivityGroups() {
  const { fetchMany } = useDirectusCrud('activity_groups')

  /**
   * Fetch all activity groups. The result is cached for the session after
   * the first successful call.
   */
  async function fetchActivityGroups(): Promise<TryCatchResult<ActivityGroup[]>> {
    if (cachedActivityGroups) {
      return { data: cachedActivityGroups, error: null }
    }

    // Retain the backend order: the Directus manual `sort` field first, then the
    // primary key (insertion order) as a stable tiebreaker. A `name` tiebreaker
    // would re-alphabetise the list when `sort` is unset, which the backend
    // ordering is not meant to be.
    const { data: activityGroups, error } = await fetchMany({
      fields: LIST_FIELDS,
      sort: ['sort', 'id'],
      limit: -1,
    }) as TryCatchResult<ActivityGroup[]>

    if (error) {
      return { data: null, error }
    }

    cachedActivityGroups = activityGroups ?? []
    return { data: cachedActivityGroups, error: null }
  }

  return { fetchActivityGroups }
}
