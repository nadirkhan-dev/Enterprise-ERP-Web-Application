import {
  useDirectus,
  getStoredAuthExpiry,
  hasStoredSession,
  resolveAuthPersistence,
  setAuthFailureHandler,
} from '~/composables/useDirectus'
import { useAuthStore } from '~/stores/auth'
import { PUBLIC_ROUTES, LOGIN_ROUTE } from '~/config/routes'

/**
 * The three ways a recovery attempt can land:
 *  - recovered:   the session is live again (we refreshed it, or another tab
 *                 already had) — a failed request is worth retrying.
 *  - dead:        the server rejected the refresh token — the session is over.
 *  - unreachable: the refresh never got an answer (offline, server down). Says
 *                 nothing about the session, so it must NOT end it — the timer
 *                 retries on a short cadence instead.
 */
type SessionRecovery = 'recovered' | 'dead' | 'unreachable'

// Web Locks name serializing `/auth/refresh` across tabs. Directus rotates the
// refresh token on every use, so two tabs refreshing in parallel means one of
// them presents an already-spent token and loses a session the other just
// renewed.
const REFRESH_LOCK_NAME = 'connect-session-refresh'

let isEndingSession = false
let inflightRecovery: Promise<SessionRecovery> | null = null
let isWatching = false
let expiryTimerId: ReturnType<typeof setTimeout> | null = null

// Margin after the stored expiry before the timer's check runs, so the verdict
// lands just past the boundary instead of racing it.
const EXPIRY_CHECK_DELAY_MS = 1000

// Retry cadence while the server is unreachable at the expiry boundary — keep
// the session and keep asking, rather than tearing it down over a network blip.
const EXPIRY_RETRY_DELAY_MS = 30000

/** Whether the stored session's access token is still ahead of the clock. */
function isStoredSessionLive(): boolean {
  const expiresAt = getStoredAuthExpiry()
  return expiresAt !== null && expiresAt > Date.now()
}

/**
 * A refresh the server actually REJECTED (4xx) — the token is spent or invalid
 * and the session is over. Anything else (network failure, 5xx) is a statement
 * about reachability, not about the session.
 */
function isRefreshRejection(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  return status !== undefined && status >= 400 && status < 500
}

async function attemptRecovery(hasTokenBeenRejected: boolean): Promise<SessionRecovery> {
  // Timer/visibility callers arrive on the clock's word alone — for them a
  // future-dated expiry means another tab already renewed, and there's nothing
  // to do (and no refresh token spent). A caller whose token was actually
  // REJECTED can't take that shortcut: a revoked-but-unexpired session reads as
  // live here forever, so it has to prove itself with a real refresh.
  if (!hasTokenBeenRejected && isStoredSessionLive()) {
    return 'recovered'
  }
  // No refresh token on disk (remember-me unchecked): nothing to trade, and no
  // point spending a network call to hear so.
  if (!resolveAuthPersistence()) {
    return 'dead'
  }

  const expiryBeforeRefresh = getStoredAuthExpiry()
  const { error: refreshError } = await tryCatch(useDirectus().refresh())
  if (!refreshError) {
    return 'recovered'
  }
  // A renewal that landed during our failed attempt — another tab won a race
  // the lock couldn't see (its SDK's own auto-refresh, or a no-Locks browser).
  // Only a CHANGED, future-dated expiry counts: an unchanged one is the same
  // stale claim the failure just disproved.
  const expiryAfterRefresh = getStoredAuthExpiry()
  if (
    expiryAfterRefresh !== null
    && expiryAfterRefresh !== expiryBeforeRefresh
    && expiryAfterRefresh > Date.now()
  ) {
    return 'recovered'
  }
  return isRefreshRejection(refreshError) ? 'dead' : 'unreachable'
}

/**
 * One recovery attempt shared by every caller. A burst of parallel 401s must not
 * become a burst of parallel `/auth/refresh` calls — Directus rotates the refresh
 * token, so the second would be rejected and take down a session the first had
 * just renewed. In-tab bursts share `inflightRecovery`; cross-tab ones are
 * serialized by the Web Lock (each tab re-reads storage once it holds the lock,
 * so the second tab finds the renewed session instead of refreshing again).
 */
async function recoverSession(hasTokenBeenRejected: boolean = false): Promise<SessionRecovery> {
  // Joining an in-flight attempt adopts its verdict (and its flag). A rejected
  // caller who inherits a clock-based 'recovered' just retries, fails again, and
  // starts its own forced attempt — one extra round-trip, then it converges.
  if (inflightRecovery) {
    return inflightRecovery
  }

  inflightRecovery = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(REFRESH_LOCK_NAME, () => attemptRecovery(hasTokenBeenRejected))
    }
    return await attemptRecovery(hasTokenBeenRejected)
  })()

  try {
    return await inflightRecovery
  } finally {
    inflightRecovery = null
  }
}

function stopSessionWatch(): void {
  if (typeof window === 'undefined' || !isWatching) {
    return
  }

  isWatching = false
  clearExpiryTimer()
  document.removeEventListener('visibilitychange', handleVisibilityChange)
}

function clearExpiryTimer(): void {
  if (expiryTimerId !== null) {
    clearTimeout(expiryTimerId)
    expiryTimerId = null
  }
}

/**
 * Sleep until the stored token's expiry, then decide. This is what catches a
 * focused-but-idle tab — the navigation and visibility checks both need the
 * user to do something, so without it an expiry only surfaced at the next
 * click. A token renewed in the meantime (a request refreshed it) just
 * reschedules for the new deadline; a genuinely expired one goes through the
 * same check as navigation/return — one recovery attempt, then sign-out.
 * Background tabs may throttle the timer; the visibility check covers those on
 * return.
 */
function scheduleExpiryCheck(): void {
  clearExpiryTimer()
  if (!isWatching) {
    return
  }

  const expiresAt = getStoredAuthExpiry()
  // No stored session, or one the SDK never dated (mid-refresh / set by hand) —
  // nothing to schedule against.
  if (expiresAt === null) {
    return
  }

  // A live token sleeps until its expiry. A past-dated one here means recovery
  // already ran and the server was unreachable — hold the session and retry on
  // the short cadence instead.
  const delay = expiresAt > Date.now()
    ? expiresAt - Date.now() + EXPIRY_CHECK_DELAY_MS
    : EXPIRY_RETRY_DELAY_MS
  expiryTimerId = setTimeout(() => { void handleExpiryTimer() }, delay)
}

async function handleExpiryTimer(): Promise<void> {
  expiryTimerId = null
  const expiresAt = getStoredAuthExpiry()
  // Renewed since scheduling — nothing to verify, just track the new deadline.
  if (expiresAt !== null && expiresAt > Date.now()) {
    scheduleExpiryCheck()
    return
  }

  await checkStoredSession()
  // No-op once the watch stopped (an ended session cleared it in stop).
  scheduleExpiryCheck()
}

/**
 * Is the stored session past saving?
 *
 * Answered locally wherever possible — a wiped session and a still-valid expiry
 * both resolve without a request — and only spends a network call once the token
 * has actually run out, to try trading the refresh token for a fresh one.
 *
 * Safe to await on every navigation for that reason.
 */
async function hasSessionEnded(): Promise<boolean> {
  // Nothing in storage: wiped from outside the SDK, so there's nothing to renew.
  if (!hasStoredSession()) {
    return true
  }

  const expiresAt = getStoredAuthExpiry()
  // Present but undated — the SDK is mid-refresh, or a token was set by hand.
  // Not a verdict; leave it be.
  if (expiresAt === null || expiresAt > Date.now()) {
    return false
  }

  // Only a rejected refresh ends the session — an unreachable server leaves it
  // standing (the expiry timer retries on its own cadence).
  return (await recoverSession()) === 'dead'
}

/**
 * Tear the session down and say where to send the user. Callers do their own
 * routing — the middleware must `return navigateTo(...)` to stay in step with the
 * navigation it's already inside, while the request guard and the watchdog have no
 * navigation of their own to hand it back to.
 *
 * @param returnPath — where signing back in should land. Null for a page not worth
 *   returning to (login and the password flows).
 */
async function handleSessionEnd(returnPath: string | null = null): Promise<string> {
  isEndingSession = true
  stopSessionWatch()
  if (returnPath) {
    sessionStorage.setItem('auth:redirect', returnPath)
  }
  await useAuthStore().logout(false)
  return `${LOGIN_ROUTE}?expired=1`
}

/** End the session from outside a navigation, routing to login as we go. */
async function handleSessionExpired(): Promise<void> {
  if (isEndingSession) {
    return
  }

  const currentRoute = useRouter().currentRoute.value
  // Already on login (or a password flow) — no session to end, and no page worth
  // coming back to.
  if (PUBLIC_ROUTES.includes(currentRoute.path)) {
    return
  }

  await navigateTo(await handleSessionEnd(currentRoute.fullPath))
}

/** Answers the `useDirectus` auth guard: true when the request is worth retrying. */
export async function handleAuthFailure(): Promise<boolean> {
  // Mid-bootstrap, `checkAuth()` owns the refresh-and-retry and the middleware
  // owns the redirect — a second refresh from here would race both.
  if (!useAuthStore().authReady || isEndingSession) {
    return false
  }

  // A wiped session has no refresh token to spend, so don't bother asking.
  if (!hasStoredSession()) {
    await handleSessionExpired()
    return false
  }

  // The guard only calls this after Directus rejected the request's token, so
  // recovery must prove the session with a refresh — not trust the stored clock.
  const recovery = await recoverSession(true)
  if (recovery === 'recovered') {
    return true
  }
  if (recovery === 'dead') {
    await handleSessionExpired()
  }
  // Unreachable: hand the original error back and leave the session standing —
  // the failure is about the network, not the token.
  return false
}

async function checkStoredSession(): Promise<void> {
  const authStore = useAuthStore()
  if (!authStore.authReady || !authStore.isAuthenticated || isEndingSession) {
    return
  }

  if (await hasSessionEnded()) {
    await handleSessionExpired()
  }
}

function handleVisibilityChange(): void {
  if (document.visibilityState === 'visible') {
    void checkStoredSession()
  }
}

function startSessionWatch(): void {
  if (typeof window === 'undefined' || isWatching) {
    return
  }

  // A fresh session gets a fresh verdict — the previous one may have ended here.
  isEndingSession = false
  isWatching = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
  scheduleExpiryCheck()
}

/**
 * Hand the 401 guard its verdict function. Armed for the whole life of the tab,
 * not just while signed in, so no request can fail unexamined.
 */
function registerAuthFailureHandler(): void {
  setAuthFailureHandler(handleAuthFailure)
}

export function useSessionExpiry() {
  return {
    registerAuthFailureHandler,
    startSessionWatch,
    stopSessionWatch,
    hasSessionEnded,
    handleSessionEnd,
    handleSessionExpired,
  }
}
