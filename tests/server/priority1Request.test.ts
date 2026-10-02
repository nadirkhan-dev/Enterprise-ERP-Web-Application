import { getPriority1LtlRates } from '../../server/utils/priority1'
import { resetProviderCredentials } from '../../server/utils/providerConfig'
import { ACCESSORIAL_CODES } from '../../server/utils/shippingAccessorials'

// The `priority1` provider row exactly as it stands in LibertyDev.
const PROVIDER_ROW = {
  api_base_url: 'https://dev-api.priority1.com',
  api_key_env_var: 'NUXT_PRIORITY_ONE_API_KEY',
  api_secret_env_var: null,
  api_config: {
    quotePath: '/v2/ltl/quotes/rates',
    currency: 'USD',
    timeouts: { providerSeconds: 15, requestSeconds: 30 },
    ltlEstimateDefaults: {
      pallet: { lengthIn: 48, widthIn: 40, heightIn: 48 },
      packagingType: 'Pallet',
      units: 1,
      pieces: 1,
      isStackable: false,
      isHazardous: false,
      isUsed: false,
      isMachinery: false,
      description: 'Commercial HVAC equipment or parts',
      pickupLeadBusinessDays: 1,
      nmfcItemCode: '114115',
    },
  },
}

const RATE_RESPONSE = {
  rateQuotes: [
    {
      carrierName: 'FedEx Priority',
      carrierCode: 'FXFE',
      serviceLevel: 'FEDEX_FREIGHT_PRIORITY',
      serviceLevelDescription: 'Priority',
      transitDays: 3,
      rateQuoteDetail: { total: 359.96 },
    },
  ],
}

const SHIPPER = { postalCode: '72205', countryCode: 'US', stateOrProvinceCode: 'AR', city: 'Little Rock' }
const RECIPIENT = { postalCode: '60606', countryCode: 'US', stateOrProvinceCode: 'IL', city: 'Chicago' }

/** Routes Directus and Priority1 apart, and records the outgoing quote body. */
function mockNetwork(rateResponse: unknown = RATE_RESPONSE) {
  const calls: Array<{ url: string, body: any, headers: Record<string, string> }> = []
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = String(input)
    if (url.includes('/items/providers')) {
      return { ok: true, status: 200, json: async () => ({ data: [PROVIDER_ROW] }) } as unknown as Response
    }
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers ?? {} })
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(rateResponse),
    } as unknown as Response
  }) as never
  return calls
}

describe('Scenario: Serializing a rate request for Priority1', () => {
  beforeEach(() => {
    resetProviderCredentials()
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
      priorityOneApiUrl: '',
      priorityOneApiKey: '',
    })
    process.env.NUXT_PRIORITY_ONE_API_KEY = 'p1-key'
  })
  afterEach(() => { delete process.env.NUXT_PRIORITY_ONE_API_KEY })

  it('posts to the quote path on the base URL the provider row names', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://dev-api.priority1.com/v2/ltl/quotes/rates')
    expect(calls[0].headers['X-API-KEY']).toBe('p1-key')
  })

  it('sends two-letter country codes, not the three-letter ones v2 rejects', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    expect(calls[0].body.originCountryCode).toBe('US')
    expect(calls[0].body.destinationCountryCode).toBe('US')
  })

  it('sends pickupDate as a date-time, which the schema requires', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    expect(calls[0].body.pickupDate).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00$/)
  })

  it('falls back to one loaded pallet when dimensions are absent', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    const item = calls[0].body.items[0]
    expect([item.length, item.width, item.height]).toEqual([48, 40, 48])
  })

  it('uses measured dimensions when all three are present', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(
      SHIPPER, RECIPIENT,
      [{ weightLb: 275, lengthIn: 60, widthIn: 40, heightIn: 30 }],
    )

    const item = calls[0].body.items[0]
    expect([item.length, item.width, item.height]).toEqual([60, 40, 30])
  })

  it('treats a partial dimension set as no dimensions at all', async () => {
    // Priority1 500s on a partial set, and half a box is not a shipment.
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275, lengthIn: 60, widthIn: 40 }])

    const item = calls[0].body.items[0]
    expect([item.length, item.width, item.height]).toEqual([48, 40, 48])
  })

  it('sends a freight class and NMFC subcode that agree with each other', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    const item = calls[0].body.items[0]
    // 275 lb over a 48×40×48 pallet is 5.16 pcf -> class 250, sub 07.
    expect(item.freightClass).toBe('250')
    expect(item.nmfcItemCode).toBe('114115')
    expect(item.nmfcSubCode).toBe('07')
  })

  it('sends the conservative item flags rather than letting them default', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    expect(calls[0].body.items[0]).toMatchObject({
      packagingType: 'Pallet',
      units: 1,
      pieces: 1,
      isStackable: false,
      isHazardous: false,
      isUsed: false,
      isMachinery: false,
      description: 'Commercial HVAC equipment or parts',
    })
  })

  it('omits accessorialServices entirely when nothing is selected', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    expect('accessorialServices' in calls[0].body).toBe(false)
  })

  it('sends selected accessorials sorted, and raises the hazardous item flag', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }], {
      accessorials: [ACCESSORIAL_CODES.LIFTGATE_REQUIRED, ACCESSORIAL_CODES.HAZARDOUS_MATERIALS],
    })

    expect(calls[0].body.accessorialServices).toEqual([{ code: 'HAZM' }, { code: 'LGDEL' }])
    expect(calls[0].body.items[0].isHazardous).toBe(true)
  })

  it('passes the provider timeout from the row', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    expect(calls[0].body.apiConfiguration).toEqual({ timeout: 15 })
  })

  it('never calls the suggested-class endpoint', async () => {
    const calls = mockNetwork()
    await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    expect(calls.some(call => call.url.includes('suggestedclass'))).toBe(false)
  })

  it('refuses to quote before calling out when the weight is missing', async () => {
    const calls = mockNetwork()
    await expect(getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 0 }])).rejects.toThrow(/weight/i)
    expect(calls).toHaveLength(0)
  })
})

describe('Scenario: Reading Priority1 rate quotes back', () => {
  beforeEach(() => {
    resetProviderCredentials()
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
      priorityOneApiUrl: '',
      priorityOneApiKey: '',
    })
    process.env.NUXT_PRIORITY_ONE_API_KEY = 'p1-key'
  })
  afterEach(() => { delete process.env.NUXT_PRIORITY_ONE_API_KEY })

  it('keeps the SCAC and service level the whitelist joins on', async () => {
    mockNetwork()
    const [quote] = await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])

    expect(quote.carrierCode).toBe('FXFE')
    expect(quote.serviceLevel).toBe('FEDEX_FREIGHT_PRIORITY')
    expect(quote.totalNetCharge).toBe(359.96)
    expect(quote.currency).toBe('USD')
  })

  it('drops a quote carrying no usable total', async () => {
    mockNetwork({
      rateQuotes: [
        { carrierCode: 'SAIA', serviceLevel: 'STD', rateQuoteDetail: { total: 0 } },
        { carrierCode: 'RLCA', serviceLevel: 'STD', rateQuoteDetail: null },
        { carrierCode: 'FXFE', serviceLevel: 'FEDEX_FREIGHT_PRIORITY', rateQuoteDetail: { total: 12.5 } },
      ],
    })

    const quotes = await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])
    expect(quotes.map(quote => quote.carrierCode)).toEqual(['FXFE'])
  })

  it('returns nothing rather than throwing when no carrier could rate the lane', async () => {
    mockNetwork({ rateQuotes: [], invalidRateQuotes: [{ carrierCode: 'SEFL' }] })

    expect(await getPriority1LtlRates(SHIPPER, RECIPIENT, [{ weightLb: 275 }])).toEqual([])
  })
})
