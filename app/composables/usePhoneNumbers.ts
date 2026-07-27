import { useDirectusCrud } from '~/composables/useDirectusCrud'
import type { TryCatchResult } from '~/types/api'
import type { PhoneNumber } from '~/types/directus'

const LIST_FIELDS: string[] = [
  'id',
  'number',
  'extension',
  'type',
  'sms_capable',
  'countries_id.id',
  'countries_id.name',
  'countries_id.phone_code',
]

const DETAIL_FIELDS: string[] = [
  ...LIST_FIELDS,
  'countries_id.code',
  'countries_id.flag_id',
]

interface FetchPhoneNumbersOptions {
  filter?: Record<string, unknown> | null
  limit?: number
  page?: number
  search?: string | null
}

/**
 * Composable for phone_numbers collection.
 */
export function usePhoneNumbers() {
  const crud = useDirectusCrud('phone_numbers')

  /**
   * Fetch a paginated list of phone numbers.
   */
  async function fetchPhoneNumbers(
    options: FetchPhoneNumbersOptions = {},
  ): Promise<TryCatchResult<PhoneNumber[]>> {
    const { filter = null, limit = 25, page = 1, search = null } = options

    const query: Record<string, unknown> = {
      fields: LIST_FIELDS,
      sort: ['number'],
      limit,
      page,
    }

    if (filter) {
      query.filter = filter
    }
    if (search) {
      query.search = search
    }

    return await crud.fetchMany(query) as TryCatchResult<PhoneNumber[]>
  }

  /**
   * Fetch a single phone number by ID.
   */
  async function fetchPhoneNumber(
    phoneNumberId: number | string,
  ): Promise<TryCatchResult<PhoneNumber>> {
    return await crud.fetchOne(phoneNumberId, { fields: DETAIL_FIELDS }) as TryCatchResult<PhoneNumber>
  }

  /**
   * Create a new phone number.
   */
  async function createPhoneNumber(
    payload: Record<string, unknown>,
  ): Promise<TryCatchResult<PhoneNumber>> {
    return await crud.createOne(payload) as TryCatchResult<PhoneNumber>
  }

  /**
   * Update an existing phone number.
   */
  async function updatePhoneNumber(
    phoneNumberId: number | string,
    payload: Record<string, unknown>,
  ): Promise<TryCatchResult<PhoneNumber>> {
    return await crud.updateOne(phoneNumberId, payload) as TryCatchResult<PhoneNumber>
  }

  return {
    fetchPhoneNumbers,
    fetchPhoneNumber,
    createPhoneNumber,
    updatePhoneNumber,
  }
}
