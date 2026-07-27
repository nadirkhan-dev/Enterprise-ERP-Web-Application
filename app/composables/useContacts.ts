import type { TryCatchResult } from '~/types/api'
import type { Contact } from '~/types/directus'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

const LIST_FIELDS: string[] = [
  'id',
  'first_name',
  'middle_name',
  'last_name',
  'job_title',
  'email_address',
]

const DETAIL_FIELDS: string[] = [
  ...LIST_FIELDS,
  'phone_numbers.id',
  'phone_numbers.phone_numbers_default',
  'phone_numbers.phone_numbers_id.id',
  'phone_numbers.phone_numbers_id.number',
  'phone_numbers.phone_numbers_id.extension',
  'phone_numbers.phone_numbers_id.type',
  'phone_numbers.phone_numbers_id.sms_capable',
  'phone_numbers.phone_numbers_id.countries_id.id',
  'phone_numbers.phone_numbers_id.countries_id.name',
  'phone_numbers.phone_numbers_id.countries_id.phone_code',
  'phone_numbers.phone_numbers_id.countries_id.code',
]

interface FetchContactsOptions {
  filter?: Record<string, unknown> | null
  limit?: number
  page?: number
  search?: string | null
  sort?: string[] | null
}

interface UseContactsReturn {
  fetchContacts: (options?: FetchContactsOptions) => Promise<TryCatchResult<Contact[]>>
  fetchContact: (contactId: number | string) => Promise<TryCatchResult<Contact>>
  createContact: (payload: Record<string, unknown>) => Promise<TryCatchResult<Contact>>
  updateContact: (contactId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<Contact>>
}

/**
 * Composable for contacts collection.
 */
export function useContacts(): UseContactsReturn {
  const crud = useDirectusCrud('contacts')

  async function fetchContacts(options: FetchContactsOptions = {}): Promise<TryCatchResult<Contact[]>> {
    const {
      filter = null,
      limit = 25,
      page = 1,
      search = null,
      sort = null,
    } = options

    const query: Record<string, unknown> = {
      fields: LIST_FIELDS,
      sort: sort || ['last_name', 'first_name'],
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

  async function fetchContact(contactId: number | string): Promise<TryCatchResult<Contact>> {
    return await crud.fetchOne(contactId, { fields: DETAIL_FIELDS })
  }

  async function createContact(payload: Record<string, unknown>): Promise<TryCatchResult<Contact>> {
    return await crud.createOne(payload)
  }

  async function updateContact(contactId: number | string, payload: Record<string, unknown>): Promise<TryCatchResult<Contact>> {
    return await crud.updateOne(contactId, payload)
  }

  return {
    fetchContacts,
    fetchContact,
    createContact,
    updateContact,
  }
}
