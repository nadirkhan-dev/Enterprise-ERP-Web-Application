/**
 * FedEx Developer API client (server-only).
 *
 * Handles:
 *  - OAuth2 client_credentials token acquisition + in-memory caching.
 *  - Rates and Transit Times API (small-pack / parcel).
 *  - Freight LTL Rate API (LTL).
 *
 * Endpoint hosts are selected by `NUXT_FEDEX_ENV`:
 *   - `production` → https://apis.fedex.com
 *   - anything else (default `sandbox`) → https://apis-sandbox.fedex.com
 */

import { ACCESSORIAL_CODES } from './shippingAccessorials'

export interface FedexAddress {
  postalCode: string
  countryCode: string
  stateOrProvinceCode?: string
  city?: string
  streetLines?: string[]
  residential?: boolean
}

export interface FedexPackage {
  weightLb: number
  lengthIn?: number
  widthIn?: number
  heightIn?: number
}

export interface FedexRateOptions {
  // Accessorial codes (mirror `shipping_accessorials.code`). Each rate builder
  // maps the codes it supports and ignores the rest.
  accessorials?: string[]
  // Called when an accessorial had to be dropped for FedEx to rate at all, so
  // the caller can tell the user the returned rates exclude it.
  onAccessorialDropped?: (message: string) => void
}

export interface FedexRateQuote {
  serviceType: string
  serviceName: string
  totalNetCharge: number
  currency: string
  transitDays: number | null
  deliveryDay: string | null
}

export interface FedexLtlQuote {
  serviceType: string
  serviceName: string
  totalNetCharge: number
  currency: string
  transitDays: number | null
}

export interface FedexPostalCodeInfo {
  postalCode: string
  countryCode: string
  stateOrProvinceCode: string | null
  city: string | null
  classification: string | null
}

export class FedexApiError extends Error {
  statusCode: number
  details?: unknown

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message)
    this.name = 'FedexApiError'
    this.statusCode = statusCode
    this.details = details
  }
}

interface FedexConfig {
  baseUrl: string
  apiKey: string
  secretKey: string
  shipperAccount: string
  account: string
  billToAccount: string
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedToken>()
const tokenPromises = new Map<string, Promise<CachedToken>>()

function tokenCacheKey(config: FedexConfig): string {
  return `${config.baseUrl}::${config.apiKey}`
}

interface CachedPostalLookup {
  result: FedexPostalCodeInfo
  expiresAt: number
}

const postalCodeCache = new Map<string, CachedPostalLookup>()
const POSTAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

function getFedexConfig(): FedexConfig {
  const runtime = useRuntimeConfig()
  const env = trim(runtime.fedexEnv).toLowerCase()
  const baseUrl = env === 'production'
    ? 'https://apis.fedex.com'
    : 'https://apis-sandbox.fedex.com'

  const config: FedexConfig = {
    baseUrl,
    apiKey: trim(runtime.fedexApiKey),
    secretKey: trim(runtime.fedexSecretKey),
    shipperAccount: trim(runtime.fedexShipperAccount),
    account: trim(runtime.fedexAccount),
    billToAccount: trim(runtime.fedexBillToAccount),
  }

  if (!config.apiKey || !config.secretKey) {
    throw new FedexApiError('FedEx API credentials are not configured.', 500)
  }

  return config
}

async function fetchFedexToken(config: FedexConfig): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.apiKey,
    client_secret: config.secretKey,
  })

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (error) {
    throw new FedexApiError(`FedEx OAuth network error: ${(error as Error).message}`, 502)
  }

  const text = await response.text()
  if (!response.ok) {
    throw new FedexApiError(`FedEx OAuth failed (${response.status})`, 502, text)
  }

  const payload = JSON.parse(text) as { access_token: string, expires_in: number }
  // Renew 60s before expiry to avoid edge-of-expiry failures.
  const expiresAt = Date.now() + Math.max(0, (payload.expires_in - 60)) * 1000
  return { accessToken: payload.access_token, expiresAt }
}

async function getFedexToken(config: FedexConfig): Promise<string> {
  const key = tokenCacheKey(config)
  const cached = tokenCache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.accessToken
  }

  let inflight = tokenPromises.get(key)
  if (!inflight) {
    inflight = fetchFedexToken(config).finally(() => { tokenPromises.delete(key) })
    tokenPromises.set(key, inflight)
  }

  const token = await inflight
  tokenCache.set(key, token)
  return token.accessToken
}

async function fedexRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const config = getFedexConfig()
  const accessToken = await getFedexToken(config)

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-locale': 'en_US',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new FedexApiError(`FedEx request network error: ${(error as Error).message}`, 502)
  }

  const text = await response.text()
  if (!response.ok) {
    // 401: token may have been revoked; force a refresh on next call.
    if (response.status === 401) {
      tokenCache.delete(tokenCacheKey(config))
    }
    throw new FedexApiError(`FedEx API ${path} failed (${response.status})`, response.status, safeJson(text))
  }

  return JSON.parse(text) as T
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return text }
}

function toPackageLineItem(pkg: FedexPackage, options: { signatureRequired?: boolean } = {}) {
  const dimensions = pkg.lengthIn && pkg.widthIn && pkg.heightIn
    ? { length: Math.max(1, Math.round(pkg.lengthIn)), width: Math.max(1, Math.round(pkg.widthIn)), height: Math.max(1, Math.round(pkg.heightIn)), units: 'IN' }
    : undefined

  return {
    weight: { units: 'LB', value: Math.max(0.1, Number(pkg.weightLb.toFixed(2))) },
    ...(dimensions ? { dimensions } : {}),
    // Signature is a package-level special service in the FedEx Rate API.
    ...(options.signatureRequired
      ? { packageSpecialServices: { signatureOptionType: 'DIRECT' } }
      : {}),
  }
}

// The two codes FedEx returns when SATURDAY_DELIVERY is present in the request.
const SATURDAY_REJECTION_CODES = new Set([
  'SERVICE.PACKAGECOMBINATION.INVALID',
  'SHIPMENTSPECIALSERVICES.SPECIALSERVICETYPES.INVALID',
])

function isSaturdayRejection(error: unknown): boolean {
  if (!(error instanceof FedexApiError) || error.statusCode !== 400) { return false }
  const errors = (error.details as { errors?: Array<{ code?: string }> } | undefined)?.errors
  if (!Array.isArray(errors)) { return false }
  return errors.some(entry => SATURDAY_REJECTION_CODES.has(String(entry?.code ?? '')))
}

function pickFedexCharge(rateDetails: any[]): { amount: number, currency: string } | null {
  if (!Array.isArray(rateDetails) || rateDetails.length === 0) return null
  // Prefer ACCOUNT/NEGOTIATED, fall back to LIST.
  const preferred = rateDetails.find(detail =>
    detail?.rateType === 'ACCOUNT' || detail?.rateType === 'PREFERRED_ACCOUNT_PACKAGE' || detail?.rateType === 'PREFERRED_ACCOUNT_SHIPMENT',
  ) || rateDetails[0]

  const amount = Number(preferred?.totalNetCharge ?? preferred?.totalNetChargeWithDutiesAndTaxes ?? 0)
  const currency = String(preferred?.currency ?? 'USD')
  return Number.isFinite(amount) && amount > 0 ? { amount, currency } : null
}

function parseTransitDays(transitTime: unknown): number | null {
  if (typeof transitTime !== 'string') return null
  // FedEx returns values like "TWO_DAYS", "THREE_DAYS", "ONE_DAY", "FIVE_DAYS"…
  const map: Record<string, number> = {
    ONE_DAY: 1, TWO_DAYS: 2, THREE_DAYS: 3, FOUR_DAYS: 4, FIVE_DAYS: 5,
    SIX_DAYS: 6, SEVEN_DAYS: 7, EIGHT_DAYS: 8, NINE_DAYS: 9, TEN_DAYS: 10,
    ELEVEN_DAYS: 11, TWELVE_DAYS: 12, THIRTEEN_DAYS: 13, FOURTEEN_DAYS: 14,
    FIFTEEN_DAYS: 15, SIXTEEN_DAYS: 16, SEVENTEEN_DAYS: 17, EIGHTEEN_DAYS: 18,
    NINETEEN_DAYS: 19, TWENTY_DAYS: 20,
  }
  return map[transitTime] ?? null
}

const FEDEX_SERVICE_NAMES: Record<string, string> = {
  FIRST_OVERNIGHT: 'FedEx First Overnight',
  PRIORITY_OVERNIGHT: 'FedEx Priority Overnight',
  STANDARD_OVERNIGHT: 'FedEx Standard Overnight',
  FEDEX_2_DAY_AM: 'FedEx 2Day AM',
  FEDEX_2_DAY: 'FedEx 2Day',
  FEDEX_EXPRESS_SAVER: 'FedEx Express Saver',
  FEDEX_GROUND: 'FedEx Ground',
  GROUND_HOME_DELIVERY: 'FedEx Home Delivery',
  SMART_POST: 'FedEx SmartPost',
  INTERNATIONAL_PRIORITY: 'FedEx International Priority',
  INTERNATIONAL_ECONOMY: 'FedEx International Economy',
  FEDEX_FREIGHT_PRIORITY: 'FedEx Freight Priority',
  FEDEX_FREIGHT_ECONOMY: 'FedEx Freight Economy',
}

function readableServiceName(serviceType: string, fallback?: string): string {
  return FEDEX_SERVICE_NAMES[serviceType] || fallback || serviceType.replace(/_/g, ' ')
}

/**
 * Get parcel rate quotes from FedEx Rates and Transit Times API.
 */
export async function getFedexParcelRates(
  shipper: FedexAddress,
  recipient: FedexAddress,
  packages: FedexPackage[],
  options: FedexRateOptions = {},
): Promise<FedexRateQuote[]> {
  const config = getFedexConfig()

  const accessorialCodes = new Set(options.accessorials ?? [])
  const specialServices: string[] = []
  if (accessorialCodes.has(ACCESSORIAL_CODES.SATURDAY_DELIVERY)) {
    specialServices.push('SATURDAY_DELIVERY')
  }
  const signatureRequired = accessorialCodes.has(ACCESSORIAL_CODES.SIGNATURE_REQUIRED)

  const minimal = isSandbox(config)
  function buildRequestBody(shipmentSpecialServices: string[]): Record<string, unknown> {
    return {
      accountNumber: { value: config.account || config.shipperAccount },
      requestedShipment: {
        shipper: { address: addressPayload(shipper, { minimal }) },
        recipient: { address: addressPayload(recipient, { minimal }) },
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        rateRequestType: ['ACCOUNT', 'LIST'],
        requestedPackageLineItems: packages.map(pkg => toPackageLineItem(pkg, { signatureRequired })),
        ...(shipmentSpecialServices.length
          ? { shipmentSpecialServices: { specialServiceTypes: shipmentSpecialServices } }
          : {}),
      },
    }
  }

  let response: any
  try {
    response = await fedexRequest<any>('/rate/v1/rates/quotes', buildRequestBody(specialServices))
  } catch (error) {
    // FedEx rejects SATURDAY_DELIVERY as a shipment special service on the Rate
    // API — every service, with or without an explicit packagingType, 400s with
    // SERVICE.PACKAGECOMBINATION.INVALID / SHIPMENTSPECIALSERVICES.SPECIALSERVICETYPES.INVALID.
    // (UPS does accept its Saturday indicator, so the option stays in the UI.)
    // Rather than lose every FedEx rate when the box is ticked, re-rate without
    // it and tell the caller the quotes don't include Saturday delivery.
    if (specialServices.includes('SATURDAY_DELIVERY') && isSaturdayRejection(error)) {
      options.onAccessorialDropped?.(
        'FedEx does not quote Saturday Delivery — FedEx rates below exclude it.',
      )
      const withoutSaturday = specialServices.filter(service => service !== 'SATURDAY_DELIVERY')
      response = await fedexRequest<any>('/rate/v1/rates/quotes', buildRequestBody(withoutSaturday))
    } else {
      throw error
    }
  }

  const rateReplyDetails = response?.output?.rateReplyDetails
  if (!Array.isArray(rateReplyDetails)) return []

  const quotes: FedexRateQuote[] = []
  for (const reply of rateReplyDetails) {
    const charge = pickFedexCharge(reply?.ratedShipmentDetails ?? [])
    if (!charge) continue
    quotes.push({
      serviceType: String(reply.serviceType ?? ''),
      serviceName: readableServiceName(String(reply.serviceType ?? ''), reply.serviceName),
      totalNetCharge: charge.amount,
      currency: charge.currency,
      transitDays: parseTransitDays(reply?.commit?.transitTime),
      deliveryDay: reply?.commit?.dateDetail?.dayFormat ?? reply?.commit?.dayOfWeek ?? null,
    })
  }
  return quotes
}

/**
 * Get LTL freight rates from FedEx Freight LTL Rate API.
 */
export async function getFedexFreightLtlRates(
  shipper: FedexAddress,
  recipient: FedexAddress,
  packages: FedexPackage[],
  options: FedexRateOptions = {},
): Promise<FedexLtlQuote[]> {
  const config = getFedexConfig()

  const accessorialCodes = new Set(options.accessorials ?? [])
  const freightSpecialServices: string[] = []
  if (accessorialCodes.has(ACCESSORIAL_CODES.LIFTGATE_REQUIRED)) {
    freightSpecialServices.push('LIFTGATE_DELIVERY')
  }
  if (accessorialCodes.has(ACCESSORIAL_CODES.LIMITED_ACCESS_DELIVERY)) {
    freightSpecialServices.push('LIMITED_ACCESS_DELIVERY')
  }

  // FedEx Freight requires a freight class. We default to class 70 (typical
  // dense HVAC parts); callers can switch on item type later if needed.
  const freightLineItem = {
    class: 'CLASS_070',
    packaging: 'PALLET',
    description: 'Commercial Freight',
    pieces: packages.length || 1,
    weight: {
      units: 'LB',
      value: Math.max(150, packages.reduce((sum, pkg) => sum + (pkg.weightLb || 0), 0)),
    },
  }

  const totalWeight = packages.reduce((sum, pkg) => sum + (pkg.weightLb || 0), 0)

  const requestBody: Record<string, unknown> = {
    accountNumber: { value: config.account || config.shipperAccount },
    requestedShipment: {
      shipper: { address: addressPayload(shipper, { minimal: isSandbox(config) }) },
      recipient: { address: addressPayload(recipient, { minimal: isSandbox(config) }) },
      pickupType: 'CONTACT_FEDEX_TO_SCHEDULE',
      rateRequestType: ['ACCOUNT', 'LIST'],
      shippingChargesPayment: { paymentType: 'SENDER' },
      ...(freightSpecialServices.length
        ? { shipmentSpecialServices: { specialServiceTypes: freightSpecialServices } }
        : {}),
      freightShipmentDetail: {
        fedExFreightAccountNumber: config.shipperAccount || config.account,
        fedExFreightBillingContactAndAddress: {
          address: addressPayload(shipper, { minimal: isSandbox(config) }),
          contact: { personName: 'Liberty Supply', companyName: 'Liberty Supply' },
        },
        role: 'SHIPPER',
        collectTermsType: 'STANDARD',
        declaredValuePerUnit: { amount: 100, currency: 'USD' },
        totalHandlingUnits: packages.length || 1,
        clientDiscount: 0,
        comments: 'Rate quote request',
        substituteServices: [],
        shipmentLegalTerms: 'NONE',
        coupons: [],
        lineItems: [freightLineItem],
      },
      totalWeight: { units: 'LB', value: Math.max(150, totalWeight) },
      requestedPackageLineItems: [{ weight: { units: 'LB', value: Math.max(150, totalWeight) } }],
    },
  }

  const response = await fedexRequest<any>('/rate/v1/rates/quotes', requestBody)

  const rateReplyDetails = response?.output?.rateReplyDetails
  if (!Array.isArray(rateReplyDetails)) return []

  const quotes: FedexLtlQuote[] = []
  for (const reply of rateReplyDetails) {
    const charge = pickFedexCharge(reply?.ratedShipmentDetails ?? [])
    if (!charge) continue
    quotes.push({
      serviceType: String(reply.serviceType ?? ''),
      serviceName: readableServiceName(String(reply.serviceType ?? ''), reply.serviceName),
      totalNetCharge: charge.amount,
      currency: charge.currency,
      transitDays: parseTransitDays(reply?.commit?.transitTime),
    })
  }
  return quotes
}

/**
 * Validate / resolve a postal code via FedEx's Address Validation API.
 *
 * The Address Validation endpoint accepts a partial address (postal code +
 * country) and returns a resolved address with the canonical city, state,
 * residential vs business classification, and a validity flag.
 */
export async function validateFedexPostalCode(
  postalCode: string,
  countryCode: string,
): Promise<FedexPostalCodeInfo> {
  const trimmedPostal = postalCode.trim()
  const upperCountry = countryCode.toUpperCase()
  const cacheKey = `${upperCountry}:${trimmedPostal}`

  const cached = postalCodeCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  const requestBody = {
    addressesToValidate: [
      {
        address: {
          // FedEx Address Validation requires at least one streetLine entry;
          // we pass a placeholder so the postal code drives the resolution.
          streetLines: ['1 Main St'],
          postalCode: trimmedPostal,
          countryCode: upperCountry,
        },
      },
    ],
  }

  // FedEx sandbox returns transient 5xx errors; retry once after a short delay.
  let response: any
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fedexRequest<any>('/address/v1/addresses/resolve', requestBody)
      lastError = null
      break
    } catch (error) {
      lastError = error
      const isTransient = error instanceof FedexApiError && error.statusCode >= 500
      if (isTransient && attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 300))
        continue
      }
      throw error
    }
  }
  if (lastError) throw lastError

  const resolved = response?.output?.resolvedAddresses?.[0] ?? {}

  const stateOrProvinceCode = resolved.stateOrProvinceCode
    ? String(resolved.stateOrProvinceCode)
    : null

  const cityRaw = resolved.city
    ?? resolved.cityToken?.[0]?.value
    ?? resolved.cityName
    ?? null
  const city = cityRaw ? String(cityRaw) : null

  const resolvedPostalCode = resolved.parsedPostalCode?.base
    ?? resolved.postalCode
    ?? trimmedPostal

  const resolvedCountryCode = resolved.countryCode ?? upperCountry

  const classification = resolved.classification
    ?? resolved.attributes?.ResidentialStatus
    ?? null

  // FedEx Address Resolve is street-centric and we only pass a placeholder street
  // line, so a resolved ZIP that differs from the requested one means its matcher
  // drifted to a real street in a DIFFERENT ZIP (e.g. "Main St" lands a 55441
  // request in 55414/Minneapolis) — not a genuine postal correction. The
  // requested postal code is authoritative for a postal-only lookup, so keep it
  // and drop the drifted city/state/classification rather than let callers show a
  // bogus "resolved to" note or auto-fill the wrong locality. Serviceability holds.
  const postalDrifted =
    String(resolvedPostalCode).toUpperCase() !== trimmedPostal.toUpperCase()

  const info: FedexPostalCodeInfo = {
    postalCode: trimmedPostal,
    countryCode: String(resolvedCountryCode).toUpperCase(),
    stateOrProvinceCode: postalDrifted ? null : stateOrProvinceCode,
    city: postalDrifted ? null : city,
    classification: postalDrifted || !classification ? null : String(classification),
  }

  postalCodeCache.set(cacheKey, { result: info, expiresAt: Date.now() + POSTAL_CACHE_TTL_MS })
  return info
}

function addressPayload(address: FedexAddress, options: { minimal?: boolean } = {}) {
  const payload: Record<string, unknown> = {
    postalCode: address.postalCode,
    countryCode: address.countryCode,
  }
  // The FedEx sandbox rejects any address detail beyond postal + country with a
  // bogus ACCOUNT.NUMBER.MISMATCH. A rate quote only needs postal + country, so
  // in sandbox we send the minimal form; production sends the full address (for
  // residential classification, etc.).
  if (options.minimal) return payload
  if (address.residential !== undefined) payload.residential = address.residential
  if (address.stateOrProvinceCode) payload.stateOrProvinceCode = address.stateOrProvinceCode
  if (address.city) payload.city = address.city
  if (address.streetLines?.length) payload.streetLines = address.streetLines
  return payload
}

/** True when pointed at the FedEx sandbox host (which can't handle full addresses). */
function isSandbox(config: FedexConfig): boolean {
  return config.baseUrl.includes('apis-sandbox')
}
