// @ts-nocheck

import { useSapSpecialSku, type SpecialSkuRequest } from '../../app/composables/useSapSpecialSku'

describe('Scenario: Special SKU client composable', () => {
  const payload: SpecialSkuRequest = {
    manufacturerSapId: 10,
    manufacturerName: 'Acme',
    itemGroupSapId: 20,
    itemGroupName: 'Valves',
    itemType: 'complete',
  }

  beforeEach(() => {
    globalThis.$fetch = vi.fn()
    globalThis.tryCatch = async <T>(operation: Promise<T>) => {
      try {
        return { data: await operation, error: null }
      } catch (error) {
        return { data: null, error: error as Error }
      }
    }
  })

  it('posts the normalized request payload to the SAP Special SKU endpoint', async () => {
    vi.mocked(globalThis.$fetch).mockResolvedValue({
      itemCode: 'LSSMFR10IG20C',
      created: true,
      data: {
        ItemCode: 'LSSMFR10IG20C',
        ItemName: 'EDIT ACME VALVES COMPLETE ITEM DESCRIPTION',
        ItemsGroupCode: 20,
        Manufacturer: 10,
        Properties1: 'tNO',
        ShipType: 1,
      },
    })

    const { generateSpecialSku } = useSapSpecialSku()
    const result = await generateSpecialSku(payload)

    expect(globalThis.$fetch).toHaveBeenCalledWith('/api/sap/special-sku', {
      method: 'POST',
      body: payload,
    })
    expect(result.error).toBeNull()
    expect(result.data?.itemCode).toBe('LSSMFR10IG20C')
  })

  it('returns a normalized error when the endpoint rejects', async () => {
    vi.mocked(globalThis.$fetch).mockRejectedValue(new Error('SAP unavailable'))

    const { generateSpecialSku } = useSapSpecialSku()
    const result = await generateSpecialSku(payload)

    expect(result.data).toBeNull()
    expect(result.error?.message).toBe('SAP unavailable')
  })
})
