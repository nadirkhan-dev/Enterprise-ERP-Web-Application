import { readMe } from '@directus/sdk'

/**
 * Whether the signed-in user must enrol in 2FA before they may use the app.
 *
 * Answered from the source of truth on every app load — the user's policies
 * (`enforce_tfa`) and whether they actually hold a TFA secret — rather than from
 * a flag the client set at login. Enforcement that keys off `sessionStorage`
 * evaporates the moment a session is resumed, a tab is opened, or a user is added
 * to an enforcing policy while already signed in; this does not.
 *
 * Consumed by the global auth middleware, which turns a `true` into "back to the
 * sign-in screen and enrol".
 */

// Re-checked at most once a minute: often enough that adding someone to an
// enforcing policy takes hold almost immediately, cheap enough that it doesn't
// cost two requests on every route change.
const REQUIREMENT_TTL_MS = 60 * 1000

let cachedRequirement: { isRequired: boolean, expiresAt: number } | null = null

export function useTfaEnforcement() {
  const directus = useDirectus()
  const { fetchPolicyGlobals } = usePermissions()

  async function isTfaEnrolmentRequired(): Promise<boolean> {
    if (cachedRequirement && cachedRequirement.expiresAt > Date.now()) {
      return cachedRequirement.isRequired
    }

    const isRequired = await resolveRequirement()
    cachedRequirement = { isRequired, expiresAt: Date.now() + REQUIREMENT_TTL_MS }
    return isRequired
  }

  async function resolveRequirement(): Promise<boolean> {
    const policyGlobals = await fetchPolicyGlobals()

    // Fail CLOSED on an unknown answer: 2FA silently becoming optional is the bug
    // this whole path exists to fix.
    const isEnforced = policyGlobals?.enforce_tfa ?? true
    if (!isEnforced) { return false }

    const { data: currentUser, error } = await tryCatch(
      (directus as any).request(readMe({ fields: ['tfa_secret'] })),
    )

    if (error) {
      // We cannot see whether they're already enrolled. Blocking here would strand
      // an ALREADY-ENROLLED user in a loop they can't escape (sent to sign in, only
      // to be sent back), so let them through — and be loud, because the cause is a
      // fixable misconfiguration: the policy needs a self-scoped read rule granting
      // `tfa_secret` on `id = $CURRENT_USER`.
      console.error(
        '2FA enforcement is disabled: cannot read your own tfa_secret. '
        + 'Grant the policy read access to tfa_secret scoped to id = $CURRENT_USER.',
        error.message,
      )
      return false
    }

    return !(currentUser as { tfa_secret?: string | null })?.tfa_secret
  }

  /** Enrolment just completed — stop gating without waiting for the TTL to lapse. */
  function markTfaEnrolled(): void {
    cachedRequirement = { isRequired: false, expiresAt: Date.now() + REQUIREMENT_TTL_MS }
  }

  /** Drop the cached answer (on logout, so the next user is evaluated afresh). */
  function resetTfaEnforcement(): void {
    cachedRequirement = null
  }

  return { isTfaEnrolmentRequired, markTfaEnrolled, resetTfaEnforcement }
}
