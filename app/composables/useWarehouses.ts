import type { TryCatchResult } from '~/types/api'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

// A warehouse's own physical address — used both as a ship-from origin and, for
// inbound estimates, as the destination (e.g. Liberty Supply MSP01).
export interface WarehouseAddress {
  streetLine1: string | null
  streetLine2: string | null
  city: string | null
  postalCode: string | null
  regionCode: string | null
  regionName: string | null
  countryCode: string | null
  countryName: string | null
  latitude: number | null
  longitude: number | null
}

// The supplier (business partner) a warehouse is associated with, if any. The
// warehouse trigger preselects this supplier; its shipping addresses are then
// loaded via useBusinessPartners.fetchBusinessPartner(id).
export interface WarehouseSupplierRef {
  id: number
  accountNumber: string | null
  name: string | null
}

export interface Warehouse {
  id: number
  name: string
  code: string | null
  sapId: string | null
  address: WarehouseAddress | null
  supplier: WarehouseSupplierRef | null
}

interface UseWarehousesReturn {
  fetchWarehouses: () => Promise<TryCatchResult<Warehouse[]>>
}

const WAREHOUSE_FIELDS = [
  'id',
  'name',
  'code',
  'sap_id',
  'addresses_id.street_line_1',
  'addresses_id.street_line_2',
  'addresses_id.city',
  'addresses_id.postal_code',
  'addresses_id.latitude',
  'addresses_id.longitude',
  'addresses_id.regions_id.code',
  'addresses_id.regions_id.name',
  'addresses_id.countries_id.code',
  'addresses_id.countries_id.name',
  'business_partners_id.id',
  'business_partners_id.account_number',
  'business_partners_id.name',
]

interface RawWarehouse {
  id: number
  name: string
  code?: string | null
  sap_id?: string | null
  addresses_id?: {
    street_line_1?: string | null
    street_line_2?: string | null
    city?: string | null
    postal_code?: string | null
    latitude?: number | null
    longitude?: number | null
    regions_id?: { code?: string | null, name?: string | null } | null
    countries_id?: { code?: string | null, name?: string | null } | null
  } | null
  business_partners_id?: {
    id: number
    account_number?: string | null
    name?: string | null
  } | null
}

function mapWarehouse(raw: RawWarehouse): Warehouse {
  const address = raw.addresses_id
  return {
    id: raw.id,
    name: raw.name,
    code: raw.code ?? null,
    sapId: raw.sap_id ?? null,
    address: address
      ? {
          streetLine1: address.street_line_1 ?? null,
          streetLine2: address.street_line_2 ?? null,
          city: address.city ?? null,
          postalCode: address.postal_code ?? null,
          regionCode: address.regions_id?.code ?? null,
          regionName: address.regions_id?.name ?? null,
          countryCode: address.countries_id?.code ?? null,
          countryName: address.countries_id?.name ?? null,
          latitude: address.latitude ?? null,
          longitude: address.longitude ?? null,
        }
      : null,
    supplier: raw.business_partners_id
      ? {
          id: raw.business_partners_id.id,
          accountNumber: raw.business_partners_id.account_number ?? null,
          name: raw.business_partners_id.name ?? null,
        }
      : null,
  }
}

/**
 * Composable for the warehouses collection (ship-from origins). Each warehouse
 * carries its own address plus an optional linked supplier, so the Shipping
 * Estimator can rate from a warehouse, its associated supplier, or MSP01 inbound.
 */
export function useWarehouses(): UseWarehousesReturn {
  const warehousesCrud = useDirectusCrud('warehouses')

  async function fetchWarehouses(): Promise<TryCatchResult<Warehouse[]>> {
    const { data, error } = await warehousesCrud.fetchMany({
      fields: WAREHOUSE_FIELDS,
      filter: { status: { _eq: 'active' } },
      sort: ['sort', 'name'],
    })
    if (error) {
      return { data: null, error }
    }
    return { data: (data as RawWarehouse[]).map(mapWarehouse), error: null }
  }

  return { fetchWarehouses }
}
