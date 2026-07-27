/**
 * What the caller may create in `business_partners`, per relationship type:
 *
 *   { "customer": true, "supplier": false }
 *
 * The UI branches on this — the Suppliers list opens the create form for people
 * who may create a supplier and the "request one from the operations team" form
 * for everyone else. It cannot be worked out in the browser: `/permissions/me`
 * omits the `validation` rule that separates a supplier grant from a customer
 * one. See `server/utils/businessPartnerPermissions.ts`.
 *
 * This route only *reports* rights; Directus still enforces them on the write.
 */

import { AuthError, requireAuthenticatedUser } from '../../utils/auth'
import { PermissionLookupError, resolveBusinessPartnerCreateRights } from '../../utils/businessPartnerPermissions'

export default defineEventHandler(async (event) => {
  try {
    const user = await requireAuthenticatedUser(event)
    return await resolveBusinessPartnerCreateRights(user)
  } catch (error) {
    if (error instanceof AuthError || error instanceof PermissionLookupError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    console.error('Business partner create-rights lookup failed:', error)
    throw createError({ statusCode: 502, statusMessage: 'Could not resolve create permissions.' })
  }
})
