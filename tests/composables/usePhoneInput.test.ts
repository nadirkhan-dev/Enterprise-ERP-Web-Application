import { ref } from 'vue'
import { usePhoneInput } from '../../app/composables/usePhoneInput'

/**
 * Unit tests for the phone-input composable. Each describe block represents
 * a country-specific scenario or a cross-cutting parsing concern.
 *
 * The composable's `parse`, `isValid`, `detectCountryFromPaste`, and
 * `extractExtension` functions accept an explicit ISO override, so tests do
 * not need to manipulate the bound `countryIso` ref between cases.
 */

describe('Scenario: US number validation', () => {
  const { parse, isValid } = usePhoneInput(ref('US'))

  it('parses a national-format US number to digits-only national', () => {
    const parsed = parse('(202) 555-0142', 'US')
    expect(parsed.nationalNumber).toBe('2025550142')
    expect(parsed.isValid).toBe(true)
  })

  it('accepts a fully E.164 US number', () => {
    expect(isValid('+12025550142', 'US')).toBe(true)
  })

  it('rejects a too-short US number', () => {
    expect(isValid('5550142', 'US')).toBe(false)
  })
})

describe('Scenario: UK number validation', () => {
  const { parse, isValid } = usePhoneInput(ref('GB'))

  it('parses a national-format UK mobile and strips the trunk 0', () => {
    const parsed = parse('07400 123456', 'GB')
    expect(parsed.nationalNumber).toBe('7400123456')
    expect(parsed.isValid).toBe(true)
  })

  it('accepts an E.164 UK number', () => {
    expect(isValid('+447400123456', 'GB')).toBe(true)
  })
})

describe('Scenario: Germany number validation', () => {
  const { parse, isValid } = usePhoneInput(ref('DE'))

  it('parses a Berlin landline and strips the trunk 0', () => {
    const parsed = parse('030 12345678', 'DE')
    expect(parsed.nationalNumber).toBe('3012345678')
    expect(parsed.isValid).toBe(true)
  })

  it('rejects an obviously too-short DE number', () => {
    expect(isValid('123', 'DE')).toBe(false)
  })
})

describe('Scenario: France number validation', () => {
  const { parse, isValid } = usePhoneInput(ref('FR'))

  it('parses a French landline and strips the trunk 0', () => {
    const parsed = parse('01 23 45 67 89', 'FR')
    expect(parsed.nationalNumber).toBe('123456789')
    expect(parsed.isValid).toBe(true)
  })

  it('rejects malformed French input', () => {
    expect(isValid('999', 'FR')).toBe(false)
  })
})

describe('Scenario: Japan number validation', () => {
  const { parse, isValid } = usePhoneInput(ref('JP'))

  it('parses a Tokyo number and strips the trunk 0', () => {
    const parsed = parse('03-1234-5678', 'JP')
    expect(parsed.nationalNumber).toBe('312345678')
    expect(parsed.isValid).toBe(true)
  })

  it('accepts an E.164 JP number', () => {
    expect(isValid('+81312345678', 'JP')).toBe(true)
  })
})

describe('Scenario: Brazil number validation', () => {
  const { parse, isValid } = usePhoneInput(ref('BR'))

  it('parses a São Paulo mobile with the area code', () => {
    const parsed = parse('(11) 91234-5678', 'BR')
    expect(parsed.nationalNumber).toBe('11912345678')
    expect(parsed.isValid).toBe(true)
  })
})

describe('Scenario: Trunk-prefix stripping across countries', () => {
  const { parse } = usePhoneInput(ref('PK'))

  it.each([
    ['PK', '03001234567', '3001234567'],
    ['GB', '07400123456', '7400123456'],
    ['DE', '03012345678', '3012345678'],
    ['FR', '0123456789', '123456789'],
    ['JP', '0312345678', '312345678'],
  ])('strips the leading trunk 0 for %s national input', (iso, input, expectedNational) => {
    const parsed = parse(input, iso)
    expect(parsed.nationalNumber).toBe(expectedNational)
  })
})

describe('Scenario: Invalid number rejection', () => {
  const { isValid, parse } = usePhoneInput(ref('US'))

  it('returns isValid=false for a 3-digit input', () => {
    expect(isValid('123', 'US')).toBe(false)
    expect(parse('123', 'US').isValid).toBe(false)
  })

  it('returns isValid=false for an empty string', () => {
    expect(isValid('', 'US')).toBe(false)
  })

  it('returns isValid=false for a number too long for the selected country', () => {
    expect(isValid('555012345678901234', 'US')).toBe(false)
  })

  it('returns nationalNumber=empty for whitespace-only input', () => {
    const parsed = parse('   ', 'US')
    expect(parsed.nationalNumber).toBe('')
    expect(parsed.isValid).toBe(false)
  })
})

describe('Scenario: Paste with +country code auto-detection', () => {
  const { detectCountryFromPaste } = usePhoneInput(ref('US'))

  it('detects UK from a +44 paste', () => {
    const detected = detectCountryFromPaste('+44 7400 123456')
    expect(detected).not.toBeNull()
    expect(detected!.countryIso).toBe('GB')
    expect(detected!.nationalNumber).toBe('7400123456')
  })

  it('detects Germany from a +49 paste', () => {
    const detected = detectCountryFromPaste('+49 30 12345678')
    expect(detected).not.toBeNull()
    expect(detected!.countryIso).toBe('DE')
    expect(detected!.nationalNumber).toBe('3012345678')
  })

  it('detects Pakistan from a +92 paste', () => {
    const detected = detectCountryFromPaste('+92 300 1234567')
    expect(detected).not.toBeNull()
    expect(detected!.countryIso).toBe('PK')
    expect(detected!.nationalNumber).toBe('3001234567')
  })

  it('returns null when paste does not start with +', () => {
    expect(detectCountryFromPaste('5551234567')).toBeNull()
  })

  it('returns null for unparseable input', () => {
    expect(detectCountryFromPaste('+gibberish')).toBeNull()
  })
})

describe('Scenario: Extension extraction', () => {
  const { extractExtension } = usePhoneInput(ref('US'))

  it.each([
    ['5551234 ext 89',     '5551234',     '89'],
    ['5551234 ext. 89',    '5551234',     '89'],
    ['5551234 x123',       '5551234',     '123'],
    ['5551234 x. 7',       '5551234',     '7'],
    ['5551234 #42',        '5551234',     '42'],
    ['5551234 extension 9', '5551234',    '9'],
  ])('splits %s into number and extension', (input, expectedNumber, expectedExt) => {
    const result = extractExtension(input)
    expect(result.number).toBe(expectedNumber)
    expect(result.extension).toBe(expectedExt)
  })

  it('returns null extension when none is present', () => {
    const result = extractExtension('5551234567')
    expect(result.number).toBe('5551234567')
    expect(result.extension).toBeNull()
  })

  it('returns empty number + null extension for empty input', () => {
    const result = extractExtension('')
    expect(result.number).toBe('')
    expect(result.extension).toBeNull()
  })
})
