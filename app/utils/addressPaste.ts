/**
 * Address paste helpers — the Street field accepts a whole address pasted from
 * another system (or copied straight out of the Addresses table), so these pure
 * functions turn that raw clipboard text into something usable: a clean one-line
 * search query, a check that a Mapbox suggestion really is the pasted address,
 * and a structured parse of the paste itself for when none of them are.
 *
 * Shared by DrawerAddressInfo and AddressFormFields, which run the same flow.
 */
import { normalizeStreet } from '~/utils/addressDuplicates'

export interface PastedAddressParts {
  street: string
  unitSuite: string
  city: string
  /** Reference id of the matched region, or null when nothing matched. */
  regionId: number | string | null
  postalCode: string
}

export interface RegionOption {
  id: number | string
  name: string
  code?: string | null
}

export interface ParsePastedAddressOptions {
  regions?: RegionOption[]
  /** Country names/codes to ignore — a paste never changes the country. */
  countryAliases?: (string | null | undefined)[]
}

/** The suggestion fields corroboration reads (a subset of AddressSuggestion). */
export interface CorroborationCandidate {
  street?: string | null
  city?: string | null
  postalCode?: string | null
  isBusiness?: boolean
}

// Segments that label a copied row rather than describe the address: the
// Addresses table's Type column (see customerMappers' `type`).
const ROW_LABEL_PATTERN = /^(shipping|billing|billing\s*\/\s*shipping|shipping\s*\/\s*billing|other)$/i

// Written forms of a country that no `countries` row spells out, so they can't
// come from the caller's name/code list.
const EXTRA_COUNTRY_ALIASES = ['usa', 'u.s.a.', 'united states of america']

// A segment naming a unit rather than a street. Matched anywhere in the segment
// because the keyword leads in some sources ("Suite 100", "BLDG 0010") and
// trails in others ("1234 Suite").
const UNIT_PATTERN = /#|\b(suite|ste|unit|apt|apartment|bldg|building|floor|fl|room|rm|dept|department|box|lot|space|dock)\b/i

// Postal code anchored to the END of a segment, so "West Bountiful UT 84087"
// gives up its code and keeps its city. Deliberately limited to formats we can
// recognise with confidence — an unrecognised code is left in place rather than
// guessed at, which would eat part of a city or street.
const POSTAL_PATTERNS = [
  /\d{5}(?:-\d{4})?$/, // US / PR
  /[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/, // Canada
  /[A-Za-z]{1,2}\d[A-Za-z\d]?[ ]?\d[A-Za-z]{2}$/, // UK
]

/**
 * Flatten pasted clipboard text into the single-line, comma-separated query the
 * address search expects.
 *
 * Address text arrives with whatever separators its source used: newlines from a
 * form or shipping label, tabs from a copied table row. Both mean "next field",
 * so both become commas. A tab left in place is not cosmetic — it measurably
 * changes how Mapbox parses the query, which answers a tab-separated
 * "South 2750 West … 84087" with "2750 South 700 West" (a different street in
 * the same ZIP) while the comma-separated form resolves correctly.
 */
export function normalizePastedAddress(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, ', ') // line / cell breaks → field separators
    .replace(/\s{2,}/g, ' ') // collapse runs of whitespace
    .replace(/\s*,\s*(?:,\s*)+/g, ', ') // dedupe stacked commas
    .replace(/^[,\s]+|[,\s]+$/g, '') // trim stray leading/trailing commas
    .trim()
}

// Words of an address line, folded through normalizeStreet so "South 2750 West"
// and "S 2750 W" tokenize identically. Punctuation becomes whitespace first so
// separators never stay glued to a word ("west," would match nothing).
function toTokens(value: string): string[] {
  return normalizeStreet(value.replace(/[(),;]+/g, ' ')).split(' ').filter(Boolean)
}

// Does `needle` appear as a contiguous run of whole words inside `haystack`?
// Whole-word runs keep a short line like "n st" from matching mid-word.
function containsTokenRun(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) { return false }
  return haystack.some((_, index) =>
    needle.every((token, offset) => haystack[index + offset] === token),
  )
}

/**
 * Does the suggestion's street line agree with the street that was pasted?
 * Containment either way lets a street-level suggestion ("North Front Street")
 * corroborate a pasted line carrying a house number ("1617 North Front St").
 */
function isStreetMatch(pastedText: string, suggestionStreet: string | null | undefined): boolean {
  const pasted = toTokens(pastedText)
  const suggested = toTokens(suggestionStreet ?? '')
  if (!pasted.length || !suggested.length) { return false }
  return containsTokenRun(pasted, suggested) || containsTokenRun(suggested, pasted)
}

function containsPhrase(pastedText: string, phrase: string | null | undefined): boolean {
  if (!phrase?.trim()) { return false }
  return containsTokenRun(toTokens(pastedText), toTokens(phrase))
}

/**
 * Is a Mapbox suggestion actually the address that was pasted?
 *
 * The street has to agree. City and postal code deliberately do NOT corroborate
 * on their own: asked for an address it can't place, Mapbox answers with a
 * different street in the same ZIP — a pasted "South 2750 West … 84087" comes
 * back as "2750 South 700 West … 84087" — and auto-applying that is precisely
 * the silent overwrite this guards against.
 *
 * A business (POI) match is the one exception. It is offered *because* its
 * street differs from a pasted one Mapbox can't pin (common for rural Puerto
 * Rico), so it corroborates on geography instead: its city or postal code must
 * appear in the pasted text.
 */
export function isSuggestionCorroborated(
  pastedText: string,
  suggestion: CorroborationCandidate | null | undefined,
): boolean {
  if (!suggestion) { return false }
  const pasted = normalizePastedAddress(pastedText)
  if (!pasted) { return false }

  if (isStreetMatch(pasted, suggestion.street)) { return true }
  if (!suggestion.isBusiness) { return false }

  return containsPhrase(pasted, suggestion.city) || containsPhrase(pasted, suggestion.postalCode)
}

/**
 * The first suggestion the pasted text actually backs. Scanning the whole list
 * rather than trusting Mapbox's #1 recovers the common case where the right
 * street is ranked below a nearer, wrong one.
 */
export function pickCorroboratedSuggestion<T extends CorroborationCandidate>(
  pastedText: string,
  suggestions: T[],
): T | null {
  return suggestions.find((suggestion) => isSuggestionCorroborated(pastedText, suggestion)) ?? null
}

/**
 * Peel a city name off the end of a street line.
 *
 * A paste written as one line has no separator between the two
 * ("BLDG. 1330 BAY 3 DOOR 11 ALBANY GA 31704"), so the city stays attached to
 * the street through the segment split. Once the city is known from elsewhere —
 * the postal code identifies it — this removes it from where the paste left it.
 *
 * The tail is compared through the same normalization as everything else, so
 * casing and abbreviation don't matter. A street that is *only* the city name is
 * returned untouched rather than emptied.
 */
export function stripTrailingCity(street: string, city: string | null | undefined): string {
  const cityTokens = toTokens(city ?? '')
  if (!cityTokens.length) { return street }

  const words = street.trim().split(/\s+/).filter(Boolean)
  if (words.length <= cityTokens.length) { return street }

  const tailTokens = toTokens(words.slice(-cityTokens.length).join(' '))
  if (tailTokens.length !== cityTokens.length) { return street }
  if (!cityTokens.every((token, index) => tailTokens[index] === token)) { return street }

  return words.slice(0, -cityTokens.length).join(' ').replace(/[,\s]+$/, '')
}

// Pull a postal code off the end of a segment, returning it and whatever text
// preceded it. null when the segment doesn't end in a code we recognise.
function takePostalCode(segment: string): { value: string, rest: string } | null {
  for (const pattern of POSTAL_PATTERNS) {
    const match = segment.match(pattern)
    if (match && match.index !== undefined) {
      return {
        value: match[0].trim(),
        rest: segment.slice(0, match.index).replace(/[,\s]+$/, '').trim(),
      }
    }
  }
  return null
}

// Match a region at the end of a segment. A whole-segment match accepts any
// written form ("Utah", "UT", "Utah (UT)"); a trailing match accepts only the
// code, so a city ending in a region's name ("Fort Washington") isn't split.
function takeRegion(
  segment: string,
  regions: RegionOption[],
): { id: number | string, rest: string } | null {
  const trimmed = segment.trim()
  if (!trimmed) { return null }
  const normalized = trimmed.toLowerCase()

  const wholeSegmentForms = regions.flatMap((region) => [
    ...(region.code ? [{ id: region.id, text: `${region.name} (${region.code})` }] : []),
    { id: region.id, text: region.name },
    ...(region.code ? [{ id: region.id, text: region.code }] : []),
  ])
  // Longest first so "Utah (UT)" wins over the bare "Utah" inside it.
  for (const form of [...wholeSegmentForms].sort((a, b) => b.text.length - a.text.length)) {
    if (form.text?.trim().toLowerCase() === normalized) {
      return { id: form.id, rest: '' }
    }
  }

  for (const region of regions) {
    const code = region.code?.trim().toLowerCase()
    if (code && normalized.endsWith(` ${code}`)) {
      return { id: region.id, rest: trimmed.slice(0, trimmed.length - code.length).trim() }
    }
  }
  return null
}

// Drop the last segment, or replace it with what's left of it.
function replaceLast(segments: string[], rest: string): string[] {
  const head = segments.slice(0, -1)
  return rest ? [...head, rest] : head
}

/**
 * Split pasted address text into the form's fields.
 *
 * Used when no suggestion corroborates the paste: the form still gets filled,
 * but only ever from the user's own text. Fields are read off the end — postal
 * code, then region, then city — because that tail order is stable across
 * sources, while the street keeps whatever leads. Anything not recognised is
 * returned empty so the caller can leave that field untouched rather than
 * clearing it.
 */
export function parsePastedAddress(
  pastedText: string,
  options: ParsePastedAddressOptions = {},
): PastedAddressParts {
  const { regions = [], countryAliases = [] } = options
  const parts: PastedAddressParts = { street: '', unitSuite: '', city: '', regionId: null, postalCode: '' }

  const normalized = normalizePastedAddress(pastedText)
  if (!normalized) { return parts }

  const ignored = new Set([
    ...countryAliases.filter(Boolean).map((alias) => String(alias).trim().toLowerCase()),
    ...EXTRA_COUNTRY_ALIASES,
  ])
  let segments = normalized
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    // A street is never spelled exactly "US" or "Shipping", so these can be
    // dropped wherever they sit — a copied table row leads with them.
    .filter((segment) => !ignored.has(segment.toLowerCase()) && !ROW_LABEL_PATTERN.test(segment))

  if (!segments.length) { return { ...parts, street: normalized } }

  const postal = takePostalCode(segments[segments.length - 1]!)
  if (postal) {
    parts.postalCode = postal.value
    segments = replaceLast(segments, postal.rest)
  }

  const region = takeRegion(segments[segments.length - 1] ?? '', regions)
  if (region) {
    parts.regionId = region.id
    segments = replaceLast(segments, region.rest)
  }

  // Never take the first segment as the city — that one is the street.
  if (segments.length > 1) {
    parts.city = segments[segments.length - 1]!
    segments = segments.slice(0, -1)
  }

  const unitIndex = segments.findIndex((segment, index) => index > 0 && UNIT_PATTERN.test(segment))
  if (unitIndex > 0) {
    parts.unitSuite = segments[unitIndex]!
    segments = segments.filter((_, index) => index !== unitIndex)
  }

  parts.street = segments.join(', ')
  return parts
}
