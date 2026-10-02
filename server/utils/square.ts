/**
 * Square API client (server-only).
 *
 * Reads access token + environment from runtime config (`NUXT_SQUARE_ACCESS_TOKEN`,
 * `NUXT_SQUARE_ENV`). Sandbox is the default; set `NUXT_SQUARE_ENV=production`
 * to hit the live Square host.
 *
 * Hosts:
 *   - production → https://connect.squareup.com
 *   - sandbox    → https://connect.squareupsandbox.com
 */

const SQUARE_VERSION = '2024-12-18'

export interface SquareCard {
  id: string
  card_brand?: string
  last_4?: string
  exp_month?: number
  exp_year?: number
  cardholder_name?: string
  billing_address?: Record<string, unknown>
}

export interface SquareCustomer {
  id: string
  reference_id?: string
  given_name?: string
  family_name?: string
  email_address?: string
  company_name?: string
  cards?: SquareCard[]
}

export interface SquareCustomerSearchResponse {
  customers?: SquareCustomer[]
  cursor?: string
}

export class SquareApiError extends Error {
  statusCode: number
  body: unknown

  constructor(message: string, statusCode: number, body: unknown) {
    super(message)
    this.name = 'SquareApiError'
    this.statusCode = statusCode
    this.body = body
  }
}

function getSquareHost(): string {
  const config = useRuntimeConfig()
  const appId = (config.public.squareAppId as string) || ''
  return appId.startsWith('sandbox-')
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com'
}

function getSquareAccessToken(): string {
  const config = useRuntimeConfig()
  const token = config.squareAccessToken
  if (!token) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Square access token is not configured (NUXT_SQUARE_ACCESS_TOKEN)',
    })
  }
  return token
}

async function squareFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${getSquareHost()}${path}`
  const headers = {
    'Square-Version': SQUARE_VERSION,
    'Authorization': `Bearer ${getSquareAccessToken()}`,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  }

  const response = await fetch(url, { ...init, headers })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new SquareApiError(
      `Square API ${response.status} for ${path}`,
      response.status,
      body,
    )
  }

  return body as T
}

/**
 * Search Square customers by exact `reference_id` match.
 * Square may return multiple customer records sharing the same reference_id
 * (treated as separate contacts under one upstream customer).
 */
export async function searchCustomersByReferenceId(
  referenceId: string,
): Promise<SquareCustomer[]> {
  const customers: SquareCustomer[] = []
  let cursor: string | undefined

  do {
    const payload: Record<string, unknown> = {
      query: {
        filter: {
          reference_id: { exact: referenceId },
        },
      },
      limit: 100,
    }
    if (cursor) {
      payload.cursor = cursor
    }

    const result = await squareFetch<SquareCustomerSearchResponse>(
      '/v2/customers/search',
      { method: 'POST', body: JSON.stringify(payload) },
    )

    if (result.customers?.length) {
      customers.push(...result.customers)
    }
    cursor = result.cursor
  } while (cursor)

  return customers
}

export interface CreateSquareCustomerInput {
  referenceId: string
  givenName?: string
  familyName?: string
  emailAddress?: string
  companyName?: string
}

export async function createSquareCustomer(
  input: CreateSquareCustomerInput,
): Promise<SquareCustomer> {
  const payload: Record<string, unknown> = {
    reference_id: input.referenceId,
    idempotency_key: crypto.randomUUID(),
  }
  if (input.givenName) {payload.given_name = input.givenName}
  if (input.familyName) {payload.family_name = input.familyName}
  if (input.emailAddress) {payload.email_address = input.emailAddress}
  if (input.companyName) {payload.company_name = input.companyName}

  const result = await squareFetch<{ customer: SquareCustomer }>(
    '/v2/customers',
    { method: 'POST', body: JSON.stringify(payload) },
  )

  return result.customer
}

export interface SquareBillingAddress {
  address_line_1?: string
  address_line_2?: string
  locality?: string
  administrative_district_level_1?: string
  postal_code?: string
  country?: string
}

export interface CreateCardInput {
  sourceId: string
  customerId: string
  cardholderName: string
  billingAddress?: SquareBillingAddress
  verificationToken?: string
}

/**
 * Save a tokenized card to a Square customer's profile.
 * `sourceId` is the nonce returned by the Web Payments SDK (`tokenize()`).
 */
export async function createCustomerCard(
  input: CreateCardInput,
): Promise<SquareCard> {
  const card: Record<string, unknown> = {
    customer_id: input.customerId,
    cardholder_name: input.cardholderName,
  }
  if (input.billingAddress) {
    card.billing_address = input.billingAddress
  }

  const payload: Record<string, unknown> = {
    idempotency_key: crypto.randomUUID(),
    source_id: input.sourceId,
    card,
  }
  if (input.verificationToken) {
    payload.verification_token = input.verificationToken
  }

  const result = await squareFetch<{ card: SquareCard }>(
    '/v2/cards',
    { method: 'POST', body: JSON.stringify(payload) },
  )

  return result.card
}
