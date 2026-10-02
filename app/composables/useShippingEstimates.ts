import type { TryCatchResult } from '~/types/api'
import { useDirectus } from '~/composables/useDirectus'

export interface ShippingEstimate {
  // The HAULING carrier's canonical name from SupplyHub — never the broker.
  // Priority1 is a rate source and is reported separately as `providerCode`.
  carrier: string
  serviceCode: string
  // The canonical method name from SupplyHub, not the provider's own wording.
  method: string
  cost: number
  currency: string
  transitDays: number | null
  /** Which integration produced the rate: 'priority1', 'fedex', 'ups'. */
  providerCode: string
  /** Canonical speed from the matched method — 'priority_ltl', 'ground', … */
  speedCode: string | null
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
 * Fetches carrier rate quotes for an item via the server endpoint at
 * `/api/shipping/estimate`.
 *
 * `LTL` queries Priority1 alone — a broker, so one call returns a quote per
 * underlying hauler at Liberty's negotiated rates, FedEx Freight among them.
 * `parcel` queries FedEx and UPS in parallel, and one failing only adds a
 * warning rather than losing the other's quotes.
 *
 * Every quote is matched against the carrier services SupplyHub says Liberty
 * sells; anything else is dropped server-side and never reaches here.
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
