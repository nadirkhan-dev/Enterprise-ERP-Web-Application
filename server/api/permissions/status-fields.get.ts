/**
 * Which status / inactive-note / remarks fields the caller may write, per entity
 * CONNECT shows a control for:
 *
 *   {
 *     "business_partners": {
 *       "customer": { "status": true,  "inactiveNote": false, "remarks": true },
 *       "supplier": { "status": false, "inactiveNote": false, "remarks": false }
 *     },
 *     "business_partners_contacts": { "status": true, "inactiveNote": true, "remarks": true },
 *     …
 *   }
 *
 * The drawers disable each control on its own right — status, inactive note and
 * remarks are independent grants — so a user is not handed a field Directus will
 * refuse on save. It cannot be worked out in the browser: `/permissions/me`
 * reports a grant's fields per collection, with no way to tell a customer-scoped
 * update row from a supplier-scoped one.
 * See `server/utils/businessPartnerPermissions.ts`.
 *
 * This route only *reports* rights; Directus still enforces them on the write.
 */

import { AuthError, requireAuthenticatedUser } from '../../utils/auth'
import { PermissionLookupError, resolveStatusFieldRights } from '../../utils/businessPartnerPermissions'

export default defineEventHandler(async (event) => {
  try {
    const user = await requireAuthenticatedUser(event)
    return await resolveStatusFieldRights(user)
  } catch (error) {
    if (error instanceof AuthError || error instanceof PermissionLookupError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    console.error('Status field rights lookup failed:', error)
    throw createError({ statusCode: 502, statusMessage: 'Could not resolve status field permissions.' })
  }
})
