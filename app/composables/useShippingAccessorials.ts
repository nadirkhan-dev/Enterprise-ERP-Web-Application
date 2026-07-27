import type { TryCatchResult } from '~/types/api'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

export interface ShippingAccessorialOption {
  id: number
  code: string
  name: string
  description: string
}

export function useShippingAccessorials() {
  const accessorialCrud = useDirectusCrud('shipping_accessorials')

  /**
   * Active accessorials offered by the active shipping methods in a group.
   *
   * Relationship chain: shipping group → active shipping_methods → active
   * shipping_accessorials. Querying the accessorials collection directly (with
   * a relational filter back through the methods junction) de-dupes for free —
   * an accessorial shared by several methods is returned at most once.
   */
  async function fetchForShippingGroup(
    groupId: number,
  ): Promise<TryCatchResult<ShippingAccessorialOption[]>> {
    const { data, error } = await accessorialCrud.fetchMany({
      fields: ['id', 'code', 'name', 'description'],
      filter: {
        _and: [
          { status: { _eq: 'active' } },
          {
            shipping_methods: {
              shipping_methods_id: {
                status: { _eq: 'active' },
                shipping_groups_id: { _eq: groupId },
              },
            },
          },
        ],
      },
      // Render in backend-defined order: the Directus manual `sort` field first,
      // then the primary key (insertion order) as a stable tiebreaker. A `name`
      // tiebreaker would re-alphabetise the list when `sort` is unset, which is
      // not the order the accessorials are defined in.
      sort: ['sort', 'id'],
      limit: -1,
    })
    if (error) {
      return { data: null, error }
    }
    return {
      data: (data || []).map((accessorial: any) => ({
        id: accessorial.id,
        code: accessorial.code,
        name: accessorial.name,
        description: accessorial.description,
      })),
      error: null,
    }
  }

  return { fetchForShippingGroup }
}
