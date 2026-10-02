/**
 * What the caller may do with a business partner's account manager, per
 * relationship type and per action:
 *
 *   {
 *     "create": { "customer": "self", "supplier": "null" },
 *     "update": { "customer": "any",  "supplier": "none" }
 *   }
 *
 * Directus keeps no server-side preset for account_manager_id, so the app owns
 * the create default, and the account-info drawer branches on the update
 * capability. Neither can be read in the browser — the create validation and the
 * per-type update field-permissions are not reported by /permissions/me — so both
 * are resolved here with the service token. See
 * `server/utils/businessPartnerPermissions.ts`.
 *
 * This route only *reports* the capability; Directus still enforces the write.
 */

import { AuthError, requireAuthenticatedUser } from '../../utils/auth'
import { PermissionLookupError, resolveAccountManagerCapabilities } from '../../utils/businessPartnerPermissions'

export default defineEventHandler(async (event) => {
  try {
    const user = await requireAuthenticatedUser(event)
    return await resolveAccountManagerCapabilities(user)
  } catch (error) {
    if (error instanceof AuthError || error instanceof PermissionLookupError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    console.error('Account-manager capability lookup failed:', error)
    throw createError({ statusCode: 502, statusMessage: 'Could not resolve account-manager capabilities.' })
  }
})
