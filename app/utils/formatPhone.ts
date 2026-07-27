import type { PhoneNumber, Country } from '~/types/directus'
import { formatForDisplayIso, isSupportedCountry } from '~/utils/phoneFormatCore'

interface PhoneRecord {
  number: string
  extension?: string | null
  countries_id?: Pick<Country, 'phone_code' | 'code'> | number | null
}

/**
 * Minimum normalized-digit length before a phone is used for duplicate
 * matching. The two thresholds are intentionally different and named here so
 * the intent is explicit at every call site:
 *  - SEARCH: broad server-side duplicate lookups (lower bar, catch more).
 *  - DEDUP:  in-form de-duplication of phone rows (stricter, avoid false hits).
 */
export const MIN_PHONE_SEARCH_DIGITS = 4
export const MIN_PHONE_DEDUP_DIGITS = 5

/**
 * Shared country-label formatter. Used by every country Select across the app
 * to avoid the previous 5 duplicate definitions.
 */
export function formatCountryLabel(country: Pick<Country, 'name' | 'phone_code'> | null | undefined): string {
  if (!country?.name) return ''
  return country.phone_code ? `${country.name} (+${country.phone_code})` : country.name
}

/**
 * Strip every non-digit character from a phone string. Used for duplicate
 * matching, length checks, and payload sanitization before hitting Directus.
 */
export function digitsOnly(value: string | null | undefined): string {
  return (value || '').replace(/\D/g, '')
}

interface FormatPhoneOptions {
  includeExtension?: boolean
  /** ISO-2 code override when the record's `countries_id` carries no `code`. */
  iso?: string | null
}

/**
 * Format a stored phone record for display.
 *
 * Prepends the calling code for EVERY country, consistently:
 *   US → "+1 (201) 231-2312"   (NANP — parens, no trunk)
 *   GB → "+44 20 7946 0958"    (trunk "0" omitted; the +44 stands in for it)
 *   DE → "+49 30 12345678"
 *
 * National formatting is delegated to `formatForDisplayIso` (see its rule for
 * trunk handling). The ISO code comes from `countries_id.code` (or the `iso`
 * option); `countries_id.phone_code` drives the "+code" prefix. When no country
 * info is resolvable the raw national number is returned unformatted.
 */
export function formatPhoneNumber(
  phoneRecord: PhoneRecord | null | undefined,
  options: FormatPhoneOptions = {},
): string {
  if (!phoneRecord?.number) {
    return ''
  }

  const { includeExtension = true, iso = null } = options
  const countriesId = phoneRecord.countries_id
  const countryObject = typeof countriesId === 'object' && countriesId !== null ? countriesId : null
  const phoneCode = countryObject?.phone_code
  const resolvedIso = iso ?? countryObject?.code ?? null

  const national = isSupportedCountry(resolvedIso)
    ? formatForDisplayIso(phoneRecord.number, resolvedIso)
    : phoneRecord.number

  const prefix = phoneCode ? `+${phoneCode} ` : ''
  const ext =
    includeExtension && phoneRecord.extension
      ? ` x${phoneRecord.extension}`
      : ''

  return `${prefix}${national}${ext}`
}

/**
 * Extract the first phone record from an entity's phone_numbers junction array.
 */
export function getPrimaryPhone(
  entityRecord: { phone_numbers?: Array<{ phone_numbers_id?: PhoneNumber | number | null, phone_numbers_default?: boolean | null }> } | null | undefined,
): PhoneNumber | null {
  const junctions = entityRecord?.phone_numbers ?? []
  // Prefer the contact's flagged default phone; fall back to the first by sort
  // (contacts without a default set — these are independent of order now).
  const junction = junctions.find((entry) => entry?.phone_numbers_default) ?? junctions[0]
  const phoneNumbersId = junction?.phone_numbers_id
  if (phoneNumbersId && typeof phoneNumbersId === 'object') {
    return phoneNumbersId
  }
  return null
}
