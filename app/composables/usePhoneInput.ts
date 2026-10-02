import {
  parsePhoneNumberFromString,
  isValidPhoneNumber,
  getExampleNumber,
  getCountries,
  getCountryCallingCode,
  AsYouType,
  type CountryCode,
  type PhoneNumber,
} from 'libphonenumber-js/max'
import examples from 'libphonenumber-js/examples.mobile.json'
import {
  isSupportedCountry,
  getMaskForCountry,
  getStrippedMaskForCountry,
  applyMask,
  formatNationalForIso,
  formatStrippedForIso,
} from '~/utils/phoneFormatCore'

/**
 * Maximum digit count permitted in the phone extension field. Mirrors the
 * `\d{1,10}` cap from Directus schema (phone_numbers.extension regex: ^[0-9]{1,10}$)
 * so typed/pasted/auto-extracted values stay in sync across the app.
 */
export const MAX_EXTENSION_DIGITS = 10

/**
 * Strip non-digit characters and cap the result to MAX_EXTENSION_DIGITS.
 * Centralized so every extension input enforces the same shape.
 */
export function sanitizeExtension(value: string | null | undefined): string {
  if (!value) return ''
  return String(value).replace(/\D/g, '').slice(0, MAX_EXTENSION_DIGITS)
}

/**
 * @beforeinput handler that blocks any non-digit character from being typed,
 * pasted, or dropped into an extension input. Keystroke-level enforcement is
 * needed because reactive sanitisers run AFTER the value lands in the DOM,
 * so the user sees their letters briefly before they disappear — and some
 * inputs (those bound through Vue's v-model without a centralised watcher)
 * don't get sanitised at all on the first paint.
 */
export function blockNonDigitBeforeInput(event: InputEvent): void {
  const inserted = event.data
  if (inserted && /\D/.test(inserted)) {
    event.preventDefault()
  }
}

interface ParsedPhone {
  nationalNumber: string
  e164: string
  isValid: boolean
  type: string | null
  extension: string | null
  countryIso: string | null
}

interface FormattedPhone extends ParsedPhone {
  formatted: string
}

interface DetectedCountry {
  countryIso: CountryCode
  nationalNumber: string
  extension: string | null
}

/**
 * Lazy-built calling-code → primary-ISO map, used for early prefix detection
 * (e.g. flipping the country selector to GB on "+44" before the user has typed
 * a full number that parsePhoneNumberFromString would accept).
 *
 * NANP +1 explicitly resolves to US — without this override, getCountries()
 * iteration order would pick whichever NANP territory libphonenumber-js
 * happens to list first (typically AS / American Samoa).
 */
let cachedCallingCodeMap: Map<string, CountryCode> | null = null

function getCallingCodeMap(): Map<string, CountryCode> {
  if (cachedCallingCodeMap) return cachedCallingCodeMap
  const map = new Map<string, CountryCode>()
  map.set('1', 'US' as CountryCode)
  for (const iso of getCountries()) {
    try {
      const code = getCountryCallingCode(iso)
      if (!map.has(code)) map.set(code, iso)
    } catch {
    }
  }
  cachedCallingCodeMap = map
  return map
}

function lookupCallingCodePrefix(digits: string): CountryCode | null {
  if (!digits) return null
  const map = getCallingCodeMap()
  // Calling codes are 1–3 digits — try longest first so e.g. "44" matches GB
  // rather than falling through to "4" (no country) or "443" (none).
  for (let length = Math.min(3, digits.length); length >= 1; length--) {
    const iso = map.get(digits.slice(0, length))
    if (iso) return iso
  }
  return null
}

/**
 * Centralized phone-input logic.
 *
 * No component should import from libphonenumber-js directly — go through
 * this composable so mask/placeholder/parse/validate behaviour stays
 * consistent across the app.
 */
export function usePhoneInput(countryIso: Ref<string | null | undefined>) {
  /**
   * Human-readable example number for use as a placeholder.
   */
  const placeholder = computed<string>(() => {
    const iso = countryIso.value
    if (!isSupportedCountry(iso)) return 'Enter phone number'
    const example = getExampleNumber(iso, examples)
    if (!example) return 'Enter phone number'
    // Format the example WITHOUT the trunk prefix so the placeholder matches the
    // value the field actually shows as the user types. The country selector
    // already displays "+CC", so the national trunk "0" is dropped — e.g. PK
    // shows "301 2345678", not "0301 2345678"; US shows "(201) 555-0123".
    return formatStrippedForIso(example.nationalNumber || '', iso) || 'Enter phone number'
  })

  /**
   * Maximum digit count for the active country, derived from the example
   * number. Components use this to cap input length so users can't type a
   * phone longer than the country's format allows (e.g. 10 for US, 11 for
   * GB national format including trunk prefix).
   *
   * Returns null when no country is selected or no example exists, so
   * callers can skip enforcement rather than fall back to an arbitrary cap.
   */
  const maxDigits = computed<number | null>(() => {
    const iso = countryIso.value
    if (!isSupportedCountry(iso)) return null
    const example = getExampleNumber(iso, examples)
    if (!example) return null
    // Cap at the canonical national subscriber length — NOT the trunk-inclusive
    // formatNational count. The field (and now the placeholder) strip the trunk
    // "0", so the user types only the national digits — e.g. IN / PK mobiles are
    // 10 digits, not the 11 that "081234 56789" / "0301 2345678" would imply.
    // Counting the trunk previously let users type one digit too many, which
    // also pushed AsYouType past a valid number and made the grouping jump.
    return (example.nationalNumber || '').length || null
  })

  /**
   * Parse raw user input against a country. Returns a normalized record
   * with digits-only national number, E.164, validity, and extracted
   * extension. Safe for any input (empty, partial, formatted, pasted
   * international).
   */
  function parse(input: string, iso?: string | null): ParsedPhone {
    const trimmed = (input || '').trim()
    const targetIso = (iso ?? countryIso.value) as string | null

    if (!trimmed) {
      return {
        nationalNumber: '',
        e164: '',
        isValid: false,
        type: null,
        extension: null,
        countryIso: targetIso,
      }
    }

    // libphonenumber accepts E.164 / international input without a default country.
    // For national-format input we pass the selected country as the default.
    const parsed: PhoneNumber | undefined = parsePhoneNumberFromString(
      trimmed,
      isSupportedCountry(targetIso) ? targetIso : undefined,
    )

    if (!parsed) {
      // Fallback: strip everything but digits so callers never receive formatting.
      const digitsOnly = trimmed.replace(/\D/g, '')
      return {
        nationalNumber: digitsOnly,
        e164: '',
        isValid: false,
        type: null,
        extension: null,
        countryIso: targetIso,
      }
    }

    return {
      nationalNumber: parsed.nationalNumber || '',
      e164: parsed.number || '',
      isValid: parsed.isValid(),
      type: parsed.getType() || null,
      extension: parsed.ext || null,
      countryIso: (parsed.country as string | undefined) || targetIso,
    }
  }

  /**
   * Format a stored canonical (digits-only, trunk-stripped) national number
   * for display. Uses parsePhoneNumberFromString().formatNational() so
   * trunk-prefix countries (PK / GB / DE / FR / JP …) get the leading "0"
   * re-prepended automatically.
   *
   * Storage stays canonical (no trunk). Only the visual layer adds it.
   */
  function format(nationalNumber: string, iso?: string | null): string {
    return formatNationalForIso(nationalNumber, iso ?? countryIso.value)
  }

  /**
   * Format a national number for display WITHOUT the country's trunk prefix.
   * Used after country-code detection strips the calling code: the country
   * selector adjacent to the input already shows e.g. "+49", so re-adding
   * the German trunk "0" (turning "30 12345678" into "030 12345678") would
   * surprise the user with a digit they never typed.
   *
   * Implementation note: libphonenumber-js's formatNational() always
   * prepends the trunk where applicable and offers no flag to skip it.
   * formatInternational() is the only public output that reliably omits
   * the trunk — strip the "+CC " prefix to recover just the national
   * subscriber portion.
   */
  function formatStripped(national: string, iso?: string | null): string {
    return formatStrippedForIso(national, iso ?? countryIso.value)
  }

  /**
   * Live progressive formatter for the input field. Pairs AsYouType (for
   * the visual string) with parsePhoneNumberFromString (for canonical
   * storage), so a single call gives both values in one pass.
   *
   * Variable-length and fixed-vs-mobile-length differences (DE / FR / AR /
   * MX / etc.) are handled correctly because AsYouType has no fixed slot
   * count — replacing the previous static mask.
   */
  function formatAndParse(input: string, iso?: string | null): FormattedPhone {
    const trimmed = (input || '').trim()
    const targetIso = (iso ?? countryIso.value) as string | null
    const parsed = parse(trimmed, targetIso)

    if (!trimmed || !isSupportedCountry(targetIso)) {
      return { ...parsed, formatted: trimmed }
    }

    // No digits left (e.g. user backspaced past the last digit, leaving a
    // stray mask literal like "(" from "(1"). Return empty so the display
    // clears instead of preserving the orphaned literal.
    if (!trimmed.replace(/\D/g, '')) {
      return { ...parsed, formatted: '' }
    }

    // Format the typed digits with the country's FIXED positional mask so the
    // grouping is identical to the placeholder and stays stable for every
    // keystroke — independent of the number's sub-type. AsYouType regroups as it
    // recognises the number plan (e.g. IN "1232 343 243" vs the mobile example
    // "81234 56789"), which makes the field disagree with its own placeholder.
    // The canonical number stays `parsed.nationalNumber` (digits only), so
    // storage is unaffected. Falls back to AsYouType when no example/mask exists.
    const fixedMask = getStrippedMaskForCountry(targetIso)
    if (fixedMask) {
      const digits = trimmed.replace(/\D/g, '')
      return { ...parsed, formatted: applyMask(digits, fixedMask) }
    }

    const formatted = new AsYouType(targetIso).input(trimmed)
    // AsYouType refuses to format implausible numbers (e.g. US "1111111111" —
    // no real area code starts with 1) and returns the raw digits. Fall back
    // to the country's example mask so users always see country-shaped
    // formatting as they type.
    if (formatted && !/\D/.test(formatted)) {
      const mask = getMaskForCountry(targetIso)
      if (mask) {
        return { ...parsed, formatted: applyMask(formatted, mask) }
      }
    }
    return { ...parsed, formatted: formatted || trimmed }
  }

  /**
   * Wrapper over isValidPhoneNumber with safe defaults.
   */
  function isValid(input: string, iso?: string | null): boolean {
    const trimmed = (input || '').trim()
    if (!trimmed) return false
    const targetIso = (iso ?? countryIso.value) as string | null
    if (!isSupportedCountry(targetIso)) {
      // With no country context we can only trust E.164-ish input.
      return trimmed.startsWith('+') && isValidPhoneNumber(trimmed)
    }
    return isValidPhoneNumber(trimmed, targetIso)
  }

  /**
   * Detect a country from a pasted international-format string (leading "+").
   * Returns null when the string doesn't parse or has no recognisable country.
   *
   * Kept for backward compatibility. New callers should prefer
   * detectCountryFromInput, which also handles "00" and naked-digit input.
   */
  function detectCountryFromPaste(value: string): DetectedCountry | null {
    const trimmed = (value || '').trim()
    if (!trimmed.startsWith('+')) return null
    const parsed = parsePhoneNumberFromString(trimmed)
    if (!parsed || !parsed.country) return null
    return {
      countryIso: parsed.country,
      nationalNumber: parsed.nationalNumber || '',
      extension: parsed.ext || null,
    }
  }

  /**
   * Detect a country from any user-supplied phone string — typed or pasted.
   *
   * Three input shapes are recognised:
   *   1. "+44 …"  — explicit international, detect on first parseable
   *                 prefix so the country flips early in typing.
   *   2. "0044 …" — international dial prefix (used across most of Europe);
   *                 treated identically to "+44 …".
   *   3. Naked digits — only switch when the implied "+digits" is a fully
   *                     valid number (isValid()), AND the detected country
   *                     differs from the current selection. The strict gate
   *                     prevents mis-classifying a local national number
   *                     (e.g. typing "5551234567" in US context shouldn't
   *                     flip to BR just because parsePhoneNumberFromString
   *                     can interpret "+555…" as a possible Brazilian
   *                     fragment).
   *
   * Returns null when no confident detection is possible.
   */
  function detectCountryFromInput(value: string, currentIso?: string | null): DetectedCountry | null {
    const trimmed = (value || '').trim()
    if (!trimmed) return null

    const startsWithPlus = trimmed.startsWith('+')
    const startsWithDoubleZero = !startsWithPlus && trimmed.startsWith('00')
    const explicitInternational = startsWithPlus || startsWithDoubleZero

    let candidate: string
    if (startsWithPlus) {
      candidate = trimmed
    } else if (startsWithDoubleZero) {
      candidate = '+' + trimmed.slice(2)
    } else {
      const digits = trimmed.replace(/\D/g, '')
      if (!digits) return null
      candidate = '+' + digits
    }

    const parsed = parsePhoneNumberFromString(candidate)

    if (!parsed || !parsed.country) {
      if (explicitInternational) {
        // Early-typing fallback for "+" / "00": parsePhoneNumberFromString
        // refuses to commit on a too-short input ("+44" alone returns null),
        // but the user has already declared intent by typing the prefix —
        // so resolve the country from the calling-code map.
        const digits = candidate.slice(1).replace(/\D/g, '')
        const iso = lookupCallingCodePrefix(digits)
        if (!iso) return null
        let nationalNumber = ''
        try {
          const code = getCountryCallingCode(iso)
          nationalNumber = digits.slice(code.length)
        } catch {
          return null
        }
        return { countryIso: iso, nationalNumber, extension: null }
      }
      // Naked-digit foreign-calling-code detection. When the typed digits
      // exactly match a foreign country's calling code (e.g. "92" → PK,
      // "44" → GB) and that country differs from the currently-selected
      // one, flip to the foreign country. Restricted to calling codes of
      // length ≥ 2 because single-digit codes ("1" NANP, "7" RU/KZ) are
      // ambiguous with national area-code prefixes and would false-flip
      // on common domestic typing patterns.
      const foreignFlip = detectForeignCallingCodeFlip(trimmed, currentIso)
      if (foreignFlip) return foreignFlip
      // Naked-digit fallback for the same-country case: parsing returned no
      // country (typical for invalid/fake numbers — e.g. "1232132132" where
      // "232" isn't a real US area code). When the input starts with the
      // current country's calling code AND the typed length has reached the
      // country's max national display length, treat the leading prefix as
      // the calling code and strip it. Falls through to the parsed-country
      // branch below when libphonenumber DOES identify a country.
      return detectSameCountryPrefixStrip(trimmed, currentIso)
    }

    if (!explicitInternational) {
      if (!parsed.isValid()) {
        // Even when parsed is country-identified but the number is invalid
        // (e.g. a real area code with too few subscriber digits), still try
        // the naked-digit calling-code-prefix strip — the user may have
        // typed a fake/test number that nonetheless starts with the
        // current country's calling code.
        return detectSameCountryPrefixStrip(trimmed, currentIso)
      }
      const inputDigits = trimmed.replace(/\D/g, '')
      const nationalDigits = parsed.nationalNumber || ''
      const hasCallingCodePrefix = inputDigits.length > nationalDigits.length
      if (currentIso && parsed.country === currentIso.toUpperCase()) {
        // Same country — only emit detection when the user typed the
        // calling-code prefix (e.g. "1XXXXXXXXXX" for US). The prefix gets
        // stripped without flipping the country selector. When the input is
        // already national-only, leave it alone.
        if (!hasCallingCodePrefix) return null
      } else {
        // Don't auto-switch when the naked digits already form a valid number in
        // the current country. Otherwise typing a domestic 10-digit US number
        // like "2015550123" would flip to EG because "+2015550123" parses as a
        // valid Egyptian number, breaking US AsYouType formatting.
        if (currentIso && isSupportedCountry(currentIso) && isValidPhoneNumber(trimmed, currentIso as CountryCode)) {
          return null
        }
      }
    }

    return {
      countryIso: parsed.country,
      nationalNumber: parsed.nationalNumber || '',
      extension: parsed.ext || null,
    }
  }

  /**
   * Naked-digit foreign-calling-code detection. When the user types digits
   * that exactly match a foreign country's calling code (and differ from
   * the current country), flip to that foreign country. The national
   * number portion is empty — the user has only typed the calling code
   * itself and is about to type the national digits.
   *
   * Restricted to calling codes of length ≥ 2: single-digit codes ("1"
   * NANP, "7" RU/KZ) are too ambiguous with current-country area-code
   * prefixes to flip on. Exact-length match also prevents flipping when
   * the user has already typed past the calling code into national
   * territory (e.g. "920" with US — could be Wisconsin area code 920 or
   * the start of a PK number; the strict-equality gate keeps the more
   * conservative US interpretation).
   */
  function detectForeignCallingCodeFlip(
    input: string,
    currentIso?: string | null,
  ): DetectedCountry | null {
    if (!currentIso) return null
    const inputDigits = input.replace(/\D/g, '')
    if (inputDigits.length < 2) return null
    const foreignIso = lookupCallingCodePrefix(inputDigits)
    if (!foreignIso) return null
    if (foreignIso === currentIso.toUpperCase()) return null
    let foreignCode: string
    try {
      foreignCode = getCountryCallingCode(foreignIso)
    } catch {
      return null
    }
    if (foreignCode.length < 2) return null
    if (inputDigits.length !== foreignCode.length) return null
    return {
      countryIso: foreignIso,
      nationalNumber: '',
      extension: null,
    }
  }

  /**
   * Naked-digit fallback for the same-country calling-code-prefix case.
   * Triggers when libphonenumber couldn't validate the input but it
   * unambiguously starts with the current country's calling code. Used for
   * fake/test numbers (e.g. "1232132132" — leading "1" is the NANP calling
   * code even though area code "232" doesn't resolve a country).
   *
   * Conservative trigger: only fires when the typed digit count has reached
   * the country's max national display length. Below that threshold the user
   * is still mid-typing and the leading digit may be intended as part of
   * the national number; stripping early would erase a digit they
   * deliberately typed.
   */
  function detectSameCountryPrefixStrip(
    input: string,
    currentIso?: string | null,
  ): DetectedCountry | null {
    if (!currentIso || !isSupportedCountry(currentIso)) return null
    let callingCode: string
    try {
      callingCode = getCountryCallingCode(currentIso as CountryCode)
    } catch {
      return null
    }
    const inputDigits = input.replace(/\D/g, '')
    if (!inputDigits.startsWith(callingCode)) return null
    if (inputDigits.length <= callingCode.length) return null
    const example = getExampleNumber(currentIso as CountryCode, examples)
    const maxNationalLength = example
      ? (example.formatNational().match(/\d/g) || []).length
      || (example.nationalNumber || '').length
      : 0
    if (maxNationalLength === 0) return null
    if (inputDigits.length < maxNationalLength) return null
    return {
      countryIso: currentIso.toUpperCase() as CountryCode,
      nationalNumber: inputDigits.slice(callingCode.length),
      extension: null,
    }
  }

  /**
   * Best-effort extraction of an extension from a raw string.
   * Matches "ext", "ext.", "x", "#" variants followed by digits.
   */
  function extractExtension(value: string): { number: string, extension: string | null } {
    const raw = (value || '').trim()
    if (!raw) return { number: '', extension: null }
    const pattern = /[\s,;]*(?:ext\.?|extension|x|#)\s*[:.]?\s*(\d{1,10})\s*$/i
    const match = raw.match(pattern)
    if (!match) return { number: raw, extension: null }
    return {
      number: raw.slice(0, match.index).trim(),
      extension: match[1],
    }
  }

  return {
    placeholder,
    maxDigits,
    parse,
    format,
    formatStripped,
    formatAndParse,
    isValid,
    detectCountryFromPaste,
    detectCountryFromInput,
    extractExtension,
    isSupportedCountry,
  }
}

/**
 * Shared country-id ⇄ ISO helper. Callers pass a Directus country id (integer)
 * and get back the ISO-2 code used by libphonenumber-js.
 *
 * Centralising this here means individual pages no longer need to redefine
 * their own `selectedCountryIso` computed — the logic lives in one place.
 */
export function useCountryIsoLookup(countryId: MaybeRef<number | null | undefined>) {
  const referenceData = useReferenceDataStore()
  return computed<string | null>(() => {
    const id = unref(countryId)
    if (id == null) return null
    const match = referenceData.countryOptions.find((country) => country.id === id)
    return match?.code ?? null
  })
}
