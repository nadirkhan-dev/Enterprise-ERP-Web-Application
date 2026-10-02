

import { AuthError, requireAuthenticatedUser } from '../../utils/auth'
import { PermissionLookupError, resolveDeleteRights } from '../../utils/businessPartnerPermissions'

export default defineEventHandler(async (event) => {
  try {
    const user = await requireAuthenticatedUser(event)
    return await resolveDeleteRights(user)
  } catch (error) {
    if (error instanceof AuthError || error instanceof PermissionLookupError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    console.error('Delete rights lookup failed:', error)
    throw createError({ statusCode: 502, statusMessage: 'Could not resolve delete permissions.' })
  }
})
