// @ts-nocheck

describe('Scenario: SAP Special SKU construction', () => {
  let specialSkuModule: typeof import('../../server/api/sap/special-sku.post')

  beforeAll(async () => {
    globalThis.defineEventHandler = (handler: unknown) => handler
    globalThis.createError = (options: { statusCode: number; statusMessage: string }) => {
      const error = new Error(options.statusMessage)
      Object.assign(error, options)
      return error
    }
    globalThis.readBody = vi.fn()

    specialSkuModule = await import('../../server/api/sap/special-sku.post')
  })

  it('generates the Complete SKU with the C suffix', () => {
    const payload = specialSkuModule.validatePayload({
      manufacturerSapId: 10,
      manufacturerName: 'Acme',
      itemGroupSapId: 20,
      itemGroupName: 'Valves',
      itemType: 'complete',
    })

    expect(specialSkuModule.buildSpecialSku(payload)).toBe('LSSMFR10IG20C')
  })

  it('generates the Repair SKU with the R suffix', () => {
    const payload = specialSkuModule.validatePayload({
      manufacturerSapId: 10,
      manufacturerName: 'Acme',
      itemGroupSapId: 20,
      itemGroupName: 'Valves',
      itemType: 'repair',
    })

    expect(specialSkuModule.buildSpecialSku(payload)).toBe('LSSMFR10IG20R')
  })

  it('creates the SAP item body expected by the legacy flow', () => {
    const payload = specialSkuModule.validatePayload({
      manufacturerSapId: 10,
      manufacturerName: 'Acme',
      itemGroupSapId: 20,
      itemGroupName: 'Valves',
      itemType: 'complete',
    })

    expect(specialSkuModule.buildSapItemBody(payload, 'LSSMFR10IG20C')).toEqual({
      ItemCode: 'LSSMFR10IG20C',
      ItemName: '***EDIT ACME VALVES COMPLETE ITEM DESCRIPTION***',
      SalesUnitWeight: 99999,
    })
  })

  it('rejects missing required fields before SAP is called', () => {
    expect(() => specialSkuModule.validatePayload({
      manufacturerSapId: 10,
      manufacturerName: '',
      itemGroupSapId: 20,
      itemGroupName: 'Valves',
      itemType: 'complete',
    })).toThrow('Manufacturer and item group names are required.')
  })
})

describe('Scenario: SAP Service Layer session lifecycle', () => {
  let sapModule: typeof import('../../server/utils/sapServiceLayer')
  let rawFetch: ReturnType<typeof vi.fn>
  let normalFetch: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()

    globalThis.useRuntimeConfig = () => ({
      sapServiceLayerUrl: 'https://sap.example.com/b1s/v1',
      sapCompanyDb: 'SBODemo',
      sapUsername: 'manager',
      sapPassword: 'secret',
    })

    rawFetch = vi.fn(async () => ({
      headers: new Headers({
        'set-cookie': 'B1SESSION=session-1; Path=/b1s/v1; HttpOnly, ROUTEID=.node1; Path=/b1s/v1',
      }),
    }))
    normalFetch = vi.fn(async () => ({ ItemCode: 'LSSMFR10IG20C' }))
    normalFetch.raw = rawFetch
    globalThis.$fetch = normalFetch

    sapModule = await import('../../server/utils/sapServiceLayer')
    sapModule.resetSapServiceLayerSession()
  })

  it('reuses the cached SAP session across requests', async () => {
    const sap = sapModule.useSapServiceLayer()

    await sap.get('Items(\'LSSMFR10IG20C\')')
    await sap.get('Items(\'LSSMFR10IG20C\')')

    expect(rawFetch).toHaveBeenCalledTimes(1)
    expect(normalFetch).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight login across concurrent requests', async () => {
    let resolveLogin: (value: unknown) => void = () => {}
    rawFetch.mockImplementationOnce(() => new Promise(resolve => {
      resolveLogin = resolve
    }))

    const sap = sapModule.useSapServiceLayer()
    const firstRequest = sap.get('Items(\'LSSMFR10IG20C\')')
    const secondRequest = sap.get('Items(\'LSSMFR10IG20R\')')

    resolveLogin({
      headers: new Headers({
        'set-cookie': 'B1SESSION=session-1; Path=/b1s/v1; HttpOnly',
      }),
    })

    await Promise.all([firstRequest, secondRequest])

    expect(rawFetch).toHaveBeenCalledTimes(1)
    expect(normalFetch).toHaveBeenCalledTimes(2)
  })

  it('re-logins and retries once after a 401 response', async () => {
    normalFetch
      .mockRejectedValueOnce({ response: { status: 401 }, message: 'Unauthorized' })
      .mockResolvedValueOnce({ ItemCode: 'LSSMFR10IG20C' })

    const sap = sapModule.useSapServiceLayer()
    const item = await sap.get<{ ItemCode: string }>('Items(\'LSSMFR10IG20C\')')

    expect(item.ItemCode).toBe('LSSMFR10IG20C')
    expect(rawFetch).toHaveBeenCalledTimes(2)
    expect(normalFetch).toHaveBeenCalledTimes(2)
  })
})
