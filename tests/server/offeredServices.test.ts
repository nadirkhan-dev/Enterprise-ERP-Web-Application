import {
  approvalKey,
  fetchOfferedServices,
  matchOfferedService,
  OfferedServiceLookupError,
  PRIORITY1_CARRIER_ALIASES,
  resetOfferedServices,
  type OfferedService,
} from '../../server/utils/offeredServices'

interface MethodRow {
  name: string
  carrier_id: string | null
  carrier: string | null
  carrierName?: string
  speed?: string | null
}

/** A `shipping_methods` reply in the shape the catalogue query asks for. */
function mockDirectusMethods(rows: MethodRow[]) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: rows.map(row => ({
        name: row.name,
        carrier_id: row.carrier_id,
        shipping_carriers_id: row.carrier
          ? { code: row.carrier, name: row.carrierName ?? row.carrier }
          : null,
        shipping_speeds_id: row.speed ? { code: row.speed, name: row.speed } : null,
      })),
    }),
  }) as unknown as Response)
}

// What LibertyDev holds: FedEx Freight's two LTL methods, plus a parcel method.
const LIBERTY_METHODS: MethodRow[] = [
  {
    name: 'FedEx Freight Priority',
    carrier_id: 'FEDEX_FREIGHT_PRIORITY',
    carrier: 'fedex_freight',
    carrierName: 'FedEx Freight',
    speed: 'priority_ltl',
  },
  {
    name: 'FedEx Freight Economy',
    carrier_id: 'FEDEX_FREIGHT_ECONOMY',
    carrier: 'fedex_freight',
    carrierName: 'FedEx Freight',
    speed: 'economy_ltl',
  },
  { name: 'UPS Ground', carrier_id: '03', carrier: 'ups', carrierName: 'UPS', speed: 'ground' },
]

function catalogue(): Map<string, OfferedService> {
  const services = new Map<string, OfferedService>()
  for (const row of LIBERTY_METHODS) {
    services.set(approvalKey(row.carrier!, row.carrier_id!), {
      carrierCode: row.carrier!,
      carrierName: row.carrierName ?? row.carrier!,
      serviceCode: row.carrier_id!,
      methodName: row.name,
      speedCode: row.speed ?? null,
      speedName: row.speed ?? null,
    })
  }
  return services
}

// Priority1 reports a SCAC where SupplyHub holds a canonical carrier code, and
// FedEx Freight answers to two of them.
describe('Scenario: Matching a Priority1 quote to an approved carrier service', () => {
  const services = catalogue()

  it('admits FedEx Priority through the FXFE alias', () => {
    const match = matchOfferedService(services, 'FXFE', 'FEDEX_FREIGHT_PRIORITY', PRIORITY1_CARRIER_ALIASES)

    expect(match?.carrierName).toBe('FedEx Freight')
    expect(match?.methodName).toBe('FedEx Freight Priority')
    expect(match?.speedCode).toBe('priority_ltl')
  })

  it('admits FedEx Economy through the FXNL alias — one carrier, two SCACs', () => {
    const match = matchOfferedService(services, 'FXNL', 'FEDEX_FREIGHT_ECONOMY', PRIORITY1_CARRIER_ALIASES)

    expect(match?.carrierName).toBe('FedEx Freight')
    expect(match?.speedCode).toBe('economy_ltl')
  })

  it('rejects the haulers Liberty has no carrier record for', () => {
    // The six-row result set observed live: only the two FedEx rows are ours.
    for (const [scac, service] of [['RLCA', 'STD'], ['ABFS', 'MR'], ['UPGF', 'STD'], ['SAIA', 'STD']]) {
      expect(
        matchOfferedService(services, scac, service, PRIORITY1_CARRIER_ALIASES),
        scac,
      ).toBeNull()
    }
  })

  it('rejects a mapped carrier answering with a service level we do not sell', () => {
    expect(matchOfferedService(services, 'FXFE', 'FEDEX_FIRST_FREIGHT', PRIORITY1_CARRIER_ALIASES)).toBeNull()
  })

  it('matches a direct carrier call by its canonical code, with no alias', () => {
    expect(matchOfferedService(services, 'ups', '03')?.methodName).toBe('UPS Ground')
    expect(matchOfferedService(services, 'ups', '07')).toBeNull()
  })

  it('is not confused by casing on either half of the key', () => {
    expect(matchOfferedService(services, 'fxfe', 'fedex_freight_priority', PRIORITY1_CARRIER_ALIASES)).not.toBeNull()
    expect(matchOfferedService(services, 'UPS', '03')).not.toBeNull()
  })
})

describe('Scenario: Reading the approved-service catalogue from Directus', () => {
  beforeEach(() => {
    resetOfferedServices()
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  it('keys every active method by carrier code and service code', async () => {
    globalThis.fetch = mockDirectusMethods(LIBERTY_METHODS)

    const services = await fetchOfferedServices()

    expect([...services.keys()].sort()).toEqual([
      'fedex_freight:FEDEX_FREIGHT_ECONOMY',
      'fedex_freight:FEDEX_FREIGHT_PRIORITY',
      'ups:03',
    ])
  })

  it('asks Directus only for active methods', async () => {
    const fetchMock = mockDirectusMethods(LIBERTY_METHODS)
    globalThis.fetch = fetchMock
    await fetchOfferedServices()

    const requestedUrl = String(fetchMock.mock.calls[0][0])
    expect(requestedUrl).toContain('/items/shipping_methods')
    expect(requestedUrl).toContain('filter%5Bstatus%5D%5B_eq%5D=active')
  })

  it('skips a method missing either half of the approval key', async () => {
    globalThis.fetch = mockDirectusMethods([
      { name: 'Orphan', carrier_id: 'STD', carrier: null },
      { name: 'No service', carrier_id: null, carrier: 'saia' },
      { name: 'UPS Ground', carrier_id: '03', carrier: 'ups' },
    ])

    expect([...(await fetchOfferedServices()).keys()]).toEqual(['ups:03'])
  })

  it('serves the second caller from cache rather than re-reading Directus', async () => {
    const fetchMock = mockDirectusMethods(LIBERTY_METHODS)
    globalThis.fetch = fetchMock

    await fetchOfferedServices()
    await fetchOfferedServices()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats an all-inactive catalogue as a real answer, not a failure', async () => {
    globalThis.fetch = mockDirectusMethods([])

    expect((await fetchOfferedServices()).size).toBe(0)
  })
})

// Returning unfiltered rates would put carriers Liberty never approved in front
// of a user. Every unreadable-configuration path has to throw instead.
describe('Scenario: The approval catalogue cannot be read', () => {
  beforeEach(() => {
    resetOfferedServices()
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  it('fails closed when Directus is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })

    await expect(fetchOfferedServices()).rejects.toBeInstanceOf(OfferedServiceLookupError)
  })

  it('fails closed when Directus refuses the lookup', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 403, json: async () => ({}),
    }) as unknown as Response)

    await expect(fetchOfferedServices()).rejects.toBeInstanceOf(OfferedServiceLookupError)
  })

  it('fails closed when Directus is not configured at all', async () => {
    globalThis.useRuntimeConfig = () => ({ directusUrl: '', directusToken: '' })
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock

    await expect(fetchOfferedServices()).rejects.toBeInstanceOf(OfferedServiceLookupError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
