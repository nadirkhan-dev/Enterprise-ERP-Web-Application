import { FedexApiError, validateFedexPostalCode } from '../../utils/fedex'
import { validatePostalCode } from '../../utils/shippingValidation'
import { AuthError, requireAuthenticatedUser } from '../../utils/auth'
import { enforceRateLimit, RateLimitError } from '../../utils/rateLimit'

interface PostalLookupRequestBody {
  postalCode?: string
  countryCode?: string
}

export interface PostalLookupResponse {
  postalCode: string
  countryCode: string
  stateCode: string | null
  city: string | null
  classification: string | null
  serviceAvailable: boolean
}

const COUNTRY_CODE_MAP: Record<string, string> = {
  'US': 'US',
  'USA': 'US',
  'UNITED STATES (US)': 'US',
  'UNITED STATES': 'US',
  'CA': 'CA',
  'CAN': 'CA',
  'CANADA': 'CA',
  'MX': 'MX',
  'MEX': 'MX',
  'MEXICO': 'MX',
}

function normalizeCountry(value: unknown): string {
  const upper = String(value ?? '').trim().toUpperCase()
  return COUNTRY_CODE_MAP[upper] || (upper.length === 2 ? upper : 'US')
}

// Postal lookups fire on every input blur; a generous per-minute budget
// is fine for normal users and still blocks abusive scripting.
const RATE_LIMIT_REQUESTS = 60
const RATE_LIMIT_WINDOW_MS = 60 * 1000

export default defineEventHandler(async (event): Promise<PostalLookupResponse> => {
  let user
  try {
    user = await requireAuthenticatedUser(event)
  } catch (error) {
    if (error instanceof AuthError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }

  try {
    await enforceRateLimit({
      key: `shipping:lookup-postal:${user.id}`,
      limit: RATE_LIMIT_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
  } catch (error) {
    if (error instanceof RateLimitError) {
      setResponseHeader(event, 'Retry-After', Number(error.retryAfterSeconds))
      throw createError({ statusCode: 429, statusMessage: error.message })
    }
    throw error
  }

  const body = await readBody<PostalLookupRequestBody>(event)

  const postalCode = String(body?.postalCode ?? '').trim()
  if (!postalCode) {
    throw createError({ statusCode: 400, statusMessage: 'postalCode is required' })
  }

  const countryCode = normalizeCountry(body?.countryCode)

  const postalError = validatePostalCode({ postalCode, countryCode })
  if (postalError) {
    throw createError({ statusCode: 400, statusMessage: postalError })
  }

  try {
    const info = await validateFedexPostalCode(postalCode, countryCode)
    return {
      postalCode: info.postalCode,
      countryCode: info.countryCode,
      stateCode: info.stateOrProvinceCode,
      city: info.city,
      classification: info.classification,
      serviceAvailable: true,
    }
  } catch (error) {
    if (error instanceof FedexApiError) {
      console.error('[lookup-postal] FedEx error:', error.statusCode, error.message, error.details)

      // 5xx from FedEx = their service is down. Return an inconclusive result
      // so the UI can skip showing an error message.
      if (error.statusCode >= 500) {
        return {
          postalCode,
          countryCode,
          stateCode: null,
          city: null,
          classification: null,
          serviceAvailable: false,
        }
      }

      throw createError({
        statusCode: 400,
        statusMessage: 'Postal code not recognized for the selected country.',
        data: { fedex: error.message, fedexDetails: error.details },
      })
    }
    throw error
  }
})
