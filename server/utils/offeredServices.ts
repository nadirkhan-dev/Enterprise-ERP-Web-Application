/**
 * Which carrier services Liberty actually sells (server-only).
 *
 * The rate APIs are not asked for a service, so they answer with everything the
 * shipment qualifies for — UPS returns Worldwide Express, FedEx returns
 * SmartPost, and Priority1 brokers half a dozen haulers Liberty has no contract
 * with. SupplyHub records what we do sell, and this is the join that enforces it:
 *
 *   shipping_carriers.code  +  shipping_methods.carrier_id  (active methods only)
 *
 * `carrier_id` holds the carrier's own service identity — `03`, `FEDEX_GROUND`,
 * `FEDEX_FREIGHT_PRIORITY` — the same value every rate API echoes back. A
 * method's `status` is therefore the approval switch: activate it in Directus
 * and the service appears; deactivate it and the service stops being quoted.
 * No deploy either way.
 *
 * Priority1 reports a SCAC (`FXFE`) where SupplyHub holds a canonical code
 * (`fedex_freight`), and one carrier can answer to more than one SCAC — FedEx
 * Freight uses FXFE for Priority and FXNL for Economy. That many-to-one aliasing
 * is why there is no single `scac` column: it lives in the typed map below.
 *
 * This lookup FAILS CLOSED. If the approval data cannot be read, no quote is
 * approved — returning unfiltered rates would show carriers Liberty never
 * approved, and a visible empty result is safer than a wrong one.
 */

/**
 * Priority1 carrier SCAC → canonical `shipping_carriers.code`.
 *
 * Source-controlled rather than a Directus column because it is a provider
 * quirk, not Liberty configuration, and because it is many-to-one. Only carriers
 * Liberty has approved belong here; an unmapped SCAC drops out of the results.
 */
export const PRIORITY1_CARRIER_ALIASES: Record<string, string> = {
  FXFE: 'fedex_freight',
  FXNL: 'fedex_freight',
}

/** One approved carrier + service pair, with the canonical names to display. */
export interface OfferedService {
  carrierCode: string
  carrierName: string
  serviceCode: string
  methodName: string
  speedCode: string | null
  speedName: string | null
}

interface CachedCatalogue {
  services: Map<string, OfferedService>
  expiresAt: number
}

const CATALOGUE_CACHE_TTL_MS = 5 * 60 * 1000
let catalogueCache: CachedCatalogue | null = null

interface DirectusMethodResponse {
  data?: Array<{
    name?: string | null
    carrier_id?: string | null
    shipping_carriers_id?: { code?: string | null, name?: string | null } | null
    shipping_speeds_id?: { code?: string | null, name?: string | null } | null
  }>
}

/** The approval key a quote is looked up by: canonical carrier + service code. */
export function approvalKey(carrierCode: string, serviceCode: string): string {
  return `${carrierCode.trim().toLowerCase()}:${serviceCode.trim().toUpperCase()}`
}

export class OfferedServiceLookupError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 502) {
    super(message)
    this.name = 'OfferedServiceLookupError'
    this.statusCode = statusCode
  }
}

/**
 * Every active shipping method, keyed by `carrierCode:SERVICE_CODE`.
 *
 * @throws {OfferedServiceLookupError} when the catalogue cannot be read. The
 *         caller must fail the request rather than quote unapproved carriers.
 */
export async function fetchOfferedServices(): Promise<Map<string, OfferedService>> {
  if (catalogueCache && catalogueCache.expiresAt > Date.now()) {
    return catalogueCache.services
  }

  const runtime = useRuntimeConfig()
  const directusUrl = String(runtime.directusUrl || '').replace(/\/$/, '')
  const directusToken = String(runtime.directusToken || '')
  if (!directusUrl || !directusToken) {
    throw new OfferedServiceLookupError(
      'Directus is not configured (DIRECTUS_URL / NUXT_DIRECTUS_TOKEN missing).',
      500,
    )
  }

  const url = new URL(`${directusUrl}/items/shipping_methods`)
  url.searchParams.set(
    'fields',
    'name,carrier_id,shipping_carriers_id.code,shipping_carriers_id.name,shipping_speeds_id.code,shipping_speeds_id.name',
  )
  url.searchParams.set('filter[status][_eq]', 'active')
  url.searchParams.set('limit', '-1')

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${directusToken}` },
    })
  } catch (error) {
    throw new OfferedServiceLookupError(`Directus network error: ${(error as Error).message}`)
  }
  if (!response.ok) {
    throw new OfferedServiceLookupError(`Directus method lookup failed (${response.status})`)
  }

  const payload = (await response.json()) as DirectusMethodResponse
  const services = new Map<string, OfferedService>()
  for (const method of payload.data ?? []) {
    const carrierCode = String(method.shipping_carriers_id?.code ?? '').trim()
    const serviceCode = String(method.carrier_id ?? '').trim()
    // A method with no carrier or no service identity cannot approve anything.
    if (!carrierCode || !serviceCode) { continue }
    services.set(approvalKey(carrierCode, serviceCode), {
      carrierCode,
      carrierName: String(method.shipping_carriers_id?.name ?? '').trim() || carrierCode,
      serviceCode,
      methodName: String(method.name ?? '').trim() || serviceCode,
      speedCode: String(method.shipping_speeds_id?.code ?? '').trim() || null,
      speedName: String(method.shipping_speeds_id?.name ?? '').trim() || null,
    })
  }

  // An empty catalogue is a configuration answer, not a failure — every method
  // being inactive legitimately means nothing is on sale.
  catalogueCache = { services, expiresAt: Date.now() + CATALOGUE_CACHE_TTL_MS }
  return services
}

/**
 * The approved service for a quote, or null when Liberty does not sell it.
 *
 * `sourceCarrierCode` is what the rate API reported: a SCAC for Priority1, and
 * the canonical code itself for a direct FedEx or UPS call.
 */
export function matchOfferedService(
  services: Map<string, OfferedService>,
  sourceCarrierCode: string,
  serviceCode: string,
  aliases: Record<string, string> = {},
): OfferedService | null {
  const reported = sourceCarrierCode.trim()
  const canonical = aliases[reported.toUpperCase()] ?? reported
  return services.get(approvalKey(canonical, serviceCode)) ?? null
}

/** Test seam — drops the cached catalogue so the next call re-reads Directus. */
export function resetOfferedServices(): void {
  catalogueCache = null
}
