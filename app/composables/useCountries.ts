import { useDirectusCrud } from '~/composables/useDirectusCrud'
import type { TryCatchResult } from '~/types/api'
import type { Country } from '~/types/directus'

const LIST_FIELDS: string[] = ['id', 'name', 'code', 'phone_code']

/**
 * Composable for countries collection.
 */
export function useCountries() {
  const { fetchMany } = useDirectusCrud('countries')

  /**
   * Fetch all countries sorted by name.
   */
  async function fetchCountries(): Promise<TryCatchResult<Country[]>> {
    return await fetchMany({
      fields: LIST_FIELDS,
      sort: ['name'],
      limit: -1,
    }) as TryCatchResult<Country[]>
  }

  return { fetchCountries }
}
