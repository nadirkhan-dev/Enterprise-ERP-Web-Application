/**
 * Input validation helpers for shipping estimate requests (server-only).
 *
 * Keeps invalid / abusive inputs from reaching FedEx and UPS, which would
 * otherwise burn carrier quota and surface ambiguous errors to the UI.
 */

export const POSTAL_CODE_PATTERNS: Record<string, RegExp> = {
  US: /^\d{5}(-\d{4})?$/,
  CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
  MX: /^\d{5}$/,
}

// FedEx and UPS parcel hard limits.
export const MAX_PARCEL_WEIGHT_LB = 150
export const MAX_PARCEL_DIMENSION_IN = 108

// LTL freight cap — typical FedEx Freight maximum is 20,000 lb per shipment.
export const MAX_LTL_WEIGHT_LB = 20000

// Reasonable lower bound — anything smaller is almost certainly bad input.
export const MIN_PARCEL_WEIGHT_LB = 0.1

interface ValidatePostalCodeOptions {
  postalCode: string
  countryCode: string
}

export function validatePostalCode({ postalCode, countryCode }: ValidatePostalCodeOptions): string | null {
  const pattern = POSTAL_CODE_PATTERNS[countryCode.toUpperCase()]
  if (!pattern) {
    // No known pattern → accept as-is. Better to forward to the carrier than
    // to reject countries we haven't taught yet.
    return null
  }
  if (!pattern.test(postalCode.trim())) {
    return `Invalid postal code format for ${countryCode.toUpperCase()}.`
  }
  return null
}

/**
 * US ZIP prefix (first three digits) → state, as contiguous ranges. USPS assigns
 * ZIPs geographically, so the prefix determines the state.
 */
const US_ZIP_PREFIX_RANGES: Array<[number, number, string]> = [
  [5, 5, 'NY'], [6, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'],
  [39, 49, 'ME'], [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'], [90, 98, 'AE'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 205, 'DC'],
  [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'],
  [290, 299, 'SC'], [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'],
  [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'],
  [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'],
  [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'], [580, 588, 'ND'],
  [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'],
  [680, 693, 'NE'], [700, 715, 'LA'], [716, 729, 'AR'], [730, 732, 'OK'],
  [733, 733, 'TX'], [734, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'],
  [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'],
  [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'],
  [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
]

// Canadian postal codes encode the province in their first letter.
const CA_POSTAL_LETTER_PROVINCES: Record<string, string> = {
  A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC', K: 'ON',
  L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC',
  X: 'NT', Y: 'YT',
}

/**
 * Derive the state / province from a postal code, offline.
 *
 * UPS rejects a rate request whose ShipFrom has no StateProvinceCode (error
 * 9110016) while FedEx rates on postal alone — so an origin without a state on
 * file (a manually-typed ship-from, or an address whose region is blank in
 * Directus) would quote FedEx and fail UPS. A carrier postal lookup can't be
 * trusted to close that gap: it needs a round-trip, and it reports PO-box-only
 * ZIPs (e.g. 60006) as unserviceable, which is precisely when the state is
 * missing. The mapping is static, so resolve it here instead.
 *
 * @returns the two-letter code, or null when the country/postal isn't mapped.
 */
export function resolveStateFromPostalCode(postalCode: string, countryCode: string): string | null {
  const country = String(countryCode ?? '').trim().toUpperCase()
  const postal = String(postalCode ?? '').trim().toUpperCase()
  if (!postal) { return null }

  if (country === 'US') {
    const digits = postal.replace(/\D/g, '')
    if (digits.length < 5) { return null }
    const prefix = Number(digits.slice(0, 3))
    const match = US_ZIP_PREFIX_RANGES.find(([low, high]) => prefix >= low && prefix <= high)
    return match ? match[2] : null
  }

  if (country === 'CA') {
    return CA_POSTAL_LETTER_PROVINCES[postal[0] ?? ''] ?? null
  }

  // MX and anything else: no mapping — the carriers don't require a state there.
  return null
}

interface ValidateDimensionsOptions {
  shippingCategory: 'parcel' | 'LTL'
  weightLb: number
  lengthIn?: number
  widthIn?: number
  heightIn?: number
}

export function validateDimensions(options: ValidateDimensionsOptions): string | null {
  const { shippingCategory, weightLb, lengthIn, widthIn, heightIn } = options

  if (weightLb < MIN_PARCEL_WEIGHT_LB) {
    return `Weight must be at least ${MIN_PARCEL_WEIGHT_LB} lb.`
  }

  const weightCap = shippingCategory === 'LTL' ? MAX_LTL_WEIGHT_LB : MAX_PARCEL_WEIGHT_LB
  if (weightLb > weightCap) {
    return `Weight ${weightLb} lb exceeds the ${shippingCategory} maximum of ${weightCap} lb.`
  }

  if (shippingCategory === 'parcel') {
    for (const dimension of [lengthIn, widthIn, heightIn]) {
      if (dimension !== undefined && dimension > MAX_PARCEL_DIMENSION_IN) {
        return `Parcel dimensions must each be ≤ ${MAX_PARCEL_DIMENSION_IN} in.`
      }
    }
  }

  return null
}
