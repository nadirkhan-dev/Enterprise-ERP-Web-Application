import {
  FedexApiError,
  getFedexFreightLtlRates,
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
import { getShipperOrigin, ShipperLookupError, type ShipperOrigin } from '../../utils/warehouses'
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
  carrier: 'FedEx' | 'UPS'
  serviceCode: string
  method: string
  cost: number
  currency: string
  transitDays: number | null
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

  const lengthIn = lengthInRaw ?? undefined
  const widthIn = widthInRaw ?? undefined
  const heightIn = heightInRaw ?? undefined
  const accessorials = normalizeAccessorialCodes(body?.options?.accessorials)

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
    stateOrProvinceCode: body?.destination?.stateCode?.trim() || undefined,
    city: body?.destination?.city?.trim() || undefined,
    // Residential vs commercial is left for the carrier to classify.
  }
  const fedexPackages: FedexPackage[] = [{ weightLb, lengthIn, widthIn, heightIn }]

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
    stateProvinceCode: body?.destination?.stateCode?.trim() || undefined,
    city: body?.destination?.city?.trim() || undefined,
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

  // LTL: FedEx Freight only. Parcel: FedEx + UPS in parallel.
  const tasks: Array<Promise<ShippingEstimate[]>> = []

  if (shippingCategory === 'LTL') {
    tasks.push(
      getFedexFreightLtlRates(fedexShipper, fedexRecipient, fedexPackages, { accessorials })
        .then(quotes => quotes.map(quote => ({
          carrier: 'FedEx' as const,
          serviceCode: quote.serviceType,
          method: quote.serviceName,
          cost: applyMarkup(quote.totalNetCharge),
          currency: quote.currency,
          transitDays: quote.transitDays,
        })))
        .catch((error: unknown) => {
          warnings.push(formatCarrierError('FedEx Freight', error))
          return []
        }),
    )
    // A FedEx parcel quote only makes sense if it's actually within the parcel
    // weight limit — skip it for over-limit (auto-promoted) freight so it
    // doesn't fail and add noise to the warnings.
    if (weightLb <= MAX_PARCEL_WEIGHT_LB) {
      tasks.push(
        getFedexParcelRates(fedexShipper, fedexRecipient, fedexPackages, {
          accessorials,
          onAccessorialDropped: message => warnings.push(message),
        })
          .then(quotes => quotes.map(quote => ({
            carrier: 'FedEx' as const,
            serviceCode: quote.serviceType,
            method: quote.serviceName,
            cost: applyMarkup(quote.totalNetCharge),
            currency: quote.currency,
            transitDays: quote.transitDays,
          })))
          .catch((error: unknown) => {
            warnings.push(formatCarrierError('FedEx', error))
            return []
          }),
      )
    }
  } else {
    tasks.push(
      getFedexParcelRates(fedexShipper, fedexRecipient, fedexPackages, {
        accessorials,
        onAccessorialDropped: message => warnings.push(message),
      })
        .then(quotes => quotes.map(quote => ({
          carrier: 'FedEx' as const,
          serviceCode: quote.serviceType,
          method: quote.serviceName,
          cost: applyMarkup(quote.totalNetCharge),
          currency: quote.currency,
          transitDays: quote.transitDays,
        })))
        .catch((error: unknown) => {
          warnings.push(formatCarrierError('FedEx', error))
          return []
        }),
      getUpsParcelRates(upsShipper, upsRecipient, upsPackages, { accessorials })
        .then(quotes => quotes.map(quote => ({
          carrier: 'UPS' as const,
          serviceCode: quote.serviceCode,
          method: quote.serviceName,
          cost: applyUpsMarkup(quote.totalNetCharge),
          currency: quote.currency,
          transitDays: quote.transitDays,
        })))
        .catch((error: unknown) => {
          warnings.push(formatCarrierError('UPS', error))
          return []
        }),
    )
  }

  const settled = await Promise.all(tasks)
  const estimates = settled.flat().sort((firstQuote, secondQuote) => firstQuote.cost - secondQuote.cost)

  return { estimates, warnings }
})

function formatCarrierError(carrier: string, error: unknown): string {
  if (error instanceof FedexApiError || error instanceof UpsApiError) {
    const reason = extractCarrierReason(error.details)
    return reason
      ? `${carrier}: ${error.message} — ${reason}`
      : `${carrier}: ${error.message}`
  }
  return `${carrier}: ${(error as Error).message || 'Unknown error'}`
}

function extractCarrierReason(details: unknown): string | null {
  if (!details || typeof details !== 'object') return null

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
