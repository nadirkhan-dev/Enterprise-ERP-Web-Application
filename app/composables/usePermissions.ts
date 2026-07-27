import { readPolicyGlobals } from '@directus/sdk'

/**
 * The account-wide flags Directus derives from every policy attached to the user
 * — directly, through their role, and through that role's parents.
 */
export interface PolicyGlobals {
  app_access: boolean
  admin_access: boolean
  enforce_tfa: boolean
}

type RelationshipType = 'customer' | 'supplier'

type BusinessPartnerCreateRights = Record<RelationshipType, boolean>

type AccountManagerCreateDefault = 'self' | 'null'
type AccountManagerUpdateCapability = 'none' | 'clear-to-null' | 'any'
interface AccountManagerCapabilities {
  create: Record<RelationshipType, AccountManagerCreateDefault>
  update: Record<RelationshipType, AccountManagerUpdateCapability>
}

/**
 * What the logged-in user is allowed to create in `business_partners`.
 *
 * Suppliers and customers live in that one collection, told apart by
 * `relationship_type`, and a policy may grant one without the other: CONNECT
 * Internal Sales can create only `relationship_type = customer`. Directus encodes
 * that as a *validation* rule on the create permission — and `/permissions/me`
 * does not report validation, so asking it "can I create a business partner?"
 * answers yes for a customer-only user and lands them on a supplier form that
 * fails on save. `/api/permissions/business-partner-create` resolves the rules
 * server-side, where the service token can actually read them, and answers per
 * relationship type.
 *
 * Cached at module scope: a user's grants only change when an admin edits a
 * policy, which takes effect on their next login anyway, so one fetch per session
 * is enough.
 */
const createRights = ref<BusinessPartnerCreateRights | null>(null)
let inflightLoad: Promise<void> | null = null

// What the user may do with a business partner's account manager, per
// relationship type and action — the create default each form pre-fills and the
// update capability the account-info drawer branches on. Directus reports neither
// (no server-side preset; per-type update field-perms aren't in /permissions/me),
// so both are resolved server-side and cached at module scope like the rights
// above — a user's policies only change on their next login. See
// `/api/permissions/account-manager`.
const accountManagerCapabilities = ref<AccountManagerCapabilities | null>(null)
let inflightCapabilitiesLoad: Promise<void> | null = null

/**
 * Clear the module-scoped permission caches. Logout is an SPA navigation (no page
 * reload), so without this the previous session's create-rights and
 * account-manager capabilities leak into the next login until a manual refresh —
 * e.g. a Sales user's "no supplier create" would stick for an Operations Manager
 * who signs in next. Called from the auth store's logout, alongside its other
 * cache resets.
 */
export function resetPermissions(): void {
  createRights.value = null
  inflightLoad = null
  accountManagerCapabilities.value = null
  inflightCapabilitiesLoad = null
}

export function usePermissions() {
  const directus = useDirectus()

  /** Fetch the create rights once; concurrent callers share the one request. */
  async function loadBusinessPartnerCreateRights(): Promise<void> {
    if (createRights.value) { return }
    if (inflightLoad) { return inflightLoad }

    inflightLoad = tryCatch((async () => {
      const token = await (directus as any).getToken()
      return $fetch<BusinessPartnerCreateRights>('/api/permissions/business-partner-create', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    })()).then(({ data, error }) => {
      inflightLoad = null
      if (error) {
        // Leave the rights null — callers fall back to their "can't" branch, which
        // is the safe direction: offer the request form rather than a create
        // screen the user would be 403'd out of.
        console.error('Could not load business partner create rights:', error.message)
        return
      }
      createRights.value = data
    })

    return inflightLoad
  }

  /**
   * True when the user may create a business partner of this relationship type.
   *
   * False until `loadBusinessPartnerCreateRights()` has resolved, and false if it
   * failed — an unknown answer must not open a create form.
   */
  function canCreateBusinessPartner(relationshipType: RelationshipType): boolean {
    return createRights.value?.[relationshipType] === true
  }

  /** Fetch the account-manager capabilities once; concurrent callers share it. */
  async function loadAccountManagerCapabilities(): Promise<void> {
    if (accountManagerCapabilities.value) { return }
    if (inflightCapabilitiesLoad) { return inflightCapabilitiesLoad }

    inflightCapabilitiesLoad = tryCatch((async () => {
      const token = await (directus as any).getToken()
      return $fetch<AccountManagerCapabilities>('/api/permissions/account-manager', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
    })()).then(({ data, error }) => {
      inflightCapabilitiesLoad = null
      if (error) {
        // Leave null → the getters fall back to their safe answers: 'null' create
        // default (accepted by every tier) and 'none' update capability (no
        // control rather than one Directus would 403 on save).
        console.error('Could not load account-manager capabilities:', error.message)
        return
      }
      accountManagerCapabilities.value = data ?? null
    })

    return inflightCapabilitiesLoad
  }

  /**
   * What the create form should pre-fill the account-manager picker with for this
   * relationship type: 'self' (the creating user) or 'null' (leave empty). Falls
   * back to 'null' — the universally-safe default — until resolved or on failure.
   */
  function getCreateAccountManagerDefault(relationshipType: RelationshipType): AccountManagerCreateDefault {
    return accountManagerCapabilities.value?.create[relationshipType] ?? 'null'
  }

  /**
   * What the caller may do with this partner type's account manager on update:
   * 'none' (no control), 'clear-to-null' (one-way self-unassign), or 'any'
   * (reassign to anyone). Falls back to 'none' until resolved or on failure.
   */
  function getUpdateAccountManagerCapability(relationshipType: RelationshipType): AccountManagerUpdateCapability {
    return accountManagerCapabilities.value?.update[relationshipType] ?? 'none'
  }

  /**
   * The user's policy globals — `enforce_tfa` among them.
   *
   * Read from `/policies/me/globals`, which Directus computes for the caller,
   * rather than by walking `users/me?fields=policies.policy.enforce_tfa`. That
   * walk only works for users who can READ `directus_policies`, and the app's own
   * users cannot: their policy has no grant on it. It therefore returned nothing
   * for them and enforcement quietly evaluated to "not required" — failing open
   * for precisely the users whose policy sets `enforce_tfa`. This endpoint needs
   * no policy grants and also accounts for policies inherited via nested roles.
   *
   * @returns the globals, or null if they could not be determined — callers must
   *          decide what an unknown answer means, and for enforcement that has to
   *          be "assume enforced".
   */
  async function fetchPolicyGlobals(): Promise<PolicyGlobals | null> {
    const { data, error } = await tryCatch(
      (directus as any).request(readPolicyGlobals()),
    )
    if (error) {
      console.error('Could not load policy globals:', error.message)
      return null
    }
    return (data ?? null) as PolicyGlobals | null
  }

  return {
    loadBusinessPartnerCreateRights,
    canCreateBusinessPartner,
    loadAccountManagerCapabilities,
    getCreateAccountManagerDefault,
    getUpdateAccountManagerCapability,
    fetchPolicyGlobals,
  }
}
