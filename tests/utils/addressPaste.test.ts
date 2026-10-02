import {
  normalizePastedAddress,
  isSuggestionCorroborated,
  pickCorroboratedSuggestion,
  parsePastedAddress,
  stripTrailingCity,
} from '~/utils/addressPaste'

const UTAH_REGIONS = [
  { id: 44, name: 'Utah', code: 'UT' },
  { id: 23, name: 'Minnesota', code: 'MN' },
  { id: 6, name: 'Colorado', code: 'CO' },
  { id: 48, name: 'Washington', code: 'WA' },
]
const COUNTRY_ALIASES = ['United States', 'US', 'Canada', 'CA']

// The address from the reported bug, as it sits in the Addresses table.
const TABLE_ROW = 'South 2750 West\t1234 Suite\tWest Bountiful\tUtah (UT)\t84087'

// What Mapbox actually returned for that paste — a real address, wrong street.
const WRONG_SUGGESTION = {
  street: '2750 South 700 West',
  city: 'Woods Cross',
  postalCode: '84087',
  isBusiness: false,
}
const RIGHT_SUGGESTION = {
  street: 'South 2750 West',
  city: 'West Bountiful',
  postalCode: '84087',
  isBusiness: false,
}

describe('Scenario: Pasting an address copied from the Addresses table', () => {
  it('turns tab-separated cells into a comma-separated query', () => {
    expect(normalizePastedAddress(TABLE_ROW)).toBe(
      'South 2750 West, 1234 Suite, West Bountiful, Utah (UT), 84087',
    )
  })

  it('still flattens multi-line pastes from other systems', () => {
    expect(normalizePastedAddress('2750 South 700 West\nSuite 100\nWest Bountiful, UT 84087')).toBe(
      '2750 South 700 West, Suite 100, West Bountiful, UT 84087',
    )
  })

  it('rejects a suggestion whose street is not the pasted one', () => {
    expect(isSuggestionCorroborated(TABLE_ROW, WRONG_SUGGESTION)).toBe(false)
  })

  it('accepts the suggestion that is the pasted street', () => {
    expect(isSuggestionCorroborated(TABLE_ROW, RIGHT_SUGGESTION)).toBe(true)
  })

  it('picks the right street even when Mapbox ranks a wrong one first', () => {
    const picked = pickCorroboratedSuggestion(TABLE_ROW, [WRONG_SUGGESTION, RIGHT_SUGGESTION])
    expect(picked).toBe(RIGHT_SUGGESTION)
  })

  it('picks nothing when every suggestion is a different address', () => {
    const seville = { street: '2750 South Seville Circle', city: 'Grand Junction', postalCode: '81506' }
    expect(pickCorroboratedSuggestion(TABLE_ROW, [WRONG_SUGGESTION, seville])).toBeNull()
  })
})

describe('Scenario: Falling back to the pasted text', () => {
  it('splits the copied table row into every field', () => {
    expect(parsePastedAddress(TABLE_ROW, { regions: UTAH_REGIONS, countryAliases: COUNTRY_ALIASES }))
      .toEqual({
        street: 'South 2750 West',
        unitSuite: '1234 Suite',
        city: 'West Bountiful',
        regionId: 44,
        postalCode: '84087',
      })
  })

  it('drops the Type and Country cells when the whole row is copied', () => {
    const fullRow = 'Shipping\tUS\tSouth 2750 West\t1234 Suite\tWest Bountiful\tUtah (UT)\t84087'
    const parsed = parsePastedAddress(fullRow, { regions: UTAH_REGIONS, countryAliases: COUNTRY_ALIASES })
    expect(parsed.street).toBe('South 2750 West')
    expect(parsed.city).toBe('West Bountiful')
    expect(parsed.regionId).toBe(44)
  })

  it('separates a city, state code and ZIP sharing one line', () => {
    const label = '1617 North Front St\nBLDG 0010\nNew Ulm, MN 56073\nUnited States'
    expect(parsePastedAddress(label, { regions: UTAH_REGIONS, countryAliases: COUNTRY_ALIASES }))
      .toEqual({
        street: '1617 North Front St',
        unitSuite: 'BLDG 0010',
        city: 'New Ulm',
        regionId: 23,
        postalCode: '56073',
      })
  })

  it('does not mistake a city ending in a region name for that region', () => {
    const parsed = parsePastedAddress('123 Main St, Fort Washington, 19034', {
      regions: UTAH_REGIONS,
      countryAliases: COUNTRY_ALIASES,
    })
    expect(parsed.city).toBe('Fort Washington')
    expect(parsed.regionId).toBeNull()
  })

  it('leaves a single-line street paste alone', () => {
    expect(parsePastedAddress('South 2750 West', { regions: UTAH_REGIONS })).toEqual({
      street: 'South 2750 West',
      unitSuite: '',
      city: '',
      regionId: null,
      postalCode: '',
    })
  })
})

describe('Scenario: A one-line paste with no separators', () => {
  const ONE_LINE = 'BLDG. 1330 BAY 3 DOOR 11 ALBANY GA 31704'
  const GEORGIA = [{ id: 11, name: 'Georgia', code: 'GA' }]

  it('reads the state code and ZIP off the end of the line', () => {
    const parsed = parsePastedAddress(ONE_LINE, { regions: GEORGIA })
    expect(parsed.postalCode).toBe('31704')
    expect(parsed.regionId).toBe(11)
  })

  it('leaves the city on the street, since the line gives no boundary', () => {
    expect(parsePastedAddress(ONE_LINE, { regions: GEORGIA }).street)
      .toBe('BLDG. 1330 BAY 3 DOOR 11 ALBANY')
  })

  it('peels the city off once the postal code has named it', () => {
    expect(stripTrailingCity('BLDG. 1330 BAY 3 DOOR 11 ALBANY', 'Albany'))
      .toBe('BLDG. 1330 BAY 3 DOOR 11')
  })

  it('peels off a multi-word city', () => {
    expect(stripTrailingCity('1234 Elm St West Palm Beach', 'West Palm Beach'))
      .toBe('1234 Elm St')
  })

  it('leaves a street that merely resembles the city alone', () => {
    expect(stripTrailingCity('10746 S CHEMOLITE RD', 'Cottage Grove'))
      .toBe('10746 S CHEMOLITE RD')
  })

  it('never empties the street when it is only the city name', () => {
    expect(stripTrailingCity('Albany', 'Albany')).toBe('Albany')
  })
})

describe('Scenario: Business pin for an unpinnable street', () => {
  const poi = { street: 'Carr 493 Km 1.4', city: 'Hatillo', postalCode: '00659', isBusiness: true }

  it('accepts a business whose city appears in the pasted text', () => {
    expect(isSuggestionCorroborated('Calle Marginal, Hatillo, PR, 00659', poi)).toBe(true)
  })

  it('rejects a business somewhere else entirely', () => {
    expect(isSuggestionCorroborated('South 2750 West, West Bountiful, Utah (UT), 84087', poi)).toBe(false)
  })
})

describe('Scenario: Street abbreviations', () => {
  it('treats abbreviated and spelled-out streets as the same address', () => {
    const pasted = '1617 N Front St, New Ulm, MN 56073'
    expect(isSuggestionCorroborated(pasted, { street: 'North Front Street', city: 'New Ulm' })).toBe(true)
  })
})
