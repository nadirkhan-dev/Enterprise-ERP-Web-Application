import { useDirectusCrud } from '~/composables/useDirectusCrud'
import type { TryCatchResult } from '~/types/api'
import type { Region } from '~/types/directus'

const LIST_FIELDS: string[] = ['id', 'name', 'code', 'countries_id']

/**
 * Composable for regions collection.
 */
export function useRegions() {
  const { fetchMany } = useDirectusCrud('regions')

  /**
   * Fetch regions filtered by country, sorted by name.
   *
   * @param countryId — FK to countries collection
   */
  async function fetchRegionsByCountry(countryId: number): Promise<TryCatchResult<Region[]>> {
    return await fetchMany({
      fields: LIST_FIELDS,
      filter: { countries_id: { _eq: countryId } },
      sort: ['name'],
      limit: -1,
    }) as TryCatchResult<Region[]>
  }

  return { fetchRegionsByCountry }
}
