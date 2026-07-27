/**
 * Default-shipper warehouse fetcher (server-only).
 *
 * Resolves the warehouse that drives carrier rate quotes (the row in
 * `warehouses` with `is_default_shipper = true`) and exposes its address
 * fields in the shape downstream FedEx/UPS clients expect.
 *
 * The result is cached in-memory for 5 minutes — warehouses change rarely
 * and we don't want every rate request to hit Directus.
 */

export interface ShipperOrigin {
  postalCode: string
  countryCode: string
  stateCode: string | null
  city: string | null
  streetLine1: string | null
  streetLine2: string | null
}

interface CachedShipper {
  origin: ShipperOrigin
  expiresAt: number
}

const SHIPPER_CACHE_TTL_MS = 5 * 60 * 1000
const shipperCache = new Map<string, CachedShipper>()

export class ShipperLookupError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'ShipperLookupError'
    this.statusCode = statusCode
  }
}

interface DirectusWarehouseResponse {
  data?: Array<{
    id: number
    name: string
    addresses_id?: {
      street_line_1?: string | null
      street_line_2?: string | null
      city?: string | null
      postal_code?: string | null
      regions_id?: { code?: string | null } | null
      countries_id?: { code?: string | null } | null
    } | null
  }>
}

/**
 * Returns the shipper origin for rate quotes.
 *
 * - If `warehouseId` is provided, fetches that specific active warehouse.
 * - Otherwise, returns the warehouse marked `is_default_shipper = true`.
 */
export async function getShipperOrigin(warehouseId: number | null = null): Promise<ShipperOrigin> {
  const cacheKey = warehouseId === null ? 'default' : `id:${warehouseId}`
  const cached = shipperCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.origin
  }

  const runtime = useRuntimeConfig()
  const directusUrl = String(runtime.directusUrl || '').replace(/\/$/, '')
  const directusToken = String(runtime.directusToken || '')

  if (!directusUrl || !directusToken) {
    throw new ShipperLookupError(
      'Directus is not configured (DIRECTUS_URL / NUXT_DIRECTUS_TOKEN missing).',
      500,
    )
  }

  const fields = [
    'id',
    'name',
    'addresses_id.street_line_1',
    'addresses_id.street_line_2',
    'addresses_id.city',
    'addresses_id.postal_code',
    'addresses_id.regions_id.code',
    'addresses_id.countries_id.code',
  ].join(',')

  const url = new URL(`${directusUrl}/items/warehouses`)
  url.searchParams.set('fields', fields)
  url.searchParams.set('filter[status][_eq]', 'active')
  if (warehouseId !== null) {
    url.searchParams.set('filter[id][_eq]', String(warehouseId))
  } else {
    url.searchParams.set('filter[is_default_shipper][_eq]', 'true')
  }
  url.searchParams.set('limit', '1')

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${directusToken}` },
    })
  } catch (error) {
    throw new ShipperLookupError(
      `Directus network error: ${(error as Error).message}`,
      502,
    )
  }

  if (!response.ok) {
    throw new ShipperLookupError(
      `Directus warehouse lookup failed (${response.status})`,
      502,
    )
  }

  const payload = (await response.json()) as DirectusWarehouseResponse
  const warehouse = payload.data?.[0]
  if (!warehouse) {
    throw new ShipperLookupError(
      warehouseId !== null
        ? `Warehouse ${warehouseId} not found or not active.`
        : 'No active default warehouse found in Directus. Set is_default_shipper=true on one warehouse.',
      400,
    )
  }

  const address = warehouse.addresses_id
  if (!address?.postal_code || !address?.countries_id?.code) {
    throw new ShipperLookupError(
      `Default warehouse "${warehouse.name}" is missing required address fields (postal_code / countries_id).`,
      500,
    )
  }

  const origin: ShipperOrigin = {
    postalCode: String(address.postal_code).trim(),
    countryCode: String(address.countries_id.code).trim().toUpperCase(),
    stateCode: address.regions_id?.code ? String(address.regions_id.code).trim() : null,
    city: address.city ? String(address.city).trim() : null,
    streetLine1: address.street_line_1 ? String(address.street_line_1).trim() : null,
    streetLine2: address.street_line_2 ? String(address.street_line_2).trim() : null,
  }

  shipperCache.set(cacheKey, { origin, expiresAt: Date.now() + SHIPPER_CACHE_TTL_MS })
  return origin
}
