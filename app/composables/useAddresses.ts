import type { TryCatchResult } from '~/types/api'
import type { Address } from '~/types/directus'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

const LIST_FIELDS: string[] = [
  'id',
  'street_line_1',
  'street_line_2',
  'city',
  'postal_code',
  'countries_id.id',
  'countries_id.name',
  'countries_id.code',
  'regions_id.id',
  'regions_id.name',
  'regions_id.code',
]

const DETAIL_FIELDS: string[] = [
  ...LIST_FIELDS,
  'latitude',
  'longitude',
  'countries_id.phone_code',
  'countries_id.flag_id',
]

interface FetchAddressesOptions {
  filter?: Record<string, unknown> | null
  limit?: number
  page?: number
  search?: string | null
}

interface UseAddressesReturn {
  fetchAddresses: (options?: FetchAddressesOptions) => Promise<TryCatchResult<Address[]>>
  fetchAddress: (addressId: number | string) => Promise<TryCatchResult<Address>>
  createAddress: (payload: Record<string, unknown>) => Promise<TryCatchResult<Address>>
  updateAddress: (addressId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<Address>>
}

/**
 * Composable for addresses collection.
 */
export function useAddresses(): UseAddressesReturn {
  const crud = useDirectusCrud('addresses')

  async function fetchAddresses(options: FetchAddressesOptions = {}): Promise<TryCatchResult<Address[]>> {
    const { filter = null, limit = 25, page = 1, search = null } = options

    const query: Record<string, unknown> = {
      fields: LIST_FIELDS,
      sort: ['city'],
      limit,
      page,
    }

    if (filter) {
      query.filter = filter
    }
    if (search) {
      query.search = search
    }

    return await crud.fetchMany(query)
  }

  async function fetchAddress(addressId: number | string): Promise<TryCatchResult<Address>> {
    return await crud.fetchOne(addressId, { fields: DETAIL_FIELDS })
  }

  async function createAddress(payload: Record<string, unknown>): Promise<TryCatchResult<Address>> {
    return await crud.createOne(payload)
  }

  async function updateAddress(addressId: number | string, payload: Record<string, unknown>): Promise<TryCatchResult<Address>> {
    return await crud.updateOne(addressId, payload)
  }

  return {
    fetchAddresses,
    fetchAddress,
    createAddress,
    updateAddress,
  }
}
