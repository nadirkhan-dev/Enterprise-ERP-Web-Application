import {
  FedexApiError,
  getFedexParcelRates,
  type FedexAddress,
  type FedexPackage,
} from '../../utils/fedex'
import {
  UpsApiError,
  getUpsParcelRates,
  type UpsAddress,
  type UpsPackage,
} from '../../utils/ups'
import {
  Priority1ApiError,
  getPriority1LtlRates,
  resolveAccessorials,
  type Priority1Address,
  type Priority1Package,
} from '../../utils/priority1'
import { getShipperOrigin, ShipperLookupError, type ShipperOrigin } from '../../utils/warehouses'
import {
  fetchOfferedServices,
  matchOfferedService,
  OfferedServiceLookupError,
  PRIORITY1_CARRIER_ALIASES,
  type OfferedService,
} from '../../utils/offeredServices'
import { normalizeAccessorialCodes } from '../../utils/shippingAccessorials'
import { MAX_PARCEL_WEIGHT_LB, resolveStateFromPostalCode, validateDimensions, validatePostalCode } from '../../utils/shippingValidation'
import { AuthError, requireAuthenticatedUser } from '../../utils/auth'
import { enforceRateLimit, RateLimitError } from '../../utils/rateLimit'

interface EstimateRequestBody {
  shippingCategory?: 'parcel' | 'LTL'
  warehouseId?: number | null
  // Explicit ship-from address (supplier / ad-hoc origin). When present with a
  // postal code, it is used as the shipper instead of the warehouse lookup.
  origin?: {
    postalCode?: string
    countryCode?: string
    stateCode?: string
    city?: string
    streetLine1?: string
    streetLine2?: string
  }
  weightLb?: number | null
  lengthIn?: number | null
  widthIn?: number | null
  heightIn?: number | null
  destination?: {
    postalCode?: string
    countryCode?: string
    stateCode?: string
    city?: string
  }
  options?: {
    accessorials?: string[]
  }
}

export interface ShippingEstimate {
  // The HAULING carrier's canonical name, from SupplyHub — never the broker.
  // Priority1 is the rate source and is reported separately as `providerCode`.
  carrier: string
  serviceCode: string
  // The canonical method name from SupplyHub, not the provider's own wording.
  method: string
  cost: number
  currency: string
  transitDays: number | null
  /** Which integration produced the rate: 'priority1', 'fedex', 'ups'. */
  providerCode: string
  /** Canonical speed from the matched method — 'priority_ltl', 'ground', … */
  speedCode: string | null
}

interface ShippingEstimateResponse {
  estimates: ShippingEstimate[]
  warnings: string[]
}

const COUNTRY_CODE_MAP: Record<string, string> = {
  'US': 'US',
  'USA': 'US',
  'UNITED STATES (US)': 'US',
  'UNITED STATES': 'US',
  'CA': 'CA',
  'CAN': 'CA',
  'CANADA': 'CA',
  'MX': 'MX',
  'MEX': 'MX',
  'MEXICO': 'MX',
}

function normalizeCountry(value: unknown): string {
  const upper = String(value ?? '').trim().toUpperCase()
  return COUNTRY_CODE_MAP[upper] || (upper.length === 2 ? upper : 'US')
}

function parsePositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

// Customer-facing markup on the negotiated carrier rate. Both FedEx and
// UPS quotes returned here use the configured account credentials, so
// `totalNetCharge` is the account-negotiated rate (not list rate).
const RATE_MARKUP_MULTIPLIER = 1.5

// Approximate UPS-only uplift to track the Shopify storefront, which prices
// ~4% higher on average. Applied to UPS rates only (not FedEx). Rough alignment,
// not an exact match: express services and heavier shipments land within ~$1–3,
// but light UPS Ground still under-quotes (Shopify marks Ground up much harder on
// light shipments). For an exact match, call the Shopify storefront endpoint.
// Tune this value as observed Shopify/Connect gaps shift.
const UPS_STOREFRONT_ALIGNMENT_FACTOR = 1.04

function applyMarkup(netCharge: number): number {
  return Math.round(netCharge * RATE_MARKUP_MULTIPLIER * 100) / 100
}

// UPS rates get the storefront-alignment uplift on top of the base markup.
function applyUpsMarkup(netCharge: number): number {
  return Math.round(netCharge * RATE_MARKUP_MULTIPLIER * UPS_STOREFRONT_ALIGNMENT_FACTOR * 100) / 100
}

// 20 rate quotes per user per minute is generous for an interactive UI
// and leaves plenty of headroom under the carrier-account rate ceilings.
const RATE_LIMIT_REQUESTS = 20
const RATE_LIMIT_WINDOW_MS = 60 * 1000

export default defineEventHandler(async (event): Promise<ShippingEstimateResponse> => {
  let user
  try {
    user = await requireAuthenticatedUser(event)
  } catch (error) {
    if (error instanceof AuthError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }

  try {
    await enforceRateLimit({
      key: `shipping:estimate:${user.id}`,
      limit: RATE_LIMIT_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
  } catch (error) {
    if (error instanceof RateLimitError) {
      setResponseHeader(event, 'Retry-After', Number(error.retryAfterSeconds))
      throw createError({ statusCode: 429, statusMessage: error.message })
    }
    throw error
  }

  const body = await readBody<EstimateRequestBody>(event)

  let shippingCategory: 'parcel' | 'LTL' = body?.shippingCategory === 'LTL' ? 'LTL' : 'parcel'
  const destinationPostalCode = String(body?.destination?.postalCode ?? '').trim()
  if (!destinationPostalCode) {
    throw createError({ statusCode: 400, statusMessage: 'destination.postalCode is required' })
  }

  const destinationCountry = normalizeCountry(body?.destination?.countryCode)
  const postalError = validatePostalCode({ postalCode: destinationPostalCode, countryCode: destinationCountry })
  if (postalError) {
    throw createError({ statusCode: 400, statusMessage: postalError })
  }
  const weightLb = parsePositiveNumber(body?.weightLb)
  if (!weightLb) {
    throw createError({ statusCode: 400, statusMessage: 'weightLb is required and must be greater than zero' })
  }

  // A parcel over the 150 lb small-parcel limit can't ship via UPS/FedEx parcel,
  // so auto-promote it to LTL freight instead of failing the estimate. Done
  // before validateDimensions so the (much higher) LTL weight cap applies.
  const autoPromotedToLtl = shippingCategory === 'parcel' && weightLb > MAX_PARCEL_WEIGHT_LB
  if (autoPromotedToLtl) {
    shippingCategory = 'LTL'
  }

  const lengthInRaw = parsePositiveNumber(body?.lengthIn)
  const widthInRaw = parsePositiveNumber(body?.widthIn)
  const heightInRaw = parsePositiveNumber(body?.heightIn)
  const dimensionError = validateDimensions({
    shippingCategory,
    weightLb,
    lengthIn: lengthInRaw ?? undefined,
    widthIn: widthInRaw ?? undefined,
    heightIn: heightInRaw ?? undefined,
  })
  if (dimensionError) {
    throw createError({ statusCode: 400, statusMessage: dimensionError })
  }

  const requestedWarehouseId =
    typeof body?.warehouseId === 'number' && Number.isFinite(body.warehouseId) ? body.warehouseId : null

  // Origin: an explicit ship-from address (supplier / ad-hoc) takes precedence
  // over the warehouse lookup, so the estimate can be rated from a supplier's
  // shipping address or a manually-entered postal code. Falls back to the
  // warehouse (or default shipper) when no explicit origin is supplied.
  const originPostalCode = String(body?.origin?.postalCode ?? '').trim()
  let shipperOrigin: ShipperOrigin
  if (originPostalCode) {
    const originCountry = normalizeCountry(body?.origin?.countryCode)
    const originPostalError = validatePostalCode({ postalCode: originPostalCode, countryCode: originCountry })
    if (originPostalError) {
      throw createError({ statusCode: 400, statusMessage: `origin: ${originPostalError}` })
    }
    shipperOrigin = {
      postalCode: originPostalCode,
      countryCode: originCountry,
      stateCode: body?.origin?.stateCode?.trim() || null,
      city: body?.origin?.city?.trim() || null,
      streetLine1: body?.origin?.streetLine1?.trim() || null,
      streetLine2: body?.origin?.streetLine2?.trim() || null,
    }
  } else {
    try {
      shipperOrigin = await getShipperOrigin(requestedWarehouseId)
    } catch (error) {
      if (error instanceof ShipperLookupError) {
        throw createError({ statusCode: error.statusCode, statusMessage: error.message })
      }
      throw error
    }
  }

  const shipperPostalCode = shipperOrigin.postalCode
  const shipperCountry = normalizeCountry(shipperOrigin.countryCode)
  // UPS rejects a ShipFrom with no StateProvinceCode ("9110016: Missing ship from
  // state province code") while FedEx rates on postal alone — so an origin with no
  // state (a manually-typed ship-from postal, or an address whose region is blank
  // in Directus) would quote FedEx and fail UPS. Derive it from the postal code.
  const shipperState = shipperOrigin.stateCode
    || resolveStateFromPostalCode(shipperPostalCode, shipperCountry)
    || undefined
  const shipperCity = shipperOrigin.city || undefined
  const shipperStreetLines = [shipperOrigin.streetLine1, shipperOrigin.streetLine2]
    .filter((line): line is string => Boolean(line && line.trim()))

  const destinationState = body?.destination?.stateCode?.trim()
    || resolveStateFromPostalCode(destinationPostalCode, destinationCountry)
    || undefined
  // City has no offline equivalent — a ZIP maps to a state, not a place name —
  // so it stays whatever the caller supplied.
  const destinationCity = body?.destination?.city?.trim() || undefined

  const lengthIn = lengthInRaw ?? undefined
  const widthIn = widthInRaw ?? undefined
  const heightIn = heightInRaw ?? undefined
  const accessorials = normalizeAccessorialCodes(body?.options?.accessorials)

  // Validate the LTL options before any provider is called, so an unsupported
  // or incompatible pair answers 422 rather than arriving as a warning attached
  // to an empty result — or, worse, a 500 from the carrier.
  if (shippingCategory === 'LTL') {
    try {
      resolveAccessorials(accessorials)
    } catch (error) {
      if (error instanceof Priority1ApiError) {
        throw createError({ statusCode: error.statusCode, statusMessage: error.message })
      }
      throw error
    }
  }

  const fedexShipper: FedexAddress = {
    postalCode: shipperPostalCode,
    countryCode: shipperCountry,
    stateOrProvinceCode: shipperState,
    city: shipperCity,
    streetLines: shipperStreetLines.length ? shipperStreetLines : undefined,
    residential: false,
  }
  const fedexRecipient: FedexAddress = {
    postalCode: destinationPostalCode,
    countryCode: destinationCountry,
    stateOrProvinceCode: destinationState,
    city: destinationCity,
    // Residential vs commercial is left for the carrier to classify.
  }
  const fedexPackages: FedexPackage[] = [{ weightLb, lengthIn, widthIn, heightIn }]

  // Priority1 takes the same origin/destination as FedEx; its util converts the
  // ISO-2 country codes to the 3-letter form their API expects.
  const priority1Shipper: Priority1Address = {
    postalCode: shipperPostalCode,
    countryCode: shipperCountry,
    stateOrProvinceCode: shipperState,
    city: shipperCity,
  }
  const priority1Recipient: Priority1Address = {
    postalCode: destinationPostalCode,
    countryCode: destinationCountry,
    stateOrProvinceCode: destinationState,
    city: destinationCity,
  }
  const priority1Packages: Priority1Package[] = [{ weightLb, lengthIn, widthIn, heightIn }]

  const upsShipper: UpsAddress = {
    postalCode: shipperPostalCode,
    countryCode: shipperCountry,
    stateProvinceCode: shipperState,
    city: shipperCity,
    addressLine: shipperStreetLines.length ? shipperStreetLines : undefined,
    residential: false,
  }
  const upsRecipient: UpsAddress = {
    postalCode: destinationPostalCode,
    countryCode: destinationCountry,
    stateProvinceCode: destinationState,
    city: destinationCity,
    // Residential vs commercial is left for the carrier to classify.
  }
  const upsPackages: UpsPackage[] = [{ weightLb, lengthIn, widthIn, heightIn }]

  const warnings: string[] = []

  // Tell the UI why a parcel request came back as freight.
  if (autoPromotedToLtl) {
    warnings.push(
      `Weight ${weightLb} lb exceeds the ${MAX_PARCEL_WEIGHT_LB} lb parcel limit — rated as LTL freight.`,
    )
  }

  // The approval catalogue gates everything below, so it is loaded before any
  // provider is called. A failure here fails the request: quoting carriers
  // Liberty never approved is worse than returning no quote at all.
  let offeredServices: Map<string, OfferedService>
  try {
    offeredServices = await fetchOfferedServices()
  } catch (error) {
    throw createError({
      statusCode: (error as OfferedServiceLookupError).statusCode ?? 502,
      statusMessage: 'Could not load the approved carrier configuration.',
    })
  }

  // LTL: Priority1 alone — it already brokers FedEx Freight, so calling FedEx
  // directly as well double-quoted the same two services under a second
  // accessorial contract. Parcel: FedEx + UPS in parallel.
  const tasks: Array<Promise<ShippingEstimate[]>> = []

  if (shippingCategory === 'LTL') {
    // One call returns a quote per underlying hauler. Each is joined back to a
    // canonical carrier through its SCAC, then to an active SupplyHub method by
    // the carrier's own service level — so the row names the hauler that moves
    // the freight, and Priority1 is recorded as the rate source instead.
    tasks.push(
      getPriority1LtlRates(priority1Shipper, priority1Recipient, priority1Packages, { accessorials })
        .then(quotes => quotes.flatMap((quote) => {
          const offered = matchOfferedService(
            offeredServices,
            quote.carrierCode,
            quote.serviceLevel,
            PRIORITY1_CARRIER_ALIASES,
          )
          if (!offered) { return [] }
          return [{
            carrier: offered.carrierName,
            serviceCode: offered.serviceCode,
            method: offered.methodName,
            cost: applyMarkup(quote.totalNetCharge),
            currency: quote.currency,
            transitDays: quote.transitDays,
            providerCode: 'priority1',
            speedCode: offered.speedCode,
          }]
        }))
        .catch((error: unknown) => {
          warnings.push(formatCarrierError('Priority1', error))
          return []
        }),
    )
  } else {
    tasks.push(
      getFedexParcelRates(fedexShipper, fedexRecipient, fedexPackages, {
        accessorials,
        onAccessorialDropped: message => warnings.push(message),
      })
        .then(quotes => quotes.flatMap((quote) => {
          const offered = matchOfferedService(offeredServices, 'fedex', quote.serviceType)
          if (!offered) { return [] }
          return [{
            carrier: offered.carrierName,
            serviceCode: offered.serviceCode,
            method: offered.methodName,
            cost: applyMarkup(quote.totalNetCharge),
            currency: quote.currency,
            transitDays: quote.transitDays,
            providerCode: 'fedex',
            speedCode: offered.speedCode,
          }]
        }))
        .catch((error: unknown) => {
          warnings.push(formatCarrierError('FedEx', error))
          return []
        }),
      getUpsParcelRates(upsShipper, upsRecipient, upsPackages, { accessorials })
        .then(quotes => quotes.flatMap((quote) => {
          const offered = matchOfferedService(offeredServices, 'ups', quote.serviceCode)
          if (!offered) { return [] }
          return [{
            carrier: offered.carrierName,
            serviceCode: offered.serviceCode,
            method: offered.methodName,
            cost: applyUpsMarkup(quote.totalNetCharge),
            currency: quote.currency,
            transitDays: quote.transitDays,
            providerCode: 'ups',
            speedCode: offered.speedCode,
          }]
        }))
        .catch((error: unknown) => {
          warnings.push(formatCarrierError('UPS', error))
          return []
        }),
    )
  }

  const settled = await Promise.all(tasks)
  const estimates = dedupeByService(settled.flat())
    .sort((firstQuote, secondQuote) => firstQuote.cost - secondQuote.cost)

  // Every carrier answered but none of them is one Liberty sells. That is a
  // successful, empty answer — say so in a stable way rather than leaving the
  // table to imply the lane could not be rated at all.
  if (!estimates.length && !warnings.length) {
    warnings.push('no_approved_rates')
  }

  return { estimates, warnings }
})

// A broker can quote the same hauling service more than once — Priority1 rates
// every capacity provider, and two of them can resolve to one canonical carrier
// service. Keep one row per carrier + service, at the cheaper rate.
function dedupeByService(quotes: ShippingEstimate[]): ShippingEstimate[] {
  const cheapestByService = new Map<string, ShippingEstimate>()
  for (const quote of quotes) {
    const key = `${quote.carrier}:${quote.serviceCode}`
    const existing = cheapestByService.get(key)
    if (!existing || quote.cost < existing.cost) {
      cheapestByService.set(key, quote)
    }
  }
  return [...cheapestByService.values()]
}

/** One entry of a carrier's error array, as `code: message` where both exist. */
function trimReason(entry: unknown): string {
  if (typeof entry === 'string') return entry.trim()
  if (!entry || typeof entry !== 'object') return ''
  const item = entry as { code?: string, message?: string, text?: string }
  return [item.code, item.message ?? item.text].filter(Boolean).join(': ').trim()
}

function formatCarrierError(carrier: string, error: unknown): string {
  if (error instanceof FedexApiError || error instanceof UpsApiError || error instanceof Priority1ApiError) {
    const reason = extractCarrierReason(error.details)
    return reason
      ? `${carrier}: ${error.message} — ${reason}`
      : `${carrier}: ${error.message}`
  }
  return `${carrier}: ${(error as Error).message || 'Unknown error'}`
}

function extractCarrierReason(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null

  // Priority1's rate endpoint reports validation failures as a BARE ARRAY of
  // {severity, text} — no envelope, and under a 500 rather than a 400. That
  // matched none of the shapes below, so the real reason ("Origin City and State
  // Abbreviation must both be provided or both be null") was dropped and the user
  // saw only "responded 500".
  if (Array.isArray(details)) {
    return details
      .map(entry => trimReason(entry))
      .filter(Boolean)
      .join('; ') || null
  }

  // Priority1 answers failures as an RFC 9110 ProblemDetails, which matches
  // neither shape below — so its reason used to be dropped and the user was left
  // with a bare "responded 500". On a 500 it carries no reason at all (`detail`
  // is null, `title` is boilerplate), but it always carries a traceId, and that
  // is the one thing their support can actually look the failure up by.
  const problem = details as { title?: string, detail?: string, extensions?: { traceId?: string } }
  if (problem.title || problem.detail || problem.extensions?.traceId) {
    const traceId = String(problem.extensions?.traceId ?? '').trim()
    const reason = String(problem.detail ?? problem.title ?? '').trim()
    return [reason, traceId ? `trace ${traceId}` : ''].filter(Boolean).join(' — ') || null
  }

  const errors = (details as { errors?: Array<{ code?: string, message?: string }> }).errors
  if (Array.isArray(errors) && errors.length > 0) {
    return errors
      .map(item => [item.code, item.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ') || null
  }

  const response = (details as { response?: { errors?: Array<{ code?: string, message?: string }> } }).response
  if (response?.errors && Array.isArray(response.errors) && response.errors.length > 0) {
    return response.errors
      .map(item => [item.code, item.message].filter(Boolean).join(': '))
      .filter(Boolean)
      .join('; ') || null
  }

  return null
}
