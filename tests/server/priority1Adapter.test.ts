import {
  buildPickupDate,
  classifyHvacFreight,
  PRIORITY1_ACCESSORIALS,
  Priority1ApiError,
  resolveAccessorials,
  summarizeInvalidQuotes,
} from '../../server/utils/priority1'
import { ACCESSORIAL_CODES } from '../../server/utils/shippingAccessorials'

// NMFC item 114115, palletized/non-crated: class falls in density bands, and the
// subcode must always agree with the class because both come from one call.
describe('Scenario: Classifying palletized commercial HVAC freight', () => {
  // A 48 × 40 × 48 in pallet is 53.33 ft³, so weight maps directly to density.
  const cubicFeet = (48 * 40 * 48) / 1728
  const atDensity = (pcf: number) => classifyHvacFreight(pcf * cubicFeet, 48, 40, 48)

  it('rates the default 275 lb pallet as class 250, not the 175 Priority1 suggests', () => {
    const { freightClass, nmfcSubCode, densityPcf } = classifyHvacFreight(275, 48, 40, 48)

    expect(densityPcf).toBeCloseTo(5.16, 2)
    expect(freightClass).toBe('250')
    expect(nmfcSubCode).toBe('07')
  })

  it('walks the four density bands', () => {
    expect(atDensity(3)).toMatchObject({ freightClass: '250', nmfcSubCode: '07' })
    expect(atDensity(8)).toMatchObject({ freightClass: '150', nmfcSubCode: '08' })
    expect(atDensity(12)).toMatchObject({ freightClass: '100', nmfcSubCode: '09' })
    expect(atDensity(20)).toMatchObject({ freightClass: '77.5', nmfcSubCode: '10' })
  })

  it('puts each boundary in the lighter-density band it belongs to', () => {
    // The bands are "< 6", "6 to < 10", "10 to < 15", "15+" — so the boundary
    // value itself belongs to the band above it.
    expect(atDensity(5.999).freightClass).toBe('250')
    expect(atDensity(6).freightClass).toBe('150')
    expect(atDensity(9.999).freightClass).toBe('150')
    expect(atDensity(10).freightClass).toBe('100')
    expect(atDensity(14.999).freightClass).toBe('100')
    expect(atDensity(15).freightClass).toBe('77.5')
  })

  it('never returns a class without its matching subcode', () => {
    const pairs = new Map([['250', '07'], ['150', '08'], ['100', '09'], ['77.5', '10']])
    for (const pcf of [1, 6, 10, 15, 40]) {
      const { freightClass, nmfcSubCode } = atDensity(pcf)
      expect(nmfcSubCode, `density ${pcf}`).toBe(pairs.get(freightClass))
    }
  })
})

describe('Scenario: Choosing the pickup date Priority1 rates against', () => {
  it('serializes a local date-time at midnight, with no zone', () => {
    // A Wednesday — one business day ahead is Thursday.
    expect(buildPickupDate(1, new Date(2026, 7, 19))).toBe('2026-08-20T00:00:00')
  })

  it('never quotes a weekend', () => {
    // Friday + 1 business day is Monday, not Saturday.
    expect(buildPickupDate(1, new Date(2026, 7, 21))).toBe('2026-08-24T00:00:00')
    // Saturday with no lead still rolls forward to Monday.
    expect(buildPickupDate(0, new Date(2026, 7, 22))).toBe('2026-08-24T00:00:00')
  })

  it('does not shift the date backwards for timezones west of UTC', () => {
    // Built from local calendar parts; toISOString() on a local midnight would
    // report the previous day here, quoting a pickup in the past.
    const pickup = buildPickupDate(1, new Date(2026, 7, 19, 23, 30))
    expect(pickup.startsWith('2026-08-20')).toBe(true)
  })

  it('counts several business days across a weekend', () => {
    // Thursday + 3 business days -> Tuesday.
    expect(buildPickupDate(3, new Date(2026, 7, 20))).toBe('2026-08-25T00:00:00')
  })
})

describe('Scenario: Turning selected options into Priority1 accessorials', () => {
  const {
    LIFTGATE_REQUIRED: LIFTGATE,
    LIMITED_ACCESS_DELIVERY: LIMITED,
    HAZARDOUS_MATERIALS: HAZMAT,
    RESIDENTIAL_DELIVERY: RESIDENTIAL,
    DELIVERY_APPOINTMENT: APPOINTMENT,
  } = ACCESSORIAL_CODES

  it('maps each of the five supported options to its live-tested code', () => {
    expect(resolveAccessorials([LIFTGATE]).external).toEqual(['LGDEL'])
    expect(resolveAccessorials([LIMITED]).external).toEqual(['LTDDEL'])
    expect(resolveAccessorials([HAZMAT]).external).toEqual(['HAZM'])
    expect(resolveAccessorials([RESIDENTIAL]).external).toEqual(['RESDEL'])
    expect(resolveAccessorials([APPOINTMENT]).external).toEqual(['APPT'])
  })

  it('omits the field entirely when nothing is selected', () => {
    expect(resolveAccessorials([])).toEqual({ external: [], isHazardous: false })
  })

  it('sorts and de-duplicates so a selection always serializes the same way', () => {
    const first = resolveAccessorials([APPOINTMENT, LIFTGATE, HAZMAT])
    const second = resolveAccessorials([HAZMAT, APPOINTMENT, LIFTGATE, LIFTGATE])

    expect(first.external).toEqual(['APPT', 'HAZM', 'LGDEL'])
    expect(second.external).toEqual(first.external)
  })

  it('raises the item hazardous flag as well as sending HAZM', () => {
    // Priority1 derives one from the other, but sending both states the intent
    // in the request rather than relying on their inference.
    expect(resolveAccessorials([HAZMAT])).toEqual({ external: ['HAZM'], isHazardous: true })
    expect(resolveAccessorials([LIFTGATE]).isHazardous).toBe(false)
  })

  it('refuses limited-access together with residential delivery', () => {
    // ABF calls the pair incompatible and one combination 500s the whole quote.
    expect(() => resolveAccessorials([LIMITED, RESIDENTIAL])).toThrow(Priority1ApiError)
    expect(() => resolveAccessorials([LIMITED, RESIDENTIAL])).toThrow(/mutually exclusive|cannot be combined/i)
  })

  it('refuses every combination containing that pair, not just the pair alone', () => {
    const others = [LIFTGATE, HAZMAT, APPOINTMENT]
    // All 8 subsets of {L,H,P} added to the forbidden pair.
    for (let mask = 0; mask < 8; mask++) {
      const extra = others.filter((_, index) => mask & (1 << index))
      expect(
        () => resolveAccessorials([LIMITED, RESIDENTIAL, ...extra]),
        extra.join('+') || 'pair alone',
      ).toThrow(Priority1ApiError)
    }
  })

  it('accepts all 24 combinations that do not contain the forbidden pair', () => {
    const flags = [LIFTGATE, LIMITED, HAZMAT, RESIDENTIAL, APPOINTMENT]
    let accepted = 0
    for (let mask = 0; mask < 32; mask++) {
      const selection = flags.filter((_, index) => mask & (1 << index))
      if (selection.includes(LIMITED) && selection.includes(RESIDENTIAL)) { continue }
      const { external } = resolveAccessorials(selection)
      expect(external).toEqual([...external].sort())
      expect(external).toHaveLength(selection.length)
      accepted += 1
    }
    expect(accepted).toBe(24)
  })

  it('rejects an option Priority1 has no equivalent for rather than dropping it', () => {
    // SATPU is Saturday *pickup* and RDNS is "no signature" — substituting
    // either would quote a service the user did not ask for. A dropped option
    // would understate the price silently, so this is a 422.
    for (const code of [ACCESSORIAL_CODES.SATURDAY_DELIVERY, ACCESSORIAL_CODES.SIGNATURE_REQUIRED]) {
      expect(() => resolveAccessorials([code]), code).toThrow(Priority1ApiError)
    }
    expect(() => resolveAccessorials(['not_a_real_option'])).toThrow(/does not support/i)
  })

  it('exposes no mapping for the options with no accurate equivalent', () => {
    expect(PRIORITY1_ACCESSORIALS[ACCESSORIAL_CODES.SATURDAY_DELIVERY]).toBeUndefined()
    expect(PRIORITY1_ACCESSORIALS[ACCESSORIAL_CODES.SIGNATURE_REQUIRED]).toBeUndefined()
  })
})

describe('Scenario: Reporting carriers that could not quote', () => {
  it('names the carrier and nothing else', () => {
    // Live invalid-quote text carries stack traces, HTML and vendor URLs; none
    // of it may reach the browser or the logs.
    const warnings = summarizeInvalidQuotes({
      invalidRateQuotes: [
        {
          carrierName: 'Southeastern Freight',
          carrierCode: 'SEFL',
          errorMessages: [{ text: '<html>at Priority1.Rating.Provider... https://internal/vendor' }],
        } as never,
      ],
    })

    expect(warnings).toEqual(['Priority1: Southeastern Freight could not quote this lane.'])
    expect(warnings[0]).not.toContain('html')
    expect(warnings[0]).not.toContain('https://')
  })

  it('falls back to the carrier code and skips anonymous entries', () => {
    expect(summarizeInvalidQuotes({ invalidRateQuotes: [{ carrierCode: 'AACT' }] }))
      .toEqual(['Priority1: AACT could not quote this lane.'])
    expect(summarizeInvalidQuotes({ invalidRateQuotes: [{}] })).toEqual([])
    expect(summarizeInvalidQuotes({})).toEqual([])
  })
})
