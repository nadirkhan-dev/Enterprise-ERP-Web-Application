import type { TryCatchResult } from '~/types/api'
import type { Item, Manufacturer } from '~/types/directus'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

const LIST_FIELDS: string[] = ['id', 'name', 'logo_id']

// Flyout field selections for a manufacturer's associations (loaded lazily when
// the Suppliers / Competitors drawer opens).
const SUPPLIER_DRAWER_FIELDS: string[] = [
  // Junction (manufacturers_business_partners) fields — the editable
  // Connect-side data lives here: sort order, status and remarks.
  'business_partners.id',
  'business_partners.business_partners_sort',
  'business_partners.status',
  'business_partners.remarks',
  'business_partners.business_partners_id.id',
  'business_partners.business_partners_id.name',
  'business_partners.business_partners_id.account_number',
  'business_partners.business_partners_id.logo_id',
  'business_partners.business_partners_id.website',
  'business_partners.business_partners_id.contacts.contacts_id.first_name',
  'business_partners.business_partners_id.contacts.contacts_id.last_name',
  'business_partners.business_partners_id.contacts.contacts_id.email_address',
  'business_partners.business_partners_id.contacts.contacts_id.phone_numbers.phone_numbers_id.number',
  'business_partners.business_partners_id.contacts.contacts_id.phone_numbers.phone_numbers_id.extension',
  'business_partners.business_partners_id.contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.phone_code',
  'business_partners.business_partners_id.contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.code',
]

const COMPETITOR_DRAWER_FIELDS: string[] = [
  // Junction id + sort: the manufacturers_competitors row, so the order can be
  // persisted (competitors_sort) when the user drag-reorders.
  'competitors.id',
  'competitors.competitors_sort',
  'competitors.competitors_id.id',
  'competitors.competitors_id.name',
  'competitors.competitors_id.website',
  'competitors.competitors_id.remarks',
  'competitors.competitors_id.logo_id',
]

export interface ManufacturerSupplier {
  id: number | string
  // manufacturers_business_partners junction id — target for status/remarks/sort updates.
  junctionId: number | string
  name: string
  accountNumber: string | null
  logoId: string | null
  website: string | null
  // Junction status ('active' | 'inactive') and remarks — editable in Connect.
  status: string | null
  remarks: string | null
  // SupplyHub/Connect display order (business_partners_sort).
  sort: number | null
  // First associated contact (name/email/phone), shaped like the contact cards
  // so the drawer can reuse formatPhoneNumber/getPrimaryPhone.
  contact: Record<string, any> | null
}

export interface ManufacturerCompetitor {
  id: number | string
  // manufacturers_competitors junction id — target for sort updates.
  junctionId: number | string
  name: string
  website: string | null
  remarks: string | null
  logoId: string | null
  sort: number | null
}

const DETAIL_FIELDS: string[] = [
  ...LIST_FIELDS,
  'slug',
  'sap_id',
  'description',
  'website',
  'price_lists.id',
  'price_lists.business_partners_id.id',
  'price_lists.business_partners_id.name',
  'price_lists.business_partners_id.website',
]

const ITEM_FIELDS: string[] = ['id', 'sku', 'status', 'mpn', 'description', 'is_standard_sku']

interface FetchManufacturersOptions {
  search?: string | null
  limit?: number
  page?: number
  // Absolute row offset. When provided, supersedes `page` — Directus accepts
  // one or the other. Lets the navigation window fetch arbitrary chunks that
  // need not align with the list's page boundaries.
  offset?: number | null
  sort?: string[] | null
  fields?: string[] | null
  // Directus filter — e.g. the association picker excluding the manufacturers a
  // supplier already carries, so the list and its count agree.
  filter?: Record<string, unknown> | null
}

interface FetchManufacturerItemsOptions {
  limit?: number
  page?: number
  sort?: string[] | null
  search?: string | null
  statusValues?: string[] | null
  isSpecialOrderOnly?: boolean
}

interface FetchManufacturerItemCountOptions {
  search?: string | null
  statusValues?: string[] | null
  isSpecialOrderOnly?: boolean
}

interface UseManufacturersReturn {
  fetchManufacturers: (options?: FetchManufacturersOptions) => Promise<TryCatchResult<Manufacturer[]>>
  fetchManufacturer: (manufacturerId: number | string) => Promise<TryCatchResult<Manufacturer>>
  fetchManufacturerCount: (filter?: Record<string, unknown> | null, search?: string | null) => Promise<TryCatchResult<number>>
  fetchManufacturerItems: (manufacturerId: number | string, options?: FetchManufacturerItemsOptions) => Promise<TryCatchResult<Item[]>>
  fetchManufacturerItemCount: (manufacturerId: number | string, options?: FetchManufacturerItemCountOptions) => Promise<TryCatchResult<number>>
  fetchManufacturerSuppliers: (manufacturerId: number | string) => Promise<TryCatchResult<ManufacturerSupplier[]>>
  fetchManufacturerCompetitors: (manufacturerId: number | string) => Promise<TryCatchResult<ManufacturerCompetitor[]>>
  updateManufacturer: (manufacturerId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<Manufacturer>>
  updateManufacturerSupplier: (junctionId: number | string, payload: { status?: string, remarks?: string | null }) => Promise<TryCatchResult<Record<string, unknown>>>
  reorderManufacturerSuppliers: (orderedJunctionIds: Array<number | string>) => Promise<TryCatchResult<Record<string, unknown>>[]>
  reorderManufacturerCompetitors: (orderedJunctionIds: Array<number | string>) => Promise<TryCatchResult<Record<string, unknown>>[]>
  addManufacturerSuppliers: (manufacturerId: number | string, businessPartnerIds: Array<number | string>, startSort?: number) => Promise<TryCatchResult<Record<string, unknown>>[]>
  addManufacturerCompetitors: (manufacturerId: number | string, competitorIds: Array<number | string>, startSort?: number) => Promise<TryCatchResult<Record<string, unknown>>[]>
}

/**
 * Composable for the manufacturers collection.
 */
export function useManufacturers(): UseManufacturersReturn {
  const manufacturersCrud = useDirectusCrud('manufacturers')
  const itemsCrud = useDirectusCrud('items')
  const supplierJunctionCrud = useDirectusCrud('manufacturers_business_partners')
  const competitorJunctionCrud = useDirectusCrud('manufacturers_competitors')

  async function fetchManufacturers(options: FetchManufacturersOptions = {}): Promise<TryCatchResult<Manufacturer[]>> {
    const {
      limit = 25,
      page = 1,
      offset = null,
      search = null,
      sort = null,
      fields = null,
      filter = null,
    } = options

    const query: Record<string, unknown> = {
      fields: fields || LIST_FIELDS,
      sort: sort || ['name'],
      limit,
    }

    if (filter) {
      query.filter = filter
    }

    // Directus accepts `offset` or `page`, not both — prefer an explicit
    // offset so the navigation window can request chunks at any row
    // boundary. An unlimited query (`limit: -1`) sends neither: pagination
    // is meaningless there, and `page` alongside `limit: -1` yields an
    // empty result set.
    if (offset != null) {
      query.offset = offset
    } else if (limit >= 0) {
      query.page = page
    }

    if (search) {
      query.search = search
    }

    return await manufacturersCrud.fetchMany(query)
  }

  async function fetchManufacturer(manufacturerId: number | string): Promise<TryCatchResult<Manufacturer>> {
    return await manufacturersCrud.fetchOne(manufacturerId, {
      fields: DETAIL_FIELDS,
    })
  }

  async function fetchManufacturerCount(filter: Record<string, unknown> | null = null, search: string | null = null): Promise<TryCatchResult<number>> {
    return await manufacturersCrud.fetchCount(filter, search)
  }

  function buildManufacturerItemsFilter(
    manufacturerId: number | string,
    { statusValues = null, isSpecialOrderOnly = false }: {
      statusValues?: string[] | null
      isSpecialOrderOnly?: boolean
    } = {},
  ): Record<string, unknown> {
    const conditions: Record<string, unknown>[] = [
      { manufacturers_id: { _eq: manufacturerId } },
    ]
    if (statusValues && statusValues.length) {
      conditions.push({ status: { _in: [...statusValues] } })
    }
    // Match /items semantics: unchecked → exclude special-order items
    // (is_standard_sku=true); checked → only special-order items
    // (is_standard_sku=false).
    conditions.push({ is_standard_sku: { _eq: !isSpecialOrderOnly } })
    return { _and: conditions }
  }

  async function fetchManufacturerItems(manufacturerId: number | string, options: FetchManufacturerItemsOptions = {}): Promise<TryCatchResult<Item[]>> {
    const {
      limit = 20,
      page = 1,
      sort = null,
      search = null,
      statusValues = null,
      isSpecialOrderOnly = false,
    } = options

    const query: Record<string, unknown> = {
      fields: ITEM_FIELDS,
      filter: buildManufacturerItemsFilter(manufacturerId, { statusValues, isSpecialOrderOnly }),
      sort: sort || ['sku'],
      limit,
      page,
    }
    if (search) query.search = search

    return await itemsCrud.fetchMany(query)
  }

  async function fetchManufacturerItemCount(
    manufacturerId: number | string,
    options: FetchManufacturerItemCountOptions = {},
  ): Promise<TryCatchResult<number>> {
    const { search = null, statusValues = null, isSpecialOrderOnly = false } = options
    const filter = buildManufacturerItemsFilter(manufacturerId, { statusValues, isSpecialOrderOnly })
    return await itemsCrud.fetchCount(filter, search)
  }

  // Suppliers associated with a manufacturer (manufacturers_business_partners
  // M2M → business_partners). Flattened, with each supplier's first contact so
  // the drawer can render the contact-style card (name / contact / phone /
  // email), mirroring the customer contacts flyout.
  async function fetchManufacturerSuppliers(manufacturerId: number | string): Promise<TryCatchResult<ManufacturerSupplier[]>> {
    const { data, error } = await manufacturersCrud.fetchOne(manufacturerId, {
      fields: SUPPLIER_DRAWER_FIELDS,
      deep: { business_partners: { _limit: -1 } },
    })
    if (error) {
      return { data: null, error }
    }

    const junctions = ((data as any)?.business_partners ?? []) as Record<string, any>[]
    const suppliers: ManufacturerSupplier[] = junctions
      .filter((junction) => junction.business_partners_id)
      .map((junction: Record<string, any>) => {
        const partner = junction.business_partners_id
        return {
          id: partner.id,
          junctionId: junction.id,
          name: partner.name ?? '',
          accountNumber: partner.account_number ?? null,
          logoId: partner.logo_id ?? null,
          website: partner.website ?? null,
          status: junction.status ?? null,
          remarks: junction.remarks ?? null,
          sort: junction.business_partners_sort ?? null,
          contact: partner.contacts?.[0]?.contacts_id ?? null,
        }
      })
      // Display in the Connect/SupplyHub-defined order; nulls sink to the end.
      .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity))

    return { data: suppliers, error: null }
  }

  // Competitors associated with a manufacturer (manufacturers_competitors M2M →
  // competitors). Flattened for the drawer list + "View Details" sub-view.
  async function fetchManufacturerCompetitors(manufacturerId: number | string): Promise<TryCatchResult<ManufacturerCompetitor[]>> {
    const { data, error } = await manufacturersCrud.fetchOne(manufacturerId, {
      fields: COMPETITOR_DRAWER_FIELDS,
      deep: { competitors: { _limit: -1 } },
    })
    if (error) {
      return { data: null, error }
    }

    const junctions = ((data as any)?.competitors ?? []) as Record<string, any>[]
    const competitors: ManufacturerCompetitor[] = junctions
      .filter((junction) => junction.competitors_id)
      .map((junction: Record<string, any>) => ({
        id: junction.competitors_id.id,
        junctionId: junction.id,
        name: junction.competitors_id.name ?? '',
        website: junction.competitors_id.website ?? null,
        remarks: junction.competitors_id.remarks ?? null,
        logoId: junction.competitors_id.logo_id ?? null,
        sort: junction.competitors_sort ?? null,
      }))
      // Display in the SupplyHub-defined order; nulls sink to the end.
      .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity))

    return { data: competitors, error: null }
  }

  async function updateManufacturer(manufacturerId: number | string, payload: Record<string, unknown>): Promise<TryCatchResult<Manufacturer>> {
    return await manufacturersCrud.updateOne(manufacturerId, payload)
  }

  // Edit a supplier association (status / remarks) on the
  // manufacturers_business_partners junction. The relationship is the
  // Manufacturer <> Supplier link as a whole — not item-specific.
  async function updateManufacturerSupplier(
    junctionId: number | string,
    payload: { status?: string, remarks?: string | null },
  ): Promise<TryCatchResult<Record<string, unknown>>> {
    return await supplierJunctionCrud.updateOne(junctionId, payload)
  }

  // Persist a new supplier display order by writing business_partners_sort =
  // position for each junction row (in the given order).
  async function reorderManufacturerSuppliers(
    orderedJunctionIds: Array<number | string>,
  ): Promise<TryCatchResult<Record<string, unknown>>[]> {
    return await Promise.all(
      orderedJunctionIds.map((junctionId, index) =>
        supplierJunctionCrud.updateOne(junctionId, { business_partners_sort: index }),
      ),
    )
  }

  // Associate existing business partners with this manufacturer (creates
  // manufacturers_business_partners junction rows). New rows default to active
  // and are appended after the current list (business_partners_sort).
  async function addManufacturerSuppliers(
    manufacturerId: number | string,
    businessPartnerIds: Array<number | string>,
    startSort = 0,
  ): Promise<TryCatchResult<Record<string, unknown>>[]> {
    return await Promise.all(
      businessPartnerIds.map((businessPartnerId, index) =>
        supplierJunctionCrud.createOne({
          manufacturers_id: manufacturerId,
          business_partners_id: businessPartnerId,
          status: 'active',
          business_partners_sort: startSort + index,
        }),
      ),
    )
  }

  // Persist a new competitor display order (competitors_sort = position).
  async function reorderManufacturerCompetitors(
    orderedJunctionIds: Array<number | string>,
  ): Promise<TryCatchResult<Record<string, unknown>>[]> {
    return await Promise.all(
      orderedJunctionIds.map((junctionId, index) =>
        competitorJunctionCrud.updateOne(junctionId, { competitors_sort: index }),
      ),
    )
  }

  // Associate existing competitors with this manufacturer (creates
  // manufacturers_competitors junction rows). New rows are appended after the
  // current list (competitors_sort). The junction has no status field.
  async function addManufacturerCompetitors(
    manufacturerId: number | string,
    competitorIds: Array<number | string>,
    startSort = 0,
  ): Promise<TryCatchResult<Record<string, unknown>>[]> {
    return await Promise.all(
      competitorIds.map((competitorId, index) =>
        competitorJunctionCrud.createOne({
          manufacturers_id: manufacturerId,
          competitors_id: competitorId,
          competitors_sort: startSort + index,
        }),
      ),
    )
  }

  return {
    fetchManufacturers,
    fetchManufacturer,
    fetchManufacturerCount,
    fetchManufacturerItems,
    fetchManufacturerItemCount,
    fetchManufacturerSuppliers,
    fetchManufacturerCompetitors,
    updateManufacturer,
    updateManufacturerSupplier,
    reorderManufacturerSuppliers,
    reorderManufacturerCompetitors,
    addManufacturerSuppliers,
    addManufacturerCompetitors,
  }
}
