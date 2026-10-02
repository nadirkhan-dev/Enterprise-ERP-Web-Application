/**
 * Address duplicate detection — pure comparison helpers run before an address is
 * created so the same location isn't stored twice for one account.
 *
 */

export interface ComparableAddress {
  streetLine1?: string | null
  streetLine2?: string | null
  city?: string | null
  postalCode?: string | null
  /** Relationship id — compared by identity, not text. */
  countryId?: number | string | null
  /** Relationship id — compared by identity, not text. */
  regionId?: number | string | null
}

/** The fields compared between two addresses, each independently. */
export type AddressMatchField = 'streetLine1' | 'city' | 'postalCode' | 'regionId' | 'countryId'


const TRIGGER_FIELDS: AddressMatchField[] = ['streetLine1']
const COMPARED_FIELDS: AddressMatchField[] = [
  'streetLine1',
  'city',
  'postalCode',
  'regionId',
  'countryId',
]

// Trim, collapse internal whitespace runs to a single space, and lowercase — so
// casing and stray spacing never read as a different address. null / undefined /
// '' all normalize to '' so a missing field and an empty field compare equal
// (e.g. an address with no unit vs. one whose unit is blank).
function normalizeText(value: string | null | undefined): string {
  if (value == null) { return '' }
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase()
}

// Country / region are relationship ids, matched by identity. null / undefined /
// '' all mean "not set" and collapse to '' so those cases can't differ from each
// other.
function normalizeId(value: number | string | null | undefined): string {
  if (value == null || value === '') { return '' }
  return String(value)
}
const STREET_WORD_ALIASES: Record<string, string> = {
  // Suffixes
  street: 'st', st: 'st',
  road: 'rd', rd: 'rd',
  avenue: 'ave', ave: 'ave', av: 'ave',
  boulevard: 'blvd', blvd: 'blvd',
  drive: 'dr', dr: 'dr',
  lane: 'ln', ln: 'ln',
  court: 'ct', ct: 'ct',
  place: 'pl', pl: 'pl',
  circle: 'cir', cir: 'cir',
  terrace: 'ter', ter: 'ter',
  parkway: 'pkwy', pkwy: 'pkwy',
  highway: 'hwy', hwy: 'hwy',
  trail: 'trl', trl: 'trl',
  square: 'sq', sq: 'sq',
  point: 'pt', pt: 'pt',
  crossing: 'xing', xing: 'xing',
  expressway: 'expy', expy: 'expy',
  turnpike: 'tpke', tpke: 'tpke',
  extension: 'ext', ext: 'ext',
  // Directionals
  north: 'n', n: 'n',
  south: 's', s: 's',
  east: 'e', e: 'e',
  west: 'w', w: 'w',
  northeast: 'ne', ne: 'ne',
  northwest: 'nw', nw: 'nw',
  southeast: 'se', se: 'se',
  southwest: 'sw', sw: 'sw',
}

/**
 * Normalize a street line for comparison: case and spacing as `normalizeText`,
 * then drop periods ("St." → "st") and fold each word through the alias table so
 * long and abbreviated forms of the same street compare equal.
 */
export function normalizeStreet(value: string | null | undefined): string {
  const normalized = normalizeText(value).replace(/\./g, '')
  if (!normalized) { return '' }

  return normalized
    .split(' ')
    .filter(Boolean)
    .map((word) => STREET_WORD_ALIASES[word] ?? word)
    .join(' ')
}

// U+0001 (Start of Heading) — a control char that can't appear in typed address
// input, so it safely delimits fields in the key without adjacent fields bleeding
// across the boundary (city "A" + postal "B" must not collide with city "A B").
const ADDRESS_KEY_SEPARATOR = String.fromCharCode(1)

export function buildAddressKey(address: ComparableAddress): string {
  return [
    normalizeText(address.streetLine1),
    normalizeText(address.streetLine2),
    normalizeText(address.city),
    normalizeText(address.postalCode),
    normalizeId(address.countryId),
    normalizeId(address.regionId),
  ].join(ADDRESS_KEY_SEPARATOR)
}

function normalizeMatchField(address: ComparableAddress, field: AddressMatchField): string {
  switch (field) {
    case 'streetLine1': return normalizeStreet(address.streetLine1)
    case 'city': return normalizeText(address.city)
    case 'postalCode': return normalizeText(address.postalCode)
    case 'regionId': return normalizeId(address.regionId)
    case 'countryId': return normalizeId(address.countryId)
  }
}

export function getMatchedAddressFields(
  a: ComparableAddress,
  b: ComparableAddress,
): AddressMatchField[] {
  return COMPARED_FIELDS.filter((field) => {
    const left = normalizeMatchField(a, field)
    const right = normalizeMatchField(b, field)
    return left !== '' && right !== '' && left === right
  })
}

export function isSameAddress(a: ComparableAddress, b: ComparableAddress): boolean {
  const matched = getMatchedAddressFields(a, b)
  return TRIGGER_FIELDS.some((field) => matched.includes(field))
}

export function findDuplicateAddresses<T>(
  candidate: ComparableAddress,
  existing: T[],
  toComparable: (entry: T) => ComparableAddress,
): T[] {
  return existing.filter((entry) => isSameAddress(candidate, toComparable(entry)))
}

export function findDuplicateAddress<T>(
  candidate: ComparableAddress,
  existing: T[],
  toComparable: (entry: T) => ComparableAddress,
): T | null {
  return findDuplicateAddresses(candidate, existing, toComparable)[0] ?? null
}
