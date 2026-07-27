import type { TryCatchResult } from '~/types/api'

export interface SpecialSkuRequest {
  manufacturerSapId: number
  manufacturerName: string
  itemGroupSapId: number
  itemGroupName: string
  itemType: 'complete' | 'repair'
}

export interface SpecialSkuResponse {
  itemCode: string
  created: boolean
  data: Record<string, unknown> | null
}

interface UseSapSpecialSkuReturn {
  generateSpecialSku: (payload: SpecialSkuRequest) => Promise<TryCatchResult<SpecialSkuResponse>>
}

export function useSapSpecialSku(): UseSapSpecialSkuReturn {
  async function generateSpecialSku(payload: SpecialSkuRequest): Promise<TryCatchResult<SpecialSkuResponse>> {
    return await tryCatch($fetch<SpecialSkuResponse>('/api/sap/special-sku', {
      method: 'POST',
      body: payload,
    }))
  }

  return { generateSpecialSku }
}
