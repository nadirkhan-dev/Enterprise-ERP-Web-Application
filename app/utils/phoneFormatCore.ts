import {
  parsePhoneNumberFromString,
  getExampleNumber,
  getCountryCallingCode,
  AsYouType,
  type CountryCode,
} from 'libphonenumber-js/max'
import examples from 'libphonenumber-js/examples.mobile.json'

/**
 * Pure, framework-free phone formatting core shared by BOTH the input path
 * (`usePhoneInput`) and the display path (`formatPhoneNumber`). Keeping these
 * functions reactivity-free means display call sites (table cells, mappers)
 * can format a number without instantiating a composable per render.
 *
 * No component should import from libphonenumber-js directly — go through this
 * module (or `usePhoneInput`) so mask/format behaviour stays consistent.
 */

/**
 * True when libphonenumber-js recognises the ISO-2 code (e.g. has a calling
 * code for it). Narrows the type so callers can pass it straight through.
 */
export function isSupportedCountry(iso: string | null | undefined): iso is CountryCode {
  if (!iso) return false
  try {
    getCountryCallingCode(iso as CountryCode)
    return true
  } catch {
    return false
  }
}

/**
 * Country-specific positional mask derived from the example number, with every
 * digit replaced by 'X' (e.g. US "(201) 555-0123" → "(XXX) XXX-XXXX"). Used as
 * a fallback when libphonenumber-js refuses to format an implausible number
 * (e.g. US "1111111111" — no real area code starts with 1).
 */
export function getMaskForCountry(iso: string | null | undefined): string | null {
  if (!isSupportedCountry(iso)) return null
  const example = getExampleNumber(iso as CountryCode, examples)
  if (!example) return null
  return example.formatNational().replace(/\d/g, 'X')
}

/**
 * The country's example number formatted as the national subscriber portion
 * WITHOUT the trunk prefix — NANP keeps its parens ("(201) 555-0123"), other
 * countries use the international form with "+CC " stripped ("7400 123456").
 * This is the canonical grouping the app uses for that country.
 */
function getStrippedExampleFormatted(iso: CountryCode): string | null {
  const example = getExampleNumber(iso, examples)
  if (!example) return null
  if (getCountryCallingCode(iso) === '1') return example.formatNational()
  return example.formatInternational().replace(/^\+\d+\s+/, '')
}

/**
 * Fixed positional mask for a country's national number, derived from the
 * example and trunk-stripped (e.g. IN "XXXXX XXXXX", US "(XXX) XXX-XXXX",
 * GB "XXXX XXXXXX"). Used to format the input field and stored numbers the SAME
 * way for every keystroke, so the placeholder, what the user types, and the
 * displayed value always share one grouping — independent of the number's
 * sub-type (which AsYouType would otherwise regroup mid-typing).
 */
export function getStrippedMaskForCountry(iso: string | null | undefined): string | null {
  if (!isSupportedCountry(iso)) return null
  const formatted = getStrippedExampleFormatted(iso as CountryCode)
  return formatted ? formatted.replace(/\d/g, 'X') : null
}

/**
 * Apply a positional mask ("(XXX) XXX-XXXX") to a digit string. Literal mask
 * characters are emitted as we walk the mask; digits beyond the mask's capacity
 * are appended unformatted.
 */
export function applyMask(digits: string, mask: string): string {
  if (!digits) return ''
  let output = ''
  let digitIndex = 0
  for (const char of mask) {
    if (char === 'X') {
      if (digitIndex >= digits.length) break
      output += digits[digitIndex]
      digitIndex++
    } else {
      output += char
    }
  }
  if (digitIndex < digits.length) {
    output += digits.slice(digitIndex)
  }
  return output
}

/**
 * Format a stored canonical (digits-only, trunk-stripped) national number for
 * display, re-prepending the country trunk prefix where applicable (PK / GB /
 * DE / FR / JP …). Storage stays canonical; only the visual layer adds it.
 */
export function formatNationalForIso(nationalNumber: string, iso: string | null | undefined): string {
  if (!nationalNumber || !isSupportedCountry(iso)) return nationalNumber || ''
  try {
    const parsed = parsePhoneNumberFromString(nationalNumber, iso as CountryCode)
    if (parsed) {
      const national = parsed.formatNational()
      if (national && !/\D/.test(national)) {
        const mask = getMaskForCountry(iso)
        if (mask) return applyMask(national, mask)
      }
      return national
    }
  } catch {
  }
  const fallback = new AsYouType(iso as CountryCode).input(nationalNumber) || nationalNumber
  if (fallback && !/\D/.test(fallback)) {
    const mask = getMaskForCountry(iso)
    if (mask) return applyMask(fallback, mask)
  }
  return fallback
}

/**
 * Format a canonical national number for READ-ONLY display (tables, cards,
 * detail pages). Paired with a "+{calling code}" prefix at the call site. Uses
 * the same fixed positional mask as the input field so a number reads
 * identically everywhere — e.g. US "(201) 231-2312", IN "81234 56789".
 */
export function formatForDisplayIso(nationalNumber: string, iso: string | null | undefined): string {
  // Display uses the exact same fixed-mask grouping as the input field, so a
  // number reads identically in the form and in tables/cards.
  return formatStrippedForIso(nationalNumber, iso)
}

/**
 * Format a national number for display WITHOUT the country's trunk prefix.
 *
 * `formatNational()` always prepends the trunk; `formatInternational()` is the
 * only public output that reliably omits it — strip the "+CC " prefix to
 * recover just the national subscriber portion (e.g. GB "20 7946 0958",
 * US "(201) 231-2312" via the mask fallback).
 *
 * Used by the input field (the adjacent country selector already shows "+CC",
 * so re-adding the trunk would surprise the user) AND by the display path,
 * where the calling-code prefix replaces the trunk for a clean, consistent
 * international presentation across every country.
 */
export function formatStrippedForIso(national: string, iso: string | null | undefined): string {
  if (!national || !isSupportedCountry(iso)) return national || ''
  const digits = String(national).replace(/\D/g, '')
  if (!digits) return ''
  // Format with the country's fixed positional mask so the grouping is identical
  // to the placeholder and the live-typing display, regardless of the number's
  // sub-type. (Trade-off: a number whose real format differs from the example —
  // e.g. a landline in a country whose example is a mobile — is grouped like the
  // example. Consistency is preferred here over per-subtype grouping.)
  const mask = getStrippedMaskForCountry(iso)
  if (mask) return applyMask(digits, mask)
  // No example/mask available — best-effort international-stripped grouping.
  try {
    const parsed = parsePhoneNumberFromString(digits, iso as CountryCode)
    if (parsed) return parsed.formatInternational().replace(/^\+\d+\s+/, '')
  } catch {
  }
  return digits
}
