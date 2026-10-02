/**
 * Priority1 LTL rating — a freight broker, so one request returns quotes from
 * several underlying carriers (R&L, Saia, ABF, TForce, Estes, FedEx Freight, …)
 * at Liberty's negotiated rates, each with its own transit time.
 *
 * API contract (https://dev-api.priority1.com/openapi/v2.json — the `v2`
 * document; `v1` is a legacy tracking-only spec that publishes no rating
 * endpoint at all):
 *   POST /v2/ltl/quotes/rates → rate quotes from every capacity provider
 * Auth is the `X-API-KEY` header. The v2 request schema sets
 * `additionalProperties: false`, so only documented fields are sent.
 *
 * Endpoint and key come from the `priority1` provider row in Directus (see
 * `providerConfig.ts`), falling back to `NUXT_PRIORITY_ONE_*`. That row's
 * `api_config.ltlEstimateDefaults` supplies the canonical estimate defaults
 * below; they are data, and every rule that reads them lives here as typed code.
 *
 * The quote is an ESTIMATE, not a booking: no tender, dispatch, BOL or tracking.
 * Neither the request nor the response body is persisted.
 */
import { fetchProviderCredentials } from './providerConfig'
import { ACCESSORIAL_CODES } from './shippingAccessorials'

export interface Priority1Address {
  postalCode: string
  countryCode: string
  stateOrProvinceCode?: string
  city?: string
}

export interface Priority1Package {
  weightLb: number
  lengthIn?: number
  widthIn?: number
  heightIn?: number
}

export interface Priority1RateOptions {
  /** Accessorial codes (mirror `shipping_accessorials.code`). */
  accessorials?: string[]
}

export interface Priority1LtlQuote {
  /** SCAC of the underlying carrier, e.g. "SAIA". Joined to a canonical carrier. */
  carrierCode: string
  carrierName: string
  /** The carrier's own service identity — "STD", "MR", "FEDEX_FREIGHT_PRIORITY". */
  serviceLevel: string
  serviceName: string
  totalNetCharge: number
  currency: string
  transitDays: number | null
  /** Priority1 stops honouring the quote after this, when they supply it. */
  expirationDate: string | null
  deliveryDate: string | null
  laneType: string | null
  providerQuoteId: string | null
  providerRateId: string | null
  carrierQuoteNumber: string | null
}

export class Priority1ApiError extends Error {
  statusCode: number
  details?: unknown

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message)
    this.name = 'Priority1ApiError'
    this.statusCode = statusCode
    this.details = details
  }
}

interface Priority1Config {
  baseUrl: string
  apiKey: string
}

// ── Canonical defaults ───────────────────────────────────────────────────────
// Mirrors `providers.api_config.ltlEstimateDefaults` for the `priority1` row.
// Directus is the source of truth; these keep rating working when it cannot be
// read, and every value here is one the spec already vetted.
const DEFAULT_QUOTE_PATH = '/v2/ltl/quotes/rates'
// Priority1's response carries no currency field, so the quoted amounts are
// whatever the account is denominated in. The provider row states it.
const DEFAULT_CURRENCY = 'USD'

// Priority1 rates every capacity provider in turn, so a full quote is slow —
// observed ~6-9.5s against the sandbox. Their own per-provider cap keeps one
// slow carrier from holding up the rest; the outer one bounds the whole call.
const DEFAULT_PROVIDER_TIMEOUT_SECONDS = 15
const DEFAULT_REQUEST_TIMEOUT_SECONDS = 30

interface LtlEstimateDefaults {
  pallet: { lengthIn: number, widthIn: number, heightIn: number }
  packagingType: string
  units: number
  pieces: number
  isStackable: boolean
  isHazardous: boolean
  isUsed: boolean
  isMachinery: boolean
  description: string
  pickupLeadBusinessDays: number
  nmfcItemCode: string
}

// 48 × 40 is the most common US pallet footprint. The 48-inch LOADED height is
// an explicit estimator assumption, not a pallet-industry standard — which is
// why substituting it raises a user-visible warning.
const FALLBACK_DEFAULTS: LtlEstimateDefaults = {
  pallet: { lengthIn: 48, widthIn: 40, heightIn: 48 },
  packagingType: 'Pallet',
  units: 1,
  pieces: 1,
  // Commercial HVAC equipment must not be assumed safe to top-load, assumed
  // used, or assumed machinery — each widens carrier liability treatment.
  isStackable: false,
  isHazardous: false,
  isUsed: false,
  isMachinery: false,
  description: 'Commercial HVAC equipment or parts',
  pickupLeadBusinessDays: 1,
  nmfcItemCode: '114115',
}

// ── Accessorials ─────────────────────────────────────────────────────────────
// Canonical `shipping_accessorials.code` → Priority1 code. Every one was live-
// tested and echoed back. Codes with no accurate Priority1 equivalent are absent
// on purpose: SATPU is Saturday *pickup*, and RDNS ("residential direct, no
// signature") is not a signature requirement — substituting either would quote
// a service the user did not ask for.
export const PRIORITY1_ACCESSORIALS: Record<string, string> = {
  [ACCESSORIAL_CODES.LIFTGATE_REQUIRED]: 'LGDEL',
  [ACCESSORIAL_CODES.LIMITED_ACCESS_DELIVERY]: 'LTDDEL',
  [ACCESSORIAL_CODES.HAZARDOUS_MATERIALS]: 'HAZM',
  [ACCESSORIAL_CODES.RESIDENTIAL_DELIVERY]: 'RESDEL',
  [ACCESSORIAL_CODES.DELIVERY_APPOINTMENT]: 'APPT',
}

// Priority1 accepts this pair, but ABF rejects it as incompatible and one
// combination returned a top-level HTTP 500 — losing the whole quote. Refusing
// it here costs the user a clear message instead of an empty result.
const MUTUALLY_EXCLUSIVE = [
  ACCESSORIAL_CODES.LIMITED_ACCESS_DELIVERY,
  ACCESSORIAL_CODES.RESIDENTIAL_DELIVERY,
] as const

// v2 documents these four; anything else is rejected before the call rather than
// sent and 500'd.
const SUPPORTED_COUNTRY_CODES = new Set(['US', 'CA', 'MX', 'PR'])

function trim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function num(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * The canonical estimate defaults, read from the provider row and validated
 * field by field. A missing or malformed key falls back to its vetted constant
 * rather than failing the quote — the values are defaults, not approvals.
 */
function readEstimateDefaults(config: Record<string, unknown>): LtlEstimateDefaults {
  const raw = (config.ltlEstimateDefaults ?? {}) as Record<string, unknown>
  const pallet = (raw.pallet ?? {}) as Record<string, unknown>
  return {
    pallet: {
      lengthIn: num(pallet.lengthIn, FALLBACK_DEFAULTS.pallet.lengthIn),
      widthIn: num(pallet.widthIn, FALLBACK_DEFAULTS.pallet.widthIn),
      heightIn: num(pallet.heightIn, FALLBACK_DEFAULTS.pallet.heightIn),
    },
    packagingType: trim(raw.packagingType) || FALLBACK_DEFAULTS.packagingType,
    units: num(raw.units, FALLBACK_DEFAULTS.units),
    pieces: num(raw.pieces, FALLBACK_DEFAULTS.pieces),
    isStackable: bool(raw.isStackable, FALLBACK_DEFAULTS.isStackable),
    isHazardous: bool(raw.isHazardous, FALLBACK_DEFAULTS.isHazardous),
    isUsed: bool(raw.isUsed, FALLBACK_DEFAULTS.isUsed),
    isMachinery: bool(raw.isMachinery, FALLBACK_DEFAULTS.isMachinery),
    description: trim(raw.description) || FALLBACK_DEFAULTS.description,
    pickupLeadBusinessDays: num(raw.pickupLeadBusinessDays, FALLBACK_DEFAULTS.pickupLeadBusinessDays),
    nmfcItemCode: trim(raw.nmfcItemCode) || FALLBACK_DEFAULTS.nmfcItemCode,
  }
}

async function getPriority1Config(): Promise<Priority1Config> {
  const runtime = useRuntimeConfig()
  const provider = await fetchProviderCredentials('priority1')

  const config: Priority1Config = {
    baseUrl: trim(provider?.baseUrl || runtime.priorityOneApiUrl).replace(/\/+$/, ''),
    apiKey: trim(provider?.apiKey || runtime.priorityOneApiKey),
  }
  if (!config.baseUrl || !config.apiKey) {
    throw new Priority1ApiError('Priority1 API credentials are not configured.', 500)
  }
  return config
}

// ── Freight class ────────────────────────────────────────────────────────────

/**
 * Freight class and NMFC subcode for palletized commercial HVAC.
 *
 * NMFTA Disposition Bulletin 1372 (Docket 2025-2 Subject 8) sets NMFC item
 * 114115 for non-portable air conditioners, air handlers, heat pumps and
 * refrigeration condensers/evaporators. For articles on pallets — rather than in
 * boxes or crates — class follows density alone.
 *
 * Derived here rather than through Priority1's `suggestedclass` endpoint, which
 * takes only weight and dimensions: knowing nothing of commodity or packaging it
 * returned class 175 for the default shipment where this table gives 250. A
 * commodity-specific rule is both simpler and more accurate.
 */
const HVAC_DENSITY_CLASSES: Array<{ maxDensityPcf: number, subCode: string, freightClass: string }> = [
  { maxDensityPcf: 6, subCode: '07', freightClass: '250' },
  { maxDensityPcf: 10, subCode: '08', freightClass: '150' },
  { maxDensityPcf: 15, subCode: '09', freightClass: '100' },
  { maxDensityPcf: Infinity, subCode: '10', freightClass: '77.5' },
]

export function classifyHvacFreight(
  weightLb: number,
  lengthIn: number,
  widthIn: number,
  heightIn: number,
): { freightClass: string, nmfcSubCode: string, densityPcf: number } {
  const cubicFeet = (lengthIn * widthIn * heightIn) / 1728
  const densityPcf = cubicFeet > 0 ? weightLb / cubicFeet : 0
  // The table is ordered ascending and ends at Infinity, so a match is certain.
  const band = HVAC_DENSITY_CLASSES.find(entry => densityPcf < entry.maxDensityPcf)!
  return { freightClass: band.freightClass, nmfcSubCode: band.subCode, densityPcf }
}

// ── Pickup date ──────────────────────────────────────────────────────────────

/**
 * The pickup date Priority1 rates against: `pickupLeadBusinessDays` ahead,
 * skipping weekends, serialized as a local date-time at midnight.
 *
 * The schema requires a date-time and Priority1's own example carries no zone,
 * so this is built from local calendar parts — `toISOString()` would shift the
 * date backwards for any timezone west of UTC and can quote a day in the past.
 */
export function buildPickupDate(leadBusinessDays: number, from: Date = new Date()): string {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  let remaining = Math.max(0, Math.floor(leadBusinessDays))
  while (remaining > 0) {
    date.setDate(date.getDate() + 1)
    const weekday = date.getDay()
    if (weekday !== 0 && weekday !== 6) { remaining -= 1 }
  }
  // Landing on a weekend with a zero lead time would still quote an unrateable
  // day, so roll forward regardless of how the loop above finished.
  while (date.getDay() === 0 || date.getDay() === 6) {
    date.setDate(date.getDate() + 1)
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00`
}

// ── Accessorial resolution ───────────────────────────────────────────────────

/**
 * Canonical accessorial codes → the Priority1 codes to send, sorted and
 * de-duplicated so a given selection always serializes identically.
 *
 * Throws 422 on an unsupported code rather than dropping it: silently quoting
 * without a surcharge the user asked for understates the price.
 */
export function resolveAccessorials(codes: string[]): { external: string[], isHazardous: boolean } {
  const selected = Array.from(new Set(codes.map(code => trim(code).toLowerCase()).filter(Boolean)))

  if (MUTUALLY_EXCLUSIVE.every(code => selected.includes(code))) {
    throw new Priority1ApiError(
      'Limited-access delivery and residential delivery cannot be combined.',
      422,
    )
  }

  const unsupported = selected.filter(code => !PRIORITY1_ACCESSORIALS[code])
  if (unsupported.length) {
    throw new Priority1ApiError(
      `Priority1 does not support these options: ${unsupported.join(', ')}.`,
      422,
    )
  }

  return {
    external: selected.map(code => PRIORITY1_ACCESSORIALS[code]).sort(),
    isHazardous: selected.includes(ACCESSORIAL_CODES.HAZARDOUS_MATERIALS),
  }
}

// ── Request ──────────────────────────────────────────────────────────────────


function toPostalCode(postalCode: string, countryCode: string): string {
  const postal = trim(postalCode)
  const country = trim(countryCode).toUpperCase()
  if (country !== 'US' && country !== 'PR') { return postal }
  const base = postal.split('-')[0]?.trim() ?? postal
  return /^\d{5}$/.test(base) ? base : postal
}

function pairCityAndState(
  address: Priority1Address,
): { city: string | undefined, state: string | undefined } {
  const city = trim(address.city)
  const state = trim(address.stateOrProvinceCode)
  return city && state ? { city, state } : { city: undefined, state: undefined }
}
const PR_ZIP_PREFIX_MIN = 6
const PR_ZIP_PREFIX_MAX = 9

function isPuertoRicoZip(postalCode: string): boolean {
  const digits = trim(postalCode).replace(/\D/g, '')
  if (digits.length < 5) { return false }
  const prefix = Number(digits.slice(0, 3))
  return prefix >= PR_ZIP_PREFIX_MIN && prefix <= PR_ZIP_PREFIX_MAX
}

/**
 * The country as Priority1 knows it, promoting a US-addressed PR ZIP to "PR".
 * @param code - the ISO-2 country on the address
 * @param postalCode - needed because PR is indistinguishable from US by country
 */
function toCountryCode(code: string, postalCode: string): string {
  const upper = trim(code).toUpperCase()
  if (!SUPPORTED_COUNTRY_CODES.has(upper)) {
    throw new Priority1ApiError(`Priority1 cannot rate to or from "${upper}".`, 422)
  }
  return upper === 'US' && isPuertoRicoZip(postalCode) ? 'PR' : upper
}

async function priority1Request<T>(
  path: string,
  body: unknown,
  requestTimeoutMs: number,
): Promise<T> {
  const config = await getPriority1Config()

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'X-API-KEY': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Priority1ApiError(`Priority1 request failed: ${reason}`, 503)
  }

  const raw = await response.text()
  let parsed: unknown = null
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    // Non-JSON body — surfaced through `details` below rather than thrown over.
  }

  if (!response.ok) {
    throw new Priority1ApiError(
      `Priority1 responded ${response.status}`,
      response.status,
      parsed ?? raw.slice(0, 500),
    )
  }
  return parsed as T
}

// ── Response ─────────────────────────────────────────────────────────────────

interface RateQuoteResponse {
  rateQuotes?: Array<{
    carrierName?: string
    carrierCode?: string
    serviceLevel?: string
    serviceLevelDescription?: string
    transitDays?: number | null
    expirationDate?: string | null
    deliveryDate?: string | null
    laneType?: string | null
    quoteId?: string | number | null
    rateId?: string | number | null
    carrierQuoteNumber?: string | null
    rateQuoteDetail?: { total?: number } | null
  }>
  invalidRateQuotes?: Array<{
    carrierName?: string
    carrierCode?: string
    errorMessages?: Array<{ text?: string }>
  }>
  messages?: Array<{ text?: string, severity?: string }>
}

function optionalString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) { return String(value) }
  return trim(value) || null
}

/**
 * Rate an LTL shipment across every carrier Priority1 brokers.
 *
 * Returns every valid quote it gets. Deciding which of them Liberty actually
 * sells is the caller's job — see `offeredServices.ts`.
 */
export async function getPriority1LtlRates(
  shipper: Priority1Address,
  recipient: Priority1Address,
  packages: Priority1Package[],
  options: Priority1RateOptions = {},
): Promise<Priority1LtlQuote[]> {
  const totalWeightLb = packages.reduce((sum, pkg) => sum + (pkg.weightLb || 0), 0)
  if (totalWeightLb <= 0) {
    throw new Priority1ApiError('Priority1 needs a shipment weight to rate.', 400)
  }

  const provider = await fetchProviderCredentials('priority1')
  const providerConfig = provider?.config ?? {}
  const defaults = readEstimateDefaults(providerConfig)
  const quotePath = trim(providerConfig.quotePath) || DEFAULT_QUOTE_PATH
  const currency = trim(providerConfig.currency) || DEFAULT_CURRENCY
  const timeouts = (providerConfig.timeouts ?? {}) as Record<string, unknown>
  const providerTimeoutSeconds = num(timeouts.providerSeconds, DEFAULT_PROVIDER_TIMEOUT_SECONDS)
  const requestTimeoutSeconds = num(timeouts.requestSeconds, DEFAULT_REQUEST_TIMEOUT_SECONDS)

  const { external, isHazardous } = resolveAccessorials(options.accessorials ?? [])

  // Partial dimensions rate worse than none: Priority1 500s on them, and a
  // half-measured box is not a shipment. Take all three or fall back to a pallet.
  const first = packages[0]
  const hasMeasuredDimensions = Boolean(
    first && first.lengthIn && first.widthIn && first.heightIn
    && first.lengthIn > 0 && first.widthIn > 0 && first.heightIn > 0,
  )
  const lengthIn = hasMeasuredDimensions ? first!.lengthIn! : defaults.pallet.lengthIn
  const widthIn = hasMeasuredDimensions ? first!.widthIn! : defaults.pallet.widthIn
  const heightIn = hasMeasuredDimensions ? first!.heightIn! : defaults.pallet.heightIn

  // Class and subcode come from one calculation so they can never disagree.
  const { freightClass, nmfcSubCode } = classifyHvacFreight(totalWeightLb, lengthIn, widthIn, heightIn)
  const origin = pairCityAndState(shipper)
  const destination = pairCityAndState(recipient)

  const response = await priority1Request<RateQuoteResponse>(quotePath, {
    originZipCode: toPostalCode(shipper.postalCode, shipper.countryCode),
    originCity: origin.city,
    originStateAbbreviation: origin.state,
    originCountryCode: toCountryCode(shipper.countryCode, shipper.postalCode),
    destinationZipCode: toPostalCode(recipient.postalCode, recipient.countryCode),
    destinationCity: destination.city,
    destinationStateAbbreviation: destination.state,
    destinationCountryCode: toCountryCode(recipient.countryCode, recipient.postalCode),
    pickupDate: buildPickupDate(defaults.pickupLeadBusinessDays),
    items: [{
      freightClass,
      packagingType: defaults.packagingType,
      units: defaults.units,
      pieces: defaults.pieces,
      totalWeight: totalWeightLb,
      length: lengthIn,
      width: widthIn,
      height: heightIn,
      isStackable: defaults.isStackable,
      // Sending the flag AND the HAZM code is redundant — Priority1 derives one
      // from the other — but it makes the intent explicit in both places.
      isHazardous: defaults.isHazardous || isHazardous,
      isUsed: defaults.isUsed,
      isMachinery: defaults.isMachinery,
      nmfcItemCode: defaults.nmfcItemCode,
      nmfcSubCode,
      description: defaults.description,
    }],
    // Omit the field entirely when nothing applies — an empty array is not the
    // same request.
    ...(external.length ? { accessorialServices: external.map(code => ({ code })) } : {}),
    apiConfiguration: { timeout: providerTimeoutSeconds },
  }, requestTimeoutSeconds * 1000)

  return (response?.rateQuotes ?? [])
    .map((quote) => {
      const total = quote.rateQuoteDetail?.total
      if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) {
        return null
      }
      const carrierName = trim(quote.carrierName) || trim(quote.carrierCode) || 'Carrier'
      return {
        carrierCode: trim(quote.carrierCode) || carrierName,
        carrierName,
        serviceLevel: trim(quote.serviceLevel),
        serviceName: trim(quote.serviceLevelDescription) || trim(quote.serviceLevel) || 'Standard',
        totalNetCharge: total,
        currency,
        transitDays: typeof quote.transitDays === 'number' ? quote.transitDays : null,
        expirationDate: optionalString(quote.expirationDate),
        deliveryDate: optionalString(quote.deliveryDate),
        laneType: optionalString(quote.laneType),
        providerQuoteId: optionalString(quote.quoteId),
        providerRateId: optionalString(quote.rateId),
        carrierQuoteNumber: optionalString(quote.carrierQuoteNumber),
      }
    })
    .filter((quote): quote is Priority1LtlQuote => quote !== null)
}

/**
 * Turn a carrier Priority1 could not rate into a short, safe warning.
 *
 * Their invalid-quote messages carry stack traces, HTML and vendor URLs, so the
 * carrier name is all that is passed on — the reason text never is.
 */
export function summarizeInvalidQuotes(response: { invalidRateQuotes?: Array<{ carrierName?: string, carrierCode?: string }> }): string[] {
  return (response.invalidRateQuotes ?? [])
    .map(quote => trim(quote.carrierName) || trim(quote.carrierCode))
    .filter(Boolean)
    .map(carrier => `Priority1: ${carrier} could not quote this lane.`)
}
