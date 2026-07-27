import type { TryCatchResult } from '~/types/api'
import { useDirectus } from '~/composables/useDirectus'

export interface ShippingEstimate {
  carrier: 'FedEx' | 'UPS'
  serviceCode: string
  method: string
  cost: number
  currency: string
  transitDays: number | null
}

export interface ShippingEstimateResponse {
  estimates: ShippingEstimate[]
  warnings: string[]
}

export interface PostalLookupResult {
  postalCode: string
  countryCode: string
  stateCode: string | null
  city: string | null
  classification: string | null
  serviceAvailable: boolean
}

export interface ShippingEstimateRequest {
  shippingCategory: 'parcel' | 'LTL'
  // Origin: pass `warehouseId` to rate from a warehouse (server resolves its
  // address), OR pass an explicit `origin` address to rate from a supplier /
  // ad-hoc ship-from address. `origin` wins when both are present.
  warehouseId?: number | null
  origin?: {
    postalCode: string
    countryCode: string
    stateCode?: string
    city?: string
    streetLine1?: string
    streetLine2?: string
  }
  weightLb: number | null
  lengthIn: number | null
  widthIn: number | null
  heightIn: number | null
  destination: {
    postalCode: string
    countryCode: string
    stateCode?: string
    city?: string
  }
  options?: {
    accessorials?: string[]
  }
}

/**
 * Fetches FedEx and (for parcel) UPS rate quotes for an item via the
 * server endpoint at `/api/shipping/estimate`.
 *
 * For `LTL` shippingCategory only FedEx Freight is queried; for `parcel`
 * both carriers are queried in parallel server-side.
 */
async function buildAuthHeaders(): Promise<Record<string, string>> {
  const directus = useDirectus()
  const token = await directus.getToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export function useShippingEstimates() {
  async function fetchEstimates(
    request: ShippingEstimateRequest,
  ): Promise<TryCatchResult<ShippingEstimateResponse>> {
    const headers = await buildAuthHeaders()
    return tryCatch(
      $fetch<ShippingEstimateResponse>('/api/shipping/estimate', {
        method: 'POST',
        headers,
        body: request,
      }),
    ) as Promise<TryCatchResult<ShippingEstimateResponse>>
  }

  async function lookupPostalCode(
    postalCode: string,
    countryCode: string,
  ): Promise<TryCatchResult<PostalLookupResult>> {
    const headers = await buildAuthHeaders()
    return tryCatch(
      $fetch<PostalLookupResult>('/api/shipping/lookup-postal', {
        method: 'POST',
        headers,
        body: { postalCode, countryCode },
      }),
    ) as Promise<TryCatchResult<PostalLookupResult>>
  }

  return { fetchEstimates, lookupPostalCode }
}
