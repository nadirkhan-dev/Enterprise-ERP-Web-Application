import { useDirectusCrud } from '~/composables/useDirectusCrud'
import type { TryCatchResult } from '~/types/api'
import type { BusinessPartnerGroup } from '~/types/directus'

const LIST_FIELDS: string[] = ['id', 'name', 'relationship_type']

interface FetchBusinessPartnerGroupsOptions {
  relationshipType?: string | null
}

// Reference data — stable for a session. Cache per relationship_type so opening
// the account drawer repeatedly doesn't re-fetch the same group list.
const groupsCache = new Map<string, BusinessPartnerGroup[]>()

/**
 * Composable for business_partner_groups collection.
 */
export function useBusinessPartnerGroups() {
  const { fetchMany } = useDirectusCrud('business_partner_groups')

  /**
   * Fetch all business partner groups, optionally filtered by relationship_type.
   * Results are cached for the session.
   */
  async function fetchBusinessPartnerGroups(
    options: FetchBusinessPartnerGroupsOptions = {},
  ): Promise<TryCatchResult<BusinessPartnerGroup[]>> {
    const { relationshipType = null } = options
    const cacheKey = relationshipType ?? '__all__'
    const cached = groupsCache.get(cacheKey)
    if (cached) {
      return { data: cached, error: null }
    }

    const query: Record<string, unknown> = {
      fields: LIST_FIELDS,
      sort: ['sort', 'id'],
      limit: -1,
    }

    if (relationshipType) {
      query.filter = { relationship_type: { _eq: relationshipType } }
    }

    const result = await fetchMany(query) as TryCatchResult<BusinessPartnerGroup[]>
    if (!result.error && result.data) {
      groupsCache.set(cacheKey, result.data)
    }
    return result
  }

  return { fetchBusinessPartnerGroups }
}
