import type { TryCatchResult } from '~/types/api'
import type {
  BusinessPartner,
  BusinessPartnerAddress,
  BusinessPartnerContact,
  BusinessPartnerPhoneNumber,
} from '~/types/directus'
import { splitAccountManagerIds } from '~/config/accountManagers'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

const LIST_FIELDS: string[] = [
  'id',
  'name',
  'status',
  'relationship_type',
  'is_national_account',
  'business_partner_groups_id.id',
  'business_partner_groups_id.name',
]

// Top-level `business_partners` fields covered by free-text search.
const SEARCHABLE_PARTNER_FIELDS: string[] = ['name', 'account_number', 'website']

const DETAIL_DEEP: Record<string, { _limit: number, _sort: string[] }> = {
  contacts: { _limit: -1, _sort: ['contacts_sort', 'id'] },
  addresses: { _limit: -1, _sort: ['addresses_sort', 'id'] },
  phone_numbers: { _limit: -1, _sort: ['id'] },
  business_partners_shipping_accounts: { _limit: -1, _sort: ['shipping_accounts_sort'] },
}

const CONTACT_JUNCTION_FIELDS: string[] = [
  'id',
  'contacts_sort',
  'status',
  'remarks',
  'inactive_note',
  'allow_transactional_email',
  'allow_transactional_sms',
  'allow_marketing_email',
  'allow_marketing_sms',
  'business_partners_addresses_id',
  'contacts_id.id',
  'contacts_id.first_name',
  'contacts_id.middle_name',
  'contacts_id.last_name',
  'contacts_id.job_title',
  'contacts_id.email_address',
  'contacts_id.phone_numbers.id',
  'contacts_id.phone_numbers.phone_numbers_default',
  'contacts_id.phone_numbers.phone_numbers_id.id',
  'contacts_id.phone_numbers.phone_numbers_id.number',
  'contacts_id.phone_numbers.phone_numbers_id.extension',
  'contacts_id.phone_numbers.phone_numbers_id.type',
  'contacts_id.phone_numbers.phone_numbers_id.sms_capable',
  'contacts_id.phone_numbers.phone_numbers_id.countries_id.id',
  'contacts_id.phone_numbers.phone_numbers_id.countries_id.name',
  'contacts_id.phone_numbers.phone_numbers_id.countries_id.phone_code',
  'contacts_id.phone_numbers.phone_numbers_id.countries_id.code',
]

const ADDRESS_JUNCTION_FIELDS: string[] = [
  'id',
  'addresses_sort',
  'is_billing_address',
  'is_shipping_address',
  'status',
  'inactive_note',
  'remarks',
  'tags',
  'addresses_id.id',
  'addresses_id.street_line_1',
  'addresses_id.street_line_2',
  'addresses_id.city',
  'addresses_id.postal_code',
  'addresses_id.countries_id.id',
  'addresses_id.countries_id.name',
  'addresses_id.countries_id.code',
  'addresses_id.regions_id.id',
  'addresses_id.regions_id.name',
  'addresses_id.regions_id.code',
  'addresses_id.latitude',
  'addresses_id.longitude',
]

const DETAIL_FIELDS: string[] = [
  ...LIST_FIELDS,
  'website',
  'remarks',
  'logo_id',
  'account_number',
  'shopify_id',
  'default_shipping_business_partners_addresses_id',
  'default_billing_business_partners_addresses_id',
  // Account Information panel — representative, default contacts, default carriers
  'account_manager_id.id',
  'account_manager_id.first_name',
  'account_manager_id.last_name',
  'default_sales_business_partners_contacts_id.id',
  'default_sales_business_partners_contacts_id.contacts_id.first_name',
  'default_sales_business_partners_contacts_id.contacts_id.last_name',
  'default_sales_business_partners_contacts_id.contacts_id.job_title',
  'default_sales_business_partners_contacts_id.contacts_id.email_address',
  'default_billing_business_partners_contacts_id.id',
  'default_billing_business_partners_contacts_id.contacts_id.first_name',
  'default_billing_business_partners_contacts_id.contacts_id.last_name',
  'default_billing_business_partners_contacts_id.contacts_id.job_title',
  'default_billing_business_partners_contacts_id.contacts_id.email_address',
  'default_parcel_business_partners_shipping_accounts_id.id',
  'default_parcel_business_partners_shipping_accounts_id.shipping_accounts_id.account_number',
  'default_parcel_business_partners_shipping_accounts_id.shipping_accounts_id.shipping_carriers_id.name',
  'default_ltl_business_partners_shipping_accounts_id.id',
  'default_ltl_business_partners_shipping_accounts_id.shipping_accounts_id.account_number',
  'default_ltl_business_partners_shipping_accounts_id.shipping_accounts_id.shipping_carriers_id.name',
  // Shipping accounts via junction (powers the account drawer without a refetch)
  'business_partners_shipping_accounts.id',
  'business_partners_shipping_accounts.shipping_accounts_sort',
  'business_partners_shipping_accounts.shipping_accounts_id.id',
  'business_partners_shipping_accounts.shipping_accounts_id.status',
  'business_partners_shipping_accounts.shipping_accounts_id.account_number',
  'business_partners_shipping_accounts.shipping_accounts_id.shipping_carriers_id.id',
  'business_partners_shipping_accounts.shipping_accounts_id.shipping_carriers_id.name',
  'business_partners_shipping_accounts.shipping_accounts_id.shipping_groups_id.id',
  'business_partners_shipping_accounts.shipping_accounts_id.shipping_groups_id.name',
  'business_partners_shipping_accounts.shipping_accounts_id.default_shipping_methods_id.id',
  'business_partners_shipping_accounts.shipping_accounts_id.default_shipping_methods_id.name',
  'date_created',
  'date_updated',
  'contacts.id',
  'contacts.contacts_sort',
  'contacts.status',
  'contacts.remarks',
  'contacts.inactive_note',
  'contacts.allow_transactional_email',
  'contacts.allow_transactional_sms',
  'contacts.allow_marketing_email',
  'contacts.allow_marketing_sms',
  'contacts.business_partners_addresses_id',
  'contacts.contacts_id.id',
  'contacts.contacts_id.first_name',
  'contacts.contacts_id.middle_name',
  'contacts.contacts_id.last_name',
  'contacts.contacts_id.job_title',
  'contacts.contacts_id.email_address',
  'addresses.id',
  'addresses.addresses_sort',
  'addresses.is_billing_address',
  'addresses.is_shipping_address',
  'addresses.status',
  'addresses.inactive_note',
  'addresses.remarks',
  'addresses.tags',
  'addresses.addresses_id.id',
  'addresses.addresses_id.street_line_1',
  'addresses.addresses_id.street_line_2',
  'addresses.addresses_id.city',
  'addresses.addresses_id.postal_code',
  'addresses.addresses_id.countries_id.id',
  'addresses.addresses_id.countries_id.name',
  'addresses.addresses_id.countries_id.code',
  'addresses.addresses_id.regions_id.id',
  'addresses.addresses_id.regions_id.name',
  'addresses.addresses_id.regions_id.code',
  'addresses.addresses_id.latitude',
  'addresses.addresses_id.longitude',
  // Phone numbers via junction (business partner level)
  'phone_numbers.id',
  'phone_numbers.phone_numbers_id.id',
  'phone_numbers.phone_numbers_id.number',
  'phone_numbers.phone_numbers_id.extension',
  'phone_numbers.phone_numbers_id.type',
  'phone_numbers.phone_numbers_id.sms_capable',
  'phone_numbers.phone_numbers_id.countries_id.id',
  'phone_numbers.phone_numbers_id.countries_id.name',
  'phone_numbers.phone_numbers_id.countries_id.phone_code',
  'phone_numbers.phone_numbers_id.countries_id.code',
  // Phone numbers via contact junction
  'contacts.contacts_id.phone_numbers.id',
  'contacts.contacts_id.phone_numbers.phone_numbers_default',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.id',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.number',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.extension',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.type',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.sms_capable',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.id',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.name',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.phone_code',
  'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.code',
]

interface FetchBusinessPartnersOptions {
  relationshipType?: string | null
  status?: string | null
  statusValues?: string[] | null
  accountManagerIds?: string[] | null
  businessPartnerGroupIds?: number[] | null
  excludeGroupIds?: number[] | null
  manufacturerIds?: number[] | null
  isNationalAccountOnly?: boolean
  // Restrict to partners that already have a SAP id. Used by the detail-page
  // Next/Prev sequence so not-yet-synced records (null account_number, which the
  // DB sorts to the very end) don't pollute it and leave the Prev wrap target
  // unroutable.
  requireSapId?: boolean
  // Partner ids to exclude from the result AND the count (e.g. already-associated
  // rows a picker filters out) — keeps the running total in step with the list.
  excludeIds?: Array<number | string> | null
  search?: string | null
  limit?: number
  page?: number
  offset?: number | null
  sort?: string[] | null
  fields?: string[] | null
  deep?: Record<string, unknown> | null
}

interface BuildPartnerFilterOptions {
  relationshipType?: string | null
  status?: string | null
  statusValues?: string[] | null
  accountManagerIds?: string[] | null
  businessPartnerGroupIds?: number[] | null
  excludeGroupIds?: number[] | null
  manufacturerIds?: number[] | null
  isNationalAccountOnly?: boolean
  requireSapId?: boolean
  excludeIds?: Array<number | string> | null
  search?: string | null
}

interface FetchPartnerContactsOptions {
  search?: string | null
  limit?: number
  page?: number
}

interface FetchPartnerAddressesOptions {
  search?: string | null
  limit?: number
  page?: number
}

interface FindDuplicatePartnerOptions {
  relationshipType: string
  /** Full entered email — enables exact matching for generic provider domains. */
  email?: string | null
  emailDomain?: string | null
  websiteDomain?: string | null
  name?: string | null
}

interface DuplicateMatch {
  partner: Record<string, unknown>
  matchType: string
  matchValue: string
}

// A supplier's associated manufacturers, read through the
// `manufacturers_business_partners` junction (status / remarks / sort live on
// the junction row; name / website / logo come from the linked manufacturer).
export interface BusinessPartnerManufacturer {
  id: number | string            // junction row id (the editable/reorderable record)
  manufacturerId: number | string
  name: string
  website: string | null
  logoId: string | null
  status: string                 // 'active' | 'inactive' — per-relationship
  remarks: string | null
  sortOrder: number | null       // manufacturers_sort
}

const PARTNER_MANUFACTURER_FIELDS: string[] = [
  'manufacturers.id',
  'manufacturers.status',
  'manufacturers.remarks',
  'manufacturers.manufacturers_sort',
  'manufacturers.manufacturers_id.id',
  'manufacturers.manufacturers_id.name',
  'manufacturers.manufacturers_id.website',
  'manufacturers.manufacturers_id.logo_id',
]

interface UseBusinessPartnersReturn {
  fetchBusinessPartners: (options?: FetchBusinessPartnersOptions) => Promise<TryCatchResult<BusinessPartner[]>>
  fetchBusinessPartner: (partnerId: number | string) => Promise<TryCatchResult<BusinessPartner>>
  fetchBusinessPartnerByAccountNumber: (accountNumber: string) => Promise<TryCatchResult<BusinessPartner | null>>
  fetchPartnerSyncState: (partnerId: number | string) => Promise<TryCatchResult<Record<string, any>>>
  fetchBusinessPartnerCount: (options?: FetchBusinessPartnersOptions) => Promise<TryCatchResult<number>>
  createBusinessPartner: (payload: Record<string, unknown>) => Promise<TryCatchResult<BusinessPartner>>
  updateBusinessPartner: (partnerId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<BusinessPartner>>
  createPartnerContact: (payload: Record<string, unknown>) => Promise<TryCatchResult<BusinessPartnerContact>>
  updatePartnerContact: (junctionId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<BusinessPartnerContact>>
  createPartnerAddress: (payload: Record<string, unknown>) => Promise<TryCatchResult<BusinessPartnerAddress>>
  updatePartnerAddress: (junctionId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<BusinessPartnerAddress>>
  reorderPartnerAddresses: (orderedRows: Array<{ id: number | string, currentSort: number | null }>) => Promise<TryCatchResult<boolean>>
  reorderPartnerContacts: (orderedRows: Array<{ id: number | string, currentSort: number | null }>) => Promise<TryCatchResult<boolean>>
  fetchPartnerManufacturers: (partnerId: number | string) => Promise<TryCatchResult<BusinessPartnerManufacturer[]>>
  updatePartnerManufacturer: (junctionId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<unknown>>
  reorderPartnerManufacturers: (orderedRows: Array<{ id: number | string, currentSort: number | null }>) => Promise<TryCatchResult<boolean>>
  addPartnerManufacturers: (partnerId: number | string, manufacturerIds: Array<number | string>, startSort?: number) => Promise<TryCatchResult<Record<string, unknown>>[]>
  createPartnerPhoneNumber: (payload: Record<string, unknown>) => Promise<TryCatchResult<BusinessPartnerPhoneNumber>>
  fetchPartnerContacts: (partnerId: number | string, options?: FetchPartnerContactsOptions) => Promise<TryCatchResult<BusinessPartnerContact[]>>
  fetchPartnerContactsCount: (partnerId: number | string, search?: string | null) => Promise<TryCatchResult<number>>
  fetchPartnerAddresses: (partnerId: number | string, options?: FetchPartnerAddressesOptions) => Promise<TryCatchResult<BusinessPartnerAddress[]>>
  fetchPartnerAddressesCount: (partnerId: number | string, search?: string | null) => Promise<TryCatchResult<number>>
  findDuplicatePartner: (options?: FindDuplicatePartnerOptions) => Promise<TryCatchResult<DuplicateMatch | null>>
}

/**
 * Composable for business_partners collection with junction table support.
 */
export function useBusinessPartners(): UseBusinessPartnersReturn {
  const partnerCrud = useDirectusCrud('business_partners')
  const contactJunctionCrud = useDirectusCrud('business_partners_contacts')
  const addressJunctionCrud = useDirectusCrud('business_partners_addresses')
  const phoneJunctionCrud = useDirectusCrud('business_partners_phone_numbers')
  const manufacturerJunctionCrud = useDirectusCrud('manufacturers_business_partners')
  const companySettings = useCompanySettingsStore()

  // Stored numbers SHOULD be digits-only — the `phone_numbers.number` schema
  // validates `^[0-9]{4,20}$` — but ~24k legacy rows predate that rule and still
  // hold separators (e.g. "914-361-5557", "914 361 5557"). For a full national
  // number we also probe those common stored formats so a digit search like
  // "(914) 361-5557" still finds the legacy records until the data is normalized.
  function phoneNumberFormatVariants(digits: string): string[] {
    if (digits.length === 10) {
      const area = digits.slice(0, 3)
      const prefix = digits.slice(3, 6)
      const line = digits.slice(6)
      return [
        `${area}-${prefix}-${line}`, // 914-361-5557 (legacy dashed — the bulk)
        `${area} ${prefix} ${line}`, // 914 361 5557 (legacy spaced)
        `(${area}) ${prefix}-${line}`, // (914) 361-5557
      ]
    }
    if (digits.length === 7) {
      return [`${digits.slice(0, 3)}-${digits.slice(3)}`] // 361-5557
    }
    return []
  }

  function buildPhoneConditions(term: string): Record<string, unknown>[] {
    const digits = term.replace(/\D/g, '')
    const hasPlusPrefix = term.startsWith('+')
    const conditions: Record<string, unknown>[] = []

    if (digits.length >= 3) {
      // Match the bare digit string plus the common stored separator formats, so
      // both clean (digits-only) and legacy (formatted) records are found.
      for (const pattern of [digits, ...phoneNumberFormatVariants(digits)]) {
        conditions.push({ phone_numbers: { phone_numbers_id: { number: { _icontains: pattern } } } })
        conditions.push({ contacts: { contacts_id: { phone_numbers: { phone_numbers_id: { number: { _icontains: pattern } } } } } })
      }

      const maxPrefixLength = Math.min(3, digits.length - 3)
      for (let prefixLength = 1; prefixLength <= maxPrefixLength; prefixLength++) {
        const code = digits.slice(0, prefixLength)
        const national = digits.slice(prefixLength)
        // The `number` column holds only the national part (the country code
        // lives in countries_id) and may be digits-only or formatted, so match
        // the national part in the same separator variants as a bare number.
        // This is what makes "+1 (320) 455-4670" find a stored "320-455-4670".
        for (const nationalPattern of [national, ...phoneNumberFormatVariants(national)]) {
          const splitMatch = {
            phone_numbers_id: {
              number: { _icontains: nationalPattern },
              countries_id: { phone_code: { _eq: code } },
            },
          }
          conditions.push({ phone_numbers: splitMatch })
          conditions.push({ contacts: { contacts_id: { phone_numbers: splitMatch } } })
        }
      }
    }

    // Leading "+" is an explicit phone-search trigger so the search reacts even
    // before the user has typed enough digits for a number match: bare "+"
    // matches any phone with a country code, "+1"/"+44" prefix-match the code.
    if (hasPlusPrefix && digits.length < 3) {
      const codeMatch = digits.length === 0
        ? { _nnull: true }
        : { _starts_with: digits }
      const phoneCodeFilter = { phone_numbers_id: { countries_id: { phone_code: codeMatch } } }
      conditions.push({ phone_numbers: phoneCodeFilter })
      conditions.push({ contacts: { contacts_id: { phone_numbers: phoneCodeFilter } } })
    }

    return conditions
  }

  // Normalize phone-formatted input: when the term is digits with only phone
  // separators (dash, space, paren, plus), strip the noise so "66-" or
  // "(555) 123" behave the same as their digit-only form against text fields.
  function normalizeSearchTerm(rawTerm: string): string {
    const digits = rawTerm.replace(/\D/g, '')
    const nonDigitChars = rawTerm.replace(/\d/g, '')
    const isPhoneFormatted = digits.length > 0 && /^[-+()\s]*$/.test(nonDigitChars)
    return isPhoneFormatted ? digits : rawTerm
  }

  // Top-level (own-column) search conditions — flat, so they're safe in both the
  // list read AND the count(*) aggregate.
  function buildTopLevelSearchConditions(term: string): Record<string, unknown>[] {
    return SEARCHABLE_PARTNER_FIELDS.map((field) => ({ [field]: { _icontains: term } }))
  }

  // Related-collection search conditions (contacts + phone numbers). These are
  // TO-MANY, so a plain count(*) over them multiplies the parent across the join
  // and inflates the total. They still go into the search `_or`: the list read
  // resolves them with subqueries (each parent returned once) and the count uses
  // countDistinct(id) (see fetchBusinessPartnerCount), which together keep
  // list count == footer count == toast count.
  function buildRelationalSearchConditions(rawTerm: string, term: string): Record<string, unknown>[] {
    return [
      ...buildPhoneConditions(rawTerm),
      {
        contacts: {
          _and: term.split(/\s+/).map((token) => ({
            contacts_id: {
              _or: [
                { first_name: { _icontains: token } },
                { last_name: { _icontains: token } },
              ],
            },
          })),
        },
      },
      { contacts: { contacts_id: { email_address: { _icontains: term } } } },
    ]
  }

  /**
   * Build filter object for business partner queries.
   */
  function effectiveStatusesOf(options: BuildPartnerFilterOptions): string[] | null {
    return options.statusValues?.length ? options.statusValues : (options.status ? [options.status] : null)
  }

  // Non-search structural conditions (relationship, status, manager, group, …).
  function buildBaseConditions(options: BuildPartnerFilterOptions): Record<string, unknown>[] {
    const {
      relationshipType = null,
      accountManagerIds = null,
      businessPartnerGroupIds = null,
      excludeGroupIds = null,
      manufacturerIds = null,
      isNationalAccountOnly = false,
      requireSapId = false,
      excludeIds = null,
    } = options
    const conditions: Record<string, unknown>[] = []

    if (relationshipType) {
      conditions.push({ relationship_type: { _eq: relationshipType } })
    }
    if (requireSapId) {
      conditions.push({ account_number: { _nnull: true } })
    }
    if (excludeIds?.length) {
      conditions.push({ id: { _nin: excludeIds } })
    }
    const effectiveStatuses = effectiveStatusesOf(options)
    if (effectiveStatuses) {
      conditions.push({ status: { _in: effectiveStatuses } })
    }
    if (accountManagerIds?.length) {
      // "Unassigned" is a pseudo-manager, not a Directus user — it means
      // account_manager_id IS NULL. Selected alongside real managers it has to widen
      // the set (this manager's accounts OR nobody's), so the two combine as an _or
      // rather than an _in that would never match the sentinel.
      const { managerIds, includeUnassigned } = splitAccountManagerIds(accountManagerIds)

      if (managerIds.length && includeUnassigned) {
        conditions.push({
          _or: [
            { account_manager_id: { _in: managerIds } },
            { account_manager_id: { _null: true } },
          ],
        })
      } else if (includeUnassigned) {
        conditions.push({ account_manager_id: { _null: true } })
      } else {
        conditions.push({ account_manager_id: { _in: managerIds } })
      }
    }
    if (businessPartnerGroupIds?.length) {
      conditions.push({ business_partner_groups_id: { _in: businessPartnerGroupIds } })
    }
    if (excludeGroupIds?.length) {
      conditions.push({ business_partner_groups_id: { _nin: excludeGroupIds } })
    }
    if (manufacturerIds?.length) {
      conditions.push({ price_lists: { manufacturers_id: { _in: manufacturerIds } } })
    }
    if (isNationalAccountOnly) {
      conditions.push({ is_national_account: { _eq: true } })
    }
    return conditions
  }

  // Build the partner filter used by BOTH the list read and the distinct count,
  // so they stay a single source of truth. The to-many search conditions
  // (contacts, phone numbers) go straight into the search `_or` as relational
  // filters: Directus resolves those with subqueries, so the list read still
  // returns each parent once. The count pairs this with countDistinct(id) (see
  // fetchBusinessPartnerCount) so join fan-out across those relations can't
  // inflate the total. Previously the relational matches were pre-resolved to a
  // flat `{ id: { _in: [...] } }`; for a short, common term (e.g. "t" or "th")
  // that id set ran to thousands and overflowed the GET request URL, failing the
  // whole search — narrower terms fit, which is why 3+ characters "worked".
  function buildPartnerFilter(options: BuildPartnerFilterOptions = {}): Record<string, unknown> | null {
    const conditions = buildBaseConditions(options)

    const rawTerm = options.search?.trim()
    if (rawTerm) {
      const term = normalizeSearchTerm(rawTerm)
      const searchOr: Record<string, unknown>[] = [
        ...buildTopLevelSearchConditions(term),
        ...buildRelationalSearchConditions(rawTerm, term),
      ]
      conditions.push({ _or: searchOr })
    }

    if (conditions.length === 0) {
      return null
    }
    if (conditions.length === 1) {
      return conditions[0]
    }
    return { _and: conditions }
  }

  async function fetchBusinessPartners(options: FetchBusinessPartnersOptions = {}): Promise<TryCatchResult<BusinessPartner[]>> {
    const { limit = 25, page = 1, offset = null, sort = null, fields = null, deep = null } = options

    const query: Record<string, unknown> = {
      fields: fields || LIST_FIELDS,
      sort: sort || ['name'],
      limit,
    }

    if (offset != null) {
      query.offset = offset
    } else if (limit >= 0) {
      query.page = page
    }

    if (deep) {
      query.deep = deep
    }
    const filter = buildPartnerFilter(options)
    if (filter) {
      query.filter = filter
    }

    return await partnerCrud.fetchMany(query)
  }

  async function fetchBusinessPartner(partnerId: number | string): Promise<TryCatchResult<BusinessPartner>> {
    return await partnerCrud.fetchOne(partnerId, { fields: DETAIL_FIELDS, deep: DETAIL_DEEP })
  }

  // Best-effort read of the SAP-sync write-back fields for a partner. The Directus
  // sync flow stamps `sync_status` / `sync_error` on the record when it can't
  // enqueue the job (sync service unreachable, or a licence/credentials rejection),
  // so the detail page can surface the real reason once the realtime status channel
  // has gone quiet without a terminal event.
  //
  // Those two fields may not exist yet in every environment; if the field-scoped
  // read rejects (unknown field → 400) we fall back to the always-valid
  // id/account_number subset, so SAP-id recovery still works — just without a
  // reason string.
  async function fetchPartnerSyncState(partnerId: number | string): Promise<TryCatchResult<Record<string, any>>> {
    const withReason = await partnerCrud.fetchOne(partnerId, {
      fields: ['id', 'account_number', 'sync_status', 'sync_error'],
    })
    if (!withReason.error) {
      return withReason
    }
    return await partnerCrud.fetchOne(partnerId, { fields: ['id', 'account_number'] })
  }

  async function fetchBusinessPartnerByAccountNumber(accountNumber: string): Promise<TryCatchResult<BusinessPartner | null>> {
    const { data: partners, error } = await partnerCrud.fetchMany({
      fields: DETAIL_FIELDS,
      deep: DETAIL_DEEP,
      filter: { account_number: { _eq: accountNumber } },
      limit: 1,
    })

    if (error) {
      return { data: null, error }
    }

    return { data: partners?.[0] || null, error: null }
  }

  async function fetchBusinessPartnerCount(options: FetchBusinessPartnersOptions = {}): Promise<TryCatchResult<number>> {
    // Same filter as fetchBusinessPartners. Its search `_or` includes to-many
    // (contact/phone) conditions, so count DISTINCT partner ids — join fan-out
    // across those relations can't inflate the total, and it stays equal to the
    // list count.
    const filter = buildPartnerFilter(options)
    return await partnerCrud.fetchCount(filter, null, 'id')
  }
  function withNormalizedWebsite(payload: Record<string, unknown>): Record<string, unknown> {
    if (!('website' in payload)) { return payload }
    return { ...payload, website: normalizeWebsite(payload.website) }
  }

  async function createBusinessPartner(payload: Record<string, unknown>): Promise<TryCatchResult<BusinessPartner>> {
    return await partnerCrud.createOne(withNormalizedWebsite(payload))
  }

  async function updateBusinessPartner(partnerId: number | string, payload: Record<string, unknown>): Promise<TryCatchResult<BusinessPartner>> {
    // Callers only check for an error, never the returned record — so ask
    // Directus to return just the id instead of re-fetching/serialising the full
    // partner (with all its contact/address id arrays).
    return await partnerCrud.updateOne(partnerId, withNormalizedWebsite(payload), { fields: ['id'] })
  }

  async function createPartnerContact(payload: Record<string, unknown>): Promise<TryCatchResult<BusinessPartnerContact>> {
    return await contactJunctionCrud.createOne(payload)
  }

  async function updatePartnerContact(junctionId: number | string, payload: Record<string, unknown>): Promise<TryCatchResult<BusinessPartnerContact>> {
    return await contactJunctionCrud.updateOne(junctionId, payload)
  }

  async function createPartnerAddress(payload: Record<string, unknown>): Promise<TryCatchResult<BusinessPartnerAddress>> {
    return await addressJunctionCrud.createOne(payload)
  }

  async function updatePartnerAddress(junctionId: number | string, payload: Record<string, unknown>): Promise<TryCatchResult<BusinessPartnerAddress>> {
    return await addressJunctionCrud.updateOne(junctionId, payload)
  }

  /**
   * Persist a manual address order. `orderedRows` is the full set of junction
   * rows in their new top-to-bottom order, each carrying its current stored
   * `addresses_sort` (`currentSort`). Only rows whose position actually changed
   * are written — a 1↔2 swap sends two rows, not the whole list — while the
   * untouched rows keep their existing value, so the stored sequence stays dense
   * and matches the `['addresses_sort', 'id']` fetch ordering. A no-op reorder
   * (nothing moved) issues no request at all.
   */
  async function reorderPartnerAddresses(
    orderedRows: Array<{ id: number | string, currentSort: number | null }>,
  ): Promise<TryCatchResult<boolean>> {
    const updates = orderedRows
      .map((row, index) => ({ id: row.id, addresses_sort: index, currentSort: row.currentSort }))
      .filter((row) => row.currentSort !== row.addresses_sort)
      .map(({ id, addresses_sort }) => ({ id, addresses_sort }))

    if (updates.length === 0) {
      return { data: true, error: null }
    }

    const { error } = await addressJunctionCrud.updateBatch(updates)
    if (error) {
      return { data: null, error }
    }
    return { data: true, error: null }
  }

  /**
   * Persist a manual contact order. Mirrors `reorderPartnerAddresses`: only rows
   * whose position actually changed are written (`contacts_sort` = new index),
   * so a swap sends the moved rows rather than the whole list, and a no-op
   * reorder issues no request.
   */
  async function reorderPartnerContacts(
    orderedRows: Array<{ id: number | string, currentSort: number | null }>,
  ): Promise<TryCatchResult<boolean>> {
    const updates = orderedRows
      .map((row, index) => ({ id: row.id, contacts_sort: index, currentSort: row.currentSort }))
      .filter((row) => row.currentSort !== row.contacts_sort)
      .map(({ id, contacts_sort }) => ({ id, contacts_sort }))

    if (updates.length === 0) {
      return { data: true, error: null }
    }

    const { error } = await contactJunctionCrud.updateBatch(updates)
    if (error) {
      return { data: null, error }
    }
    return { data: true, error: null }
  }

  // A supplier's manufacturers, flattened from the junction so each row carries
  // the editable junction id plus the manufacturer's display fields. Ordered by
  // the manual `manufacturers_sort` (nulls last via the `id` tiebreak), matching
  // the reorder writes below.
  async function fetchPartnerManufacturers(partnerId: number | string): Promise<TryCatchResult<BusinessPartnerManufacturer[]>> {
    const { data, error } = await partnerCrud.fetchOne(partnerId, {
      fields: PARTNER_MANUFACTURER_FIELDS,
      deep: { manufacturers: { _limit: -1, _sort: ['manufacturers_sort', 'id'] } },
    })
    if (error) {
      return { data: null, error }
    }

    const junctions = ((data as any)?.manufacturers ?? []) as Record<string, any>[]
    const manufacturers: BusinessPartnerManufacturer[] = junctions
      .filter((junction) => junction.manufacturers_id)
      .map((junction) => ({
        id: junction.id,
        manufacturerId: junction.manufacturers_id.id,
        name: junction.manufacturers_id.name ?? '',
        website: junction.manufacturers_id.website ?? null,
        logoId: junction.manufacturers_id.logo_id ?? null,
        status: junction.status ?? 'active',
        remarks: junction.remarks ?? null,
        sortOrder: junction.manufacturers_sort ?? null,
      }))

    return { data: manufacturers, error: null }
  }

  // Patch a single supplier↔manufacturer junction row (status / remarks). Only
  // the junction id is requested back — callers check `error`, not the record.
  async function updatePartnerManufacturer(junctionId: number | string, payload: Record<string, unknown>): Promise<TryCatchResult<unknown>> {
    return await manufacturerJunctionCrud.updateOne(junctionId, payload, { fields: ['id'] })
  }

  /**
   * Persist a manual manufacturer order. Mirrors `reorderPartnerContacts`: only
   * rows whose position actually changed are written (`manufacturers_sort` = new
   * index), so a swap sends the moved rows rather than the whole list, and a
   * no-op reorder issues no request.
   */
  async function reorderPartnerManufacturers(
    orderedRows: Array<{ id: number | string, currentSort: number | null }>,
  ): Promise<TryCatchResult<boolean>> {
    const updates = orderedRows
      .map((row, index) => ({ id: row.id, manufacturers_sort: index, currentSort: row.currentSort }))
      .filter((row) => row.currentSort !== row.manufacturers_sort)
      .map(({ id, manufacturers_sort }) => ({ id, manufacturers_sort }))

    if (updates.length === 0) {
      return { data: true, error: null }
    }

    const { error } = await manufacturerJunctionCrud.updateBatch(updates)
    if (error) {
      return { data: null, error }
    }
    return { data: true, error: null }
  }

  /**
   * Associate manufacturers with a supplier — the mirror of
   * `addManufacturerSuppliers` (useManufacturers), writing the same
   * manufacturers_business_partners junction from the partner's side. New rows
   * land at the end of this supplier's manufacturer list (manufacturers_sort).
   *
   * @param {number|string} partnerId
   * @param {Array<number|string>} manufacturerIds
   * @param {number} [startSort=0] first sort position — the current row count
   */
  async function addPartnerManufacturers(
    partnerId: number | string,
    manufacturerIds: Array<number | string>,
    startSort = 0,
  ): Promise<TryCatchResult<Record<string, unknown>>[]> {
    return await Promise.all(
      manufacturerIds.map((manufacturerId, index) =>
        manufacturerJunctionCrud.createOne({
          business_partners_id: partnerId,
          manufacturers_id: manufacturerId,
          status: 'active',
          manufacturers_sort: startSort + index,
        }),
      ),
    )
  }

  async function createPartnerPhoneNumber(payload: Record<string, unknown>): Promise<TryCatchResult<BusinessPartnerPhoneNumber>> {
    return await phoneJunctionCrud.createOne(payload)
  }

  /**
   * Build a Directus filter for partner contact junction queries.
   */
  function buildContactFilter(partnerId: number | string, search: string | null = null): Record<string, unknown> {
    const filter: Record<string, unknown> = { business_partners_id: { _eq: partnerId } }

    if (search) {
      const term = search.trim()
      const nameMatch = {
        _and: term.split(/\s+/).map((token) => ({
          _or: [
            { contacts_id: { first_name: { _icontains: token } } },
            { contacts_id: { last_name: { _icontains: token } } },
          ],
        })),
      }
      return {
        _and: [
          { business_partners_id: { _eq: partnerId } },
          {
            _or: [
              nameMatch,
              { contacts_id: { job_title: { _icontains: term } } },
              { contacts_id: { email_address: { _icontains: term } } },
              { remarks: { _icontains: term } },
            ],
          },
        ],
      }
    }

    return filter
  }

  async function fetchPartnerContacts(partnerId: number | string, options: FetchPartnerContactsOptions = {}): Promise<TryCatchResult<BusinessPartnerContact[]>> {
    const { search = null, limit = 10, page = 1 } = options

    return await contactJunctionCrud.fetchMany({
      fields: CONTACT_JUNCTION_FIELDS,
      filter: buildContactFilter(partnerId, search),
      limit,
      page,
      sort: ['contacts_sort', 'id'],
      deep: { contacts_id: { phone_numbers: { _limit: -1 } } },
    })
  }

  async function fetchPartnerContactsCount(partnerId: number | string, search: string | null = null): Promise<TryCatchResult<number>> {
    return await contactJunctionCrud.fetchCount(buildContactFilter(partnerId, search))
  }

  /**
   * Build a Directus filter for partner address junction queries.
   */
  function buildAddressFilter(partnerId: number | string, search: string | null = null): Record<string, unknown> {
    const filter: Record<string, unknown> = { business_partners_id: { _eq: partnerId } }

    if (search) {
      return {
        _and: [
          { business_partners_id: { _eq: partnerId } },
          {
            _or: [
              { addresses_id: { street_line_1: { _icontains: search } } },
              { addresses_id: { city: { _icontains: search } } },
              { addresses_id: { postal_code: { _icontains: search } } },
              { addresses_id: { regions_id: { name: { _icontains: search } } } },
              { addresses_id: { regions_id: { code: { _icontains: search } } } },
            ],
          },
        ],
      }
    }

    return filter
  }

  async function fetchPartnerAddresses(partnerId: number | string, options: FetchPartnerAddressesOptions = {}): Promise<TryCatchResult<BusinessPartnerAddress[]>> {
    const { search = null, limit = 10, page = 1 } = options

    return await addressJunctionCrud.fetchMany({
      fields: ADDRESS_JUNCTION_FIELDS,
      filter: buildAddressFilter(partnerId, search),
      limit,
      page,
      sort: ['addresses_sort', 'id'],
    })
  }

  async function fetchPartnerAddressesCount(partnerId: number | string, search: string | null = null): Promise<TryCatchResult<number>> {
    return await addressJunctionCrud.fetchCount(buildAddressFilter(partnerId, search))
  }

  async function findDuplicatePartner(options: FindDuplicatePartnerOptions = {} as FindDuplicatePartnerOptions): Promise<TryCatchResult<DuplicateMatch | null>> {
    const { relationshipType, email = null, emailDomain = null, websiteDomain = null, name = null } = options
    const matchFields: string[] = ['id', 'account_number', 'name', 'status']

    const enteredEmail = email?.trim() || null

    // Prefer the full email (enables username-across-generic matching); fall back
    // to a bare domain match when only a domain was supplied.
    let emailCondition: Record<string, unknown> | null = null
    let emailMatchValue = ''
    if (enteredEmail) {
      await companySettings.fetchCompanySettings()
      emailCondition = buildContactEmailDuplicateFilter(enteredEmail, companySettings.genericEmailDomainSet)
      emailMatchValue = enteredEmail
    } else if (emailDomain?.trim()) {
      emailCondition = { email_address: { _icontains: `@${emailDomain.trim().toLowerCase()}` } }
      emailMatchValue = emailDomain.trim().toLowerCase()
    }

    if (emailCondition) {
      const { data: partners, error } = await partnerCrud.fetchMany({
        fields: matchFields,
        filter: {
          _and: [
            { relationship_type: { _eq: relationshipType } },
            { contacts: { contacts_id: emailCondition } },
          ],
        },
        limit: 1,
      })
      if (error) {return { data: null, error }}
      if (partners?.length) {
        return { data: { partner: partners[0], matchType: 'email', matchValue: emailMatchValue }, error: null }
      }
    }

    if (websiteDomain) {
      const { data: partners, error } = await partnerCrud.fetchMany({
        fields: matchFields,
        filter: {
          _and: [
            { relationship_type: { _eq: relationshipType } },
            { website: { _contains: websiteDomain } },
          ],
        },
        limit: 1,
      })
      if (error) {return { data: null, error }}
      if (partners?.length) {
        return { data: { partner: partners[0], matchType: 'website', matchValue: websiteDomain }, error: null }
      }
    }

    // 3. Check name (fuzzy via Directus search)
    if (name && name.length >= 3) {
      const { data: partners, error } = await partnerCrud.fetchMany({
        fields: matchFields,
        filter: { relationship_type: { _eq: relationshipType } },
        search: name,
        limit: 1,
      })
      if (error) {return { data: null, error }}
      if (partners?.length) {
        return { data: { partner: partners[0], matchType: 'name', matchValue: partners[0].name }, error: null }
      }
    }

    return { data: null, error: null }
  }

  return {
    fetchBusinessPartners,
    fetchBusinessPartner,
    fetchBusinessPartnerByAccountNumber,
    fetchPartnerSyncState,
    fetchBusinessPartnerCount,
    createBusinessPartner,
    updateBusinessPartner,
    createPartnerContact,
    updatePartnerContact,
    createPartnerAddress,
    updatePartnerAddress,
    reorderPartnerAddresses,
    reorderPartnerContacts,
    fetchPartnerManufacturers,
    updatePartnerManufacturer,
    reorderPartnerManufacturers,
    addPartnerManufacturers,
    createPartnerPhoneNumber,
    fetchPartnerContacts,
    fetchPartnerContactsCount,
    fetchPartnerAddresses,
    fetchPartnerAddressesCount,
    findDuplicatePartner,
  }
}
