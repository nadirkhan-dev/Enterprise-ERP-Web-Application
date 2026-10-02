import { SquareApiError, searchCustomersByReferenceId } from '../../utils/square'
import type { SquareCard, SquareCustomer } from '../../utils/square'

export interface CustomerCardRow {
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

function formatCardLabel(card: SquareCard): string {
  const brand = (card.card_brand || 'CARD').toUpperCase()
  const last4 = card.last_4 || '••••'
  return `${brand} •••• ${last4}`
}

function formatExpiry(card: SquareCard): string {
  if (!card.exp_month || !card.exp_year) {return ''}
  const month = String(card.exp_month).padStart(2, '0')
  const year = String(card.exp_year).slice(-2)
  return `${month}/${year}`
}

function buildContactName(customer: SquareCustomer): string {
  return [customer.given_name, customer.family_name].filter(Boolean).join(' ').trim()
}

function flattenCustomerCards(customers: SquareCustomer[]): CustomerCardRow[] {
  const rows: CustomerCardRow[] = []
  for (const customer of customers) {
    const cards = customer.cards || []
    const contactName = buildContactName(customer)
    for (const card of cards) {
      rows.push({
        id: card.id,
        card: formatCardLabel(card),
        status: 'active',
        cardholder: card.cardholder_name || contactName || '—',
        expires: formatExpiry(card),
        brand: (card.card_brand || '').toUpperCase(),
        last4: card.last_4 || '',
        squareCustomerId: customer.id,
        contactName: contactName || '—',
        contactEmail: customer.email_address || null,
        contactCompany: customer.company_name || null,
      })
    }
  }
  return rows
}

export default defineEventHandler(async (event) => {
  const { referenceId } = getQuery(event)

  if (!referenceId || typeof referenceId !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'referenceId query parameter is required',
    })
  }

  try {
    const customers = await searchCustomersByReferenceId(referenceId)
    return flattenCustomerCards(customers)
  } catch (squareError) {
    if (squareError instanceof SquareApiError) {
      console.error('Square customer cards lookup failed:', squareError.message, squareError.body)
      throw createError({
        statusCode: 502,
        statusMessage: `Failed to fetch Square cards (${squareError.statusCode})`,
      })
    }
    console.error('Square customer cards lookup failed:', squareError)
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to fetch Square cards',
    })
  }
})
