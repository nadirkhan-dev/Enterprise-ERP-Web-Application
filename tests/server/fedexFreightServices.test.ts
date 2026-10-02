import { isFreightServiceType } from '../../server/utils/fedex'

// The FedEx Rate API is called without a service restriction, so it returns
// every service the shipment qualifies for. Under 150 lb that includes parcel
// services, which must not appear in an LTL result.
describe('Scenario: Rating an LTL shipment light enough to also qualify for parcel', () => {
  const PARCEL_SERVICES = [
    'FEDEX_GROUND', 'GROUND_HOME_DELIVERY', 'FEDEX_EXPRESS_SAVER',
    'FEDEX_2_DAY', 'FEDEX_2_DAY_AM', 'STANDARD_OVERNIGHT',
    'PRIORITY_OVERNIGHT', 'FIRST_OVERNIGHT', 'SMART_POST',
    'INTERNATIONAL_PRIORITY', 'INTERNATIONAL_ECONOMY',
  ]
  const FREIGHT_SERVICES = [
    'FEDEX_FREIGHT_PRIORITY', 'FEDEX_FREIGHT_ECONOMY', 'FEDEX_FIRST_FREIGHT',
    'FEDEX_1_DAY_FREIGHT', 'FEDEX_2_DAY_FREIGHT', 'FEDEX_3_DAY_FREIGHT',
    'INTERNATIONAL_PRIORITY_FREIGHT', 'INTERNATIONAL_ECONOMY_FREIGHT',
  ]

  it('excludes every parcel service', () => {
    for (const service of PARCEL_SERVICES) {
      expect(isFreightServiceType(service), service).toBe(false)
    }
  })

  it('keeps every freight service, air freight included', () => {
    for (const service of FREIGHT_SERVICES) {
      expect(isFreightServiceType(service), service).toBe(true)
    }
  })

  it('is not confused by casing or an empty service type', () => {
    expect(isFreightServiceType('fedex_freight_economy')).toBe(true)
    expect(isFreightServiceType('')).toBe(false)
  })
})
