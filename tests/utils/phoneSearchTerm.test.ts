import { isPhoneSearchTerm, stripPhoneExtension } from '~/utils/formatPhone'

describe('Scenario: Searching by phone number', () => {
  it('recognises the format the app itself displays', () => {
    expect(isPhoneSearchTerm('+1 (320) 455-4670')).toBe(true)
  })

  it('recognises a number written with any of the common separators', () => {
    for (const term of ['3204554670', '320 455', '914-361-5557', '914.361.5557', '+44 20 7946 0958']) {
      expect(isPhoneSearchTerm(term), term).toBe(true)
    }
  })

  it('recognises heavily punctuated international numbers', () => {
    expect(isPhoneSearchTerm('+923-1233-34-3')).toBe(true)
  })

  it('accepts whatever separator was typed or pasted', () => {
    // A mistyped "=" (next to "-" on the keyboard), an underscore, a slash, a
    // comma, and the en-dash Word and Outlook substitute on paste.
    for (const term of ['979=848-5526', '979_848_5526', '979/848/5526', '979,848,5526', '979–848–5526']) {
      expect(isPhoneSearchTerm(term), term).toBe(true)
    }
  })

  it('recognises a number carrying an extension', () => {
    for (const term of ['+1 (979) 848-5526 x123434', '979-848-5526 ext 123', '(555) 123-4567 #12']) {
      expect(isPhoneSearchTerm(term), term).toBe(true)
    }
  })

  it('treats a leading + as a phone search before any digits are typed', () => {
    expect(isPhoneSearchTerm('+')).toBe(true)
    expect(isPhoneSearchTerm('+1')).toBe(true)
  })
})

describe('Scenario: Searching text that merely contains digits', () => {
  // Each of these used to be reduced to its digits and matched against every
  // phone number in the database, burying the real match.
  it('does not treat an email as a phone number', () => {
    for (const term of ['CBUTCHER@hotel180', 'info@abc123.com']) {
      expect(isPhoneSearchTerm(term), term).toBe(false)
    }
  })

  it('does not treat a company or building name as a phone number', () => {
    for (const term of ['ISD 194', 'suite 200', 'HVAC 555', 'Bldg 1330', 'Hotel 180 Group']) {
      expect(isPhoneSearchTerm(term), term).toBe(false)
    }
  })

  it('does not treat a SKU or account number as a phone number', () => {
    expect(isPhoneSearchTerm('AMC01-0005')).toBe(false)
  })

  it('judges by whether letters surround the digits, not how many characters do', () => {
    // "+1 (320) 455-4670" carries six non-digit characters and IS a phone number;
    // "ISD 194" carries four and is not. A count can't separate them.
    expect(isPhoneSearchTerm('+1 (320) 455-4670')).toBe(true)
    expect(isPhoneSearchTerm('ISD 194')).toBe(false)
  })

  it('ignores punctuation with no number behind it', () => {
    for (const term of ['', '   ', '-', '()']) {
      expect(isPhoneSearchTerm(term), JSON.stringify(term)).toBe(false)
    }
  })
})

describe('Scenario: Extensions are stored apart from the number', () => {
  it('drops a trailing extension in each written form', () => {
    expect(stripPhoneExtension('+1 (979) 848-5526 x123434')).toBe('+1 (979) 848-5526')
    expect(stripPhoneExtension('979-848-5526 ext 123')).toBe('979-848-5526')
    expect(stripPhoneExtension('979-848-5526 ext. 123')).toBe('979-848-5526')
    expect(stripPhoneExtension('(555) 123-4567 #12')).toBe('(555) 123-4567')
  })

  it('leaves a number without one untouched', () => {
    expect(stripPhoneExtension('+1 (979) 848-5526')).toBe('+1 (979) 848-5526')
  })

  it('keeps the extension digits out of the number searched', () => {
    // Concatenated ("19798485526123434") this matched nothing at all.
    const digits = stripPhoneExtension('+1 (979) 848-5526 x123434').replace(/\D/g, '')
    expect(digits).toBe('19798485526')
  })
})
