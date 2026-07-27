/**
 * UPS Developer API client (server-only).
 *
 * Handles:
 *  - OAuth2 client_credentials token acquisition + in-memory caching.
 *  - Rating API (Shop) for small-pack rate quotes.
 *
 * Endpoint hosts are selected by `NUXT_UPS_ENV`:
 *   - `production` → https://onlinetools.ups.com
 *   - anything else (default `test`) → https://wwwcie.ups.com
 */

import { ACCESSORIAL_CODES } from './shippingAccessorials'

export interface UpsAddress {
  postalCode: string
  countryCode: string
  stateProvinceCode?: string
  city?: string
  addressLine?: string[]
  residential?: boolean
}

export interface UpsPackage {
  weightLb: number
  lengthIn?: number
  widthIn?: number
  heightIn?: number
}

export interface UpsRateOptions {
  // Accessorial codes (mirror `shipping_accessorials.code`). The rate builder
  // maps the codes UPS supports for parcel and ignores the rest.
  accessorials?: string[]
}

export interface UpsRateQuote {
  serviceCode: string
  serviceName: string
  totalNetCharge: number
  currency: string
  transitDays: number | null
}

export class UpsApiError extends Error {
  statusCode: number
  details?: unknown

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message)
    this.name = 'UpsApiError'
    this.statusCode = statusCode
    this.details = details
  }
}

interface UpsConfig {
  baseUrl: string
  clientId: string
  clientSecret: string
  shipperNumber: string
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()
const tokenPromises = new Map<string, Promise<CachedToken>>()

function tokenCacheKey(config: UpsConfig): string {
  return `${config.baseUrl}::${config.clientId}`
}

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

function getUpsConfig(): UpsConfig {
  const runtime = useRuntimeConfig()
  const env = trim(runtime.upsEnv).toLowerCase()
  const baseUrl = env === 'production'
    ? 'https://onlinetools.ups.com'
    : 'https://wwwcie.ups.com'

  const config: UpsConfig = {
    baseUrl,
    clientId: trim(runtime.upsClientId),
    clientSecret: trim(runtime.upsClientSecret),
    shipperNumber: trim(runtime.upsShipperNumber),
  }

  if (!config.clientId || !config.clientSecret) {
    throw new UpsApiError('UPS API credentials are not configured.', 500)
  }

  return config
}

async function fetchUpsToken(config: UpsConfig): Promise<CachedToken> {
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const body = new URLSearchParams({ grant_type: 'client_credentials' })

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/security/v1/oauth/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
    })
  } catch (error) {
    throw new UpsApiError(`UPS OAuth network error: ${(error as Error).message}`, 502)
  }

  const text = await response.text()
  if (!response.ok) {
    throw new UpsApiError(`UPS OAuth failed (${response.status})`, 502, text)
  }

  const payload = JSON.parse(text) as { access_token: string, expires_in: string | number }
  const expiresIn = Number(payload.expires_in)
  const expiresAt = Date.now() + Math.max(0, (Number.isFinite(expiresIn) ? expiresIn : 3600) - 60) * 1000
  return { accessToken: payload.access_token, expiresAt }
}

async function getUpsToken(config: UpsConfig): Promise<string> {
  const key = tokenCacheKey(config)
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken
  }

  let inflight = tokenPromises.get(key)
  if (!inflight) {
    inflight = fetchUpsToken(config).finally(() => { tokenPromises.delete(key) })
    tokenPromises.set(key, inflight)
  }

  const token = await inflight
  tokenCache.set(key, token)
  return token.accessToken
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

async function upsRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const config = getUpsConfig()
  const accessToken = await getUpsToken(config)

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'transactionSrc': 'liberty-connect',
        'transId': `${Date.now()}`,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new UpsApiError(`UPS request network error: ${(error as Error).message}`, 502)
  }

  const text = await response.text()
  if (!response.ok) {
    if (response.status === 401) {
      tokenCache.delete(tokenCacheKey(config))
    }
    throw new UpsApiError(`UPS API ${path} failed (${response.status})`, response.status, safeJson(text))
  }

  return JSON.parse(text) as T
}

// UPS Rating Service codes (domestic US — international codes differ).
// https://developer.ups.com/api/reference/rating/appendix
const UPS_SERVICE_NAMES: Record<string, string> = {
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
  '07': 'UPS Worldwide Express',
  '08': 'UPS Worldwide Expedited',
  '11': 'UPS Standard',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early',
  '54': 'UPS Worldwide Express Plus',
  '59': 'UPS 2nd Day Air A.M.',
  '65': 'UPS Worldwide Saver',
}

function readableServiceName(serviceCode: string): string {
  return UPS_SERVICE_NAMES[serviceCode] || `UPS Service ${serviceCode}`
}

function toUpsAddress(address: UpsAddress) {
  const payload: Record<string, unknown> = {
    PostalCode: address.postalCode,
    CountryCode: address.countryCode,
  }
  if (address.stateProvinceCode) payload.StateProvinceCode = address.stateProvinceCode
  if (address.city) payload.City = address.city
  if (address.addressLine?.length) payload.AddressLine = address.addressLine
  if (address.residential) payload.ResidentialAddressIndicator = ''
  return payload
}

function toUpsPackage(pkg: UpsPackage, options: { signatureRequired?: boolean } = {}) {
  const payload: Record<string, unknown> = {
    PackagingType: { Code: '02', Description: 'Package' },
    PackageWeight: {
      UnitOfMeasurement: { Code: 'LBS', Description: 'Pounds' },
      Weight: Math.max(0.1, Number(pkg.weightLb.toFixed(2))).toString(),
    },
  }
  if (pkg.lengthIn && pkg.widthIn && pkg.heightIn) {
    payload.Dimensions = {
      UnitOfMeasurement: { Code: 'IN', Description: 'Inches' },
      Length: String(Math.max(1, Math.round(pkg.lengthIn))),
      Width: String(Math.max(1, Math.round(pkg.widthIn))),
      Height: String(Math.max(1, Math.round(pkg.heightIn))),
    }
  }
  // Signature is a package-level option in UPS Rating (DCISType 2 = signature).
  if (options.signatureRequired) {
    payload.PackageServiceOptions = {
      DeliveryConfirmation: { DCISType: '2' },
    }
  }
  return payload
}

/**
 * Get parcel rate quotes from UPS Rating API ("Shop" returns all eligible
 * services for the lane).
 */
export async function getUpsParcelRates(
  shipper: UpsAddress,
  recipient: UpsAddress,
  packages: UpsPackage[],
  options: UpsRateOptions = {},
): Promise<UpsRateQuote[]> {
  const config = getUpsConfig()

  const accessorialCodes = new Set(options.accessorials ?? [])
  const shipmentRatingOptions: Record<string, string> = {}
  if (accessorialCodes.has(ACCESSORIAL_CODES.SATURDAY_DELIVERY)) {
    shipmentRatingOptions.SaturdayDeliveryIndicator = ''
  }
  // Negotiated (account-specific) rates are only returned when the request both
  // asks for them and carries a shipper account number. The parser below prefers
  // NegotiatedRateCharges over the published TotalCharges when present.
  if (config.shipperNumber) {
    shipmentRatingOptions.NegotiatedRatesIndicator = ''
  }
  const signatureRequired = accessorialCodes.has(ACCESSORIAL_CODES.SIGNATURE_REQUIRED)

  const requestBody = {
    RateRequest: {
      Request: {
        TransactionReference: { CustomerContext: 'Liberty Connect rate quote' },
        RequestOption: 'Shop',
      },
      Shipment: {
        Shipper: {
          Name: 'Liberty Supply',
          ...(config.shipperNumber ? { ShipperNumber: config.shipperNumber } : {}),
          Address: toUpsAddress(shipper),
        },
        ShipTo: {
          Name: 'Recipient',
          Address: toUpsAddress(recipient),
        },
        ShipFrom: {
          Name: 'Liberty Supply',
          Address: toUpsAddress(shipper),
        },
        Service: { Code: '03', Description: 'Ground' },
        Package: packages.map(pkg => toUpsPackage(pkg, { signatureRequired })),
        ...(Object.keys(shipmentRatingOptions).length
          ? { ShipmentRatingOptions: shipmentRatingOptions }
          : {}),
      },
    },
  }

  const response = await upsRequest<any>('/api/rating/v2403/Shop', requestBody)
  const ratedShipments = response?.RateResponse?.RatedShipment
  const ratedList = Array.isArray(ratedShipments) ? ratedShipments : ratedShipments ? [ratedShipments] : []

  const quotes: UpsRateQuote[] = []
  for (const shipment of ratedList) {
    const serviceCode = String(shipment?.Service?.Code ?? '')
    if (!serviceCode) continue

    const negotiated = shipment?.NegotiatedRateCharges?.TotalCharge
    const total = negotiated ?? shipment?.TotalCharges
    const amount = Number(total?.MonetaryValue)
    if (!Number.isFinite(amount) || amount <= 0) continue

    const days = Number(shipment?.GuaranteedDelivery?.BusinessDaysInTransit ?? shipment?.TimeInTransit?.ServiceSummary?.EstimatedArrival?.BusinessDaysInTransit)

    quotes.push({
      serviceCode,
      serviceName: readableServiceName(serviceCode),
      totalNetCharge: amount,
      currency: String(total?.CurrencyCode ?? 'USD'),
      transitDays: Number.isFinite(days) ? days : null,
    })
  }
  return quotes
}
