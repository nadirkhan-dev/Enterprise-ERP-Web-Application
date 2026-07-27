import type { TryCatchResult } from '~/types/api'

export interface SquareCustomerCard {
  id: string
  card: string
  status: 'active'
  cardholder: string
  expires: string
  brand: string
  last4: string
  squareCustomerId: string
  contactName: string
  contactEmail: string | null
  contactCompany: string | null
}

export interface SquareBillingAddressPayload {
  address_line_1?: string
  address_line_2?: string
  locality?: string
  administrative_district_level_1?: string
  postal_code?: string
  country?: string
}

export interface CreateSquareCardInput {
  referenceId: string
  nonce: string
  cardholderName: string
  contactEmail?: string | null
  companyName?: string | null
  verificationToken?: string | null
  billingAddress?: SquareBillingAddressPayload | null
}

export interface CreateSquareCardResult {
  cardId: string
  squareCustomerId: string
  createdNewCustomer: boolean
}

interface UseSquareReturn {
  fetchCustomerCards: (referenceId: string) => Promise<TryCatchResult<SquareCustomerCard[]>>
  createCustomerCard: (input: CreateSquareCardInput) => Promise<TryCatchResult<CreateSquareCardResult>>
}

/**
 * Composable for Square-backed reads and writes.
 *
 * Proxies a Nuxt server endpoint under `/api/square/*` so the Square access token
 * stays server-side. Returns the normalized `{ data, error }` shape via `tryCatch`.
 */
export function useSquare(): UseSquareReturn {
  return {
    fetchCustomerCards: referenceId =>
      tryCatch(
        $fetch<SquareCustomerCard[]>('/api/square/customer-cards', {
          query: { referenceId },
        }),
      ) as Promise<TryCatchResult<SquareCustomerCard[]>>,
    createCustomerCard: input =>
      tryCatch(
        $fetch<CreateSquareCardResult>('/api/square/customer-cards', {
          method: 'POST',
          body: input,
        }),
      ) as Promise<TryCatchResult<CreateSquareCardResult>>,
  }
}
