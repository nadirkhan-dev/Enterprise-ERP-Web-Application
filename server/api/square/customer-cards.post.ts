import {
  createCustomerCard,
  createSquareCustomer,
  searchCustomersByReferenceId,
  SquareApiError,
} from '../../utils/square'
import type {
  SquareBillingAddress,
  SquareCustomer,
} from '../../utils/square'

interface RequestBody {
  referenceId?: string
  nonce?: string
  cardholderName?: string
  contactEmail?: string | null
  companyName?: string | null
  verificationToken?: string | null
  billingAddress?: SquareBillingAddress | null
}

interface ResponseBody {
  cardId: string
  squareCustomerId: string
  createdNewCustomer: boolean
}

function splitName(fullName: string): { given: string, family: string } {
  const tokens = fullName.trim().split(/\s+/)
  if (tokens.length === 0) {return { given: '', family: '' }}
  if (tokens.length === 1) {return { given: tokens[0], family: '' }}
  return {
    given: tokens.slice(0, -1).join(' '),
    family: tokens[tokens.length - 1],
  }
}

function buildFullName(customer: SquareCustomer): string {
  return [customer.given_name, customer.family_name]
    .filter(Boolean)
    .join(' ')
    .trim()
    .toLowerCase()
}

function findCustomerByName(
  customers: SquareCustomer[],
  cardholderName: string,
): SquareCustomer | null {
  const normalized = cardholderName.trim().toLowerCase()
  if (!normalized) {return null}
  return customers.find(c => buildFullName(c) === normalized) || null
}

export default defineEventHandler(async (event): Promise<ResponseBody> => {
  const body = await readBody<RequestBody>(event)

  if (!body?.referenceId || typeof body.referenceId !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'referenceId is required' })
  }
  if (!body.nonce || typeof body.nonce !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'nonce is required' })
  }
  if (!body.cardholderName || typeof body.cardholderName !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'cardholderName is required' })
  }

  try {
    const existing = await searchCustomersByReferenceId(body.referenceId)
    let targetCustomer = findCustomerByName(existing, body.cardholderName)
    const createdNewCustomer = !targetCustomer

    if (!targetCustomer) {
      const { given, family } = splitName(body.cardholderName)
      targetCustomer = await createSquareCustomer({
        referenceId: body.referenceId,
        givenName: given,
        familyName: family,
        emailAddress: body.contactEmail || undefined,
        companyName: body.companyName || undefined,
      })
    }

    const card = await createCustomerCard({
      sourceId: body.nonce,
      customerId: targetCustomer.id,
      cardholderName: body.cardholderName,
      billingAddress: body.billingAddress || undefined,
      verificationToken: body.verificationToken || undefined,
    })

    return {
      cardId: card.id,
      squareCustomerId: targetCustomer.id,
      createdNewCustomer,
    }
  } catch (squareError) {
    if (squareError instanceof SquareApiError) {
      console.error(
        'Square card create failed:',
        squareError.message,
        JSON.stringify(squareError.body, null, 2),
      )
      const errors = (squareError.body as any)?.errors
      const statusMessage = Array.isArray(errors) && errors.length > 0
        ? errors
            .map((squareErr: any) => {
              const parts = [squareErr.detail || squareErr.code]
              if (squareErr.field) {parts.push(`(field: ${squareErr.field})`)}
              if (squareErr.code && squareErr.code !== squareErr.detail) {parts.push(`[${squareErr.code}]`)}
              return parts.filter(Boolean).join(' ')
            })
            .join(' • ')
        : `Square API error (${squareError.statusCode})`
      throw createError({
        statusCode: 502,
        statusMessage,
        data: { squareErrors: errors },
      })
    }
    console.error('Square card create failed:', squareError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to save card to Square' })
  }
})
