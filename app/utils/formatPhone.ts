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

// A trailing extension, in the forms this app and its sources write it:
// "x123", "ext 123", "ext. 123", "#123".
const TRAILING_EXTENSION = /\s*(?:x|ext\.?|#)\s*\d+\s*$/i

/**
 * Drop a trailing extension from a written phone number.
 *
 * `phone_numbers.number` stores the extension in its own column, so a search or
 * comparison against that column has to lose it first — otherwise the extension's
 * digits concatenate onto the number ("+1 (979) 848-5526 x123434" →
 * "19798485526123434") and match nothing at all.
 */
export function stripPhoneExtension(value: string | null | undefined): string {
  return (value || '').trim().replace(TRAILING_EXTENSION, '')
}

/**
 * Does this free-text search term read as a phone number?
 *
 * A letter is what separates the two cases, so that is what this tests: once a
 * trailing extension is set aside, a term carrying no letters is a number, and
 * one carrying any is text. Everything else between the digits — "+", "-", ".",
 * "(", ")", "/", "=", an en-dash pasted out of Word — is separator noise,
 * whatever it happens to be, and people type and paste all of it.
 *
 * Note it is deliberately NOT a count of non-digit characters: "+1 (320)
 * 455-4670" carries six and is a phone number, while "ISD 194" carries four and
 * is a company name, so no threshold can separate them.
 *
 * This is what keeps a term that merely happens to contain digits —
 * "CBUTCHER@hotel180", "suite 200", "info@abc123.com" — from being searched
 * against every phone number in the database as well, which buried the real
 * match under everything whose number happened to contain the same digits.
 */
export function isPhoneSearchTerm(value: string | null | undefined): boolean {
  const term = stripPhoneExtension(value).trim()
  if (!term) { return false }
  if ((/\p{L}/u).test(term)) { return false }
  // Digits make it a number search. A leading "+" counts on its own, so the
  // search can react to a country code before enough digits are typed to match
  // a number — a bare "-" or "()" is not a phone search.
  return digitsOnly(term).length > 0 || term.startsWith('+')
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
  entityRecord: {
    default_contacts_phone_numbers_id?: number | { id?: number } | null,
    phone_numbers?: Array<{ id?: number, phone_numbers_id?: PhoneNumber | number | null }>,
  } | null | undefined,
): PhoneNumber | null {
  const junctions = entityRecord?.phone_numbers ?? []
  // Prefer the contact's default phone — the contact record points at its one
  // default junction row (default_contacts_phone_numbers_id, raw id or expanded
  // object); fall back to the first by sort for contacts without a default set.
  const pointer = entityRecord?.default_contacts_phone_numbers_id
  const defaultJunctionId = typeof pointer === 'object' && pointer !== null ? pointer.id : pointer
  const junction = (defaultJunctionId != null
    ? junctions.find((entry) => entry?.id === defaultJunctionId)
    : null) ?? junctions[0]
  const phoneNumbersId = junction?.phone_numbers_id
  if (phoneNumbersId && typeof phoneNumbersId === 'object') {
    return phoneNumbersId
  }
  return null
}
