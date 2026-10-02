describe('Scenario: Special-SKU reference data from SupplyHub', () => {
  beforeEach(() => {
    vi.resetModules()

    globalThis.defineEventHandler = (handler: unknown) => handler
    globalThis.createError = (options: { statusCode: number, statusMessage: string }) => {
      const error = new Error(options.statusMessage)
      Object.assign(error, options)
      return error
    }
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  /**
   * Stand in for Directus. Routes `/items/manufacturers` and `/items/item_groups`
   * to the supplied rows; anything else is an unexpected call.
   */
  function mockDirectus(collections: {
    manufacturers?: Array<Record<string, unknown>>
    item_groups?: Array<Record<string, unknown>>
  }) {
    return vi.fn(async (url: string) => {
      const { pathname } = new URL(url)
      if (pathname === '/items/manufacturers') {
        return jsonResponse(collections.manufacturers ?? [])
      }
      if (pathname === '/items/item_groups') {
        return jsonResponse(collections.item_groups ?? [])
      }
      throw new Error(`Unexpected Directus call: ${url}`)
    })
  }

  function jsonResponse(data: unknown) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data }),
    } as unknown as Response
  }

  async function callEndpoint() {
    const endpoint = (await import('../../server/api/special-sku/reference-data.get'))
      .default as () => Promise<any>
    return endpoint()
  }

  it('reads both lists from Directus and maps sap_id to the option value', async () => {
    globalThis.fetch = mockDirectus({
      manufacturers: [{ name: 'Carrier', sap_id: 5 }],
      item_groups: [{ name: 'Furnaces', sap_id: 10, sort: 1 }],
    })

    const result = await callEndpoint()

    // value === sapId === the row's sap_id, so SKU generation still submits SAP ids.
    expect(result.manufacturers).toEqual([{ label: 'Carrier', value: 5, sapId: 5 }])
    expect(result.itemGroups).toEqual([{ label: 'Furnaces', value: 10, sapId: 10 }])
  })

  it('orders item groups by SupplyHub sort, unranked ones last, name as the tiebreak', async () => {
    globalThis.fetch = mockDirectus({
      item_groups: [
        { name: 'Zulu', sap_id: 1, sort: 2 },
        { name: 'Alpha', sap_id: 2, sort: null }, // unranked → sinks to end
        { name: 'Bravo', sap_id: 3, sort: 1 },
        { name: 'Yankee', sap_id: 4, sort: null }, // unranked → after Alpha by name
      ],
    })

    const result = await callEndpoint()

    expect(result.itemGroups.map((option: any) => option.label)).toEqual([
      'Bravo', // sort 1
      'Zulu', // sort 2
      'Alpha', // sort null, name A…
      'Yankee', // sort null, name Y…
    ])
  })

  it('orders manufacturers alphabetically by name (the collection has no sort)', async () => {
    globalThis.fetch = mockDirectus({
      manufacturers: [
        { name: 'Trane', sap_id: 1 },
        { name: 'Amana', sap_id: 2 },
        { name: 'Lennox', sap_id: 3 },
      ],
    })

    const result = await callEndpoint()

    expect(result.manufacturers.map((option: any) => option.label)).toEqual([
      'Amana',
      'Lennox',
      'Trane',
    ])
  })

  it('drops rows missing a name or a sap_id (unusable in the picker)', async () => {
    globalThis.fetch = mockDirectus({
      manufacturers: [
        { name: 'Valid', sap_id: 1 },
        { name: null, sap_id: 2 }, // no name
        { name: 'No SAP', sap_id: null }, // no sap_id
      ],
      item_groups: [
        { name: 'Keep', sap_id: 9, sort: 1 },
        { name: '', sap_id: 8, sort: 2 }, // empty name
      ],
    })

    const result = await callEndpoint()

    expect(result.manufacturers).toEqual([{ label: 'Valid', value: 1, sapId: 1 }])
    expect(result.itemGroups).toEqual([{ label: 'Keep', value: 9, sapId: 9 }])
  })

  it('raises a 502 when a Directus collection lookup fails', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response))

    await expect(callEndpoint()).rejects.toMatchObject({ statusCode: 502 })
  })
})
