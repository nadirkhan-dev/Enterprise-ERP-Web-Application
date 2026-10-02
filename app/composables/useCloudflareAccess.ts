import { buildLoadingPageHtml } from '~/utils/loadingPage'

/**
 * Cloudflare Access session watch.
 *
 * Every request to Connect passes through Cloudflare Access, whose session is a
 * flat 24 hours from sign-in — it does NOT slide with activity, so an otherwise
 * busy user is cut off mid-click at the 24-hour mark. Access answers an expired
 * request with a redirect to its login page on another origin, which reaches the
 * browser as a bare `TypeError` carrying no status, so without this the failure
 * surfaces as "API request failed" or "Document unavailable" — messages that
 * invite a retry which can never work.
 *
 * The deadline is knowable in advance. The `CF_Authorization` cookie is a JWT
 * whose payload carries `exp`, and the Access application leaves the HttpOnly
 * attribute off, so the page can read it. This watch reads that clock, warns
 * five minutes ahead, and forces a renewal once it runs out.
 *
 * The payload is decoded, never verified — Cloudflare enforces the token at its
 * own edge and nothing here is a security decision. It is a clock, and a clock
 * this page cannot read is treated as UNKNOWN rather than as "fine": every path
 * that finds no cookie leaves the prompt shut and defers to the request-level
 * detection in `useDirectus`. That matters beyond local dev, where there is no
 * cookie at all — turning the HttpOnly attribute back on in Cloudflare would
 * blind this watch, and it must degrade quietly rather than sign anyone out.
 *
 * Expiry is also not the only way an Access session dies (revocation, a policy
 * change, `identity_nonce` rotation, a device-posture failure) — the clock says
 * nothing about those, which is why `handleAccessFailure` exists for the request
 * guards to call once a request has already failed.
 */

const COOKIE_NAME = 'CF_Authorization'

// How far ahead of the deadline the warning opens.
const WARNING_LEAD_MS = 5 * 60 * 1000

// Cadence while the prompt is open. The countdown is recomputed from the clock
// on every tick, never decremented, so a throttled or suspended timer changes
// how often the text updates but never what it says.
const PROMPT_TICK_MS = 1000

// Margin past the warning boundary before the check runs, so the verdict lands
// just inside the window instead of racing it.
const BOUNDARY_DELAY_MS = 1000

// A minimal same-origin page (public/access-renew.html). Loading anything behind
// the hostname makes Access re-issue the cookie; this one is a few hundred bytes
// rather than a second copy of the app.
const RENEW_PATH = '/access-renew.html'

// Shown in the popup from the moment it opens — same label as access-renew.html,
// which takes over once it loads, so the hand-off reads as one screen.
const RENEW_LOADING_HTML = buildLoadingPageHtml('Reconnecting…')
const RENEW_POLL_MS = 500

// How long to keep watching the popup before giving up on it. Generous, because
// a lapsed IdP session turns this into a real sign-in with a password and 2FA.
const RENEW_TIMEOUT_MS = 5 * 60 * 1000

type AccessPromptState = 'hidden' | 'warning' | 'expired'

const promptState = ref<AccessPromptState>('hidden')
const remainingMs = ref(0)
const isRenewing = ref(false)

let isWatching = false
let tickTimerId: ReturnType<typeof setTimeout> | null = null

// The browser drops the cookie the moment it expires, so at the one point we
// most need the deadline it is no longer there to read. Remembering the last
// one we saw is what lets an expiry be told apart from a tab that never had a
// cookie at all (local dev, or the HttpOnly attribute turned back on).
let lastKnownExpiry: number | null = null

// The deadline the user dismissed the warning for. Held as the expiry itself
// rather than a boolean so a renewal — which moves the deadline — gets its own
// warning instead of inheriting the last one's dismissal.
let dismissedForExpiry: number | null = null

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') {
    return null
  }

  const prefix = `${name}=`
  for (const entry of document.cookie.split(';')) {
    const trimmed = entry.trim()
    if (trimmed.startsWith(prefix)) {
      return trimmed.slice(prefix.length)
    }
  }
  return null
}

/**
 * The `exp` claim, in milliseconds. Decode only — see the file comment.
 *
 * Read through `TextDecoder` rather than `atob` alone because the payload also
 * carries the user's name and email, and a non-ASCII character in either would
 * otherwise arrive mangled and take `JSON.parse` down with it.
 */
function getTokenExpiry(token: string): number | null {
  const segment = token.split('.')[1]
  if (!segment) {
    return null
  }

  const { data: payload } = tryCatchSync(() => {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as { exp?: number }
  })

  return typeof payload?.exp === 'number' ? payload.exp * 1000 : null
}

/** The deadline as the cookie states it right now, or null when unreadable. */
function getAccessExpiry(): number | null {
  const token = getCookieValue(COOKIE_NAME)
  return token ? getTokenExpiry(token) : null
}

/**
 * The deadline including one we saw earlier but can no longer read — the state
 * every decision here is made against. Null means this tab has never held an
 * Access cookie, which is the one case that must stay silent.
 */
function getKnownAccessExpiry(): number | null {
  const expiresAt = getAccessExpiry()
  if (expiresAt !== null) {
    lastKnownExpiry = expiresAt
  }
  return expiresAt ?? lastKnownExpiry
}

/**
 * Drop the cookie so the next request through Access has to earn a new one.
 *
 * Renewing without this does nothing: Cloudflare accepts a still-valid cookie
 * and hands the same `exp` straight back, so a user who refreshed at the warning
 * would be cut off five minutes later anyway. Access has no refresh endpoint —
 * clearing and re-navigating is the only way to move the deadline.
 *
 * The attributes must match the ones Access set (host-only, path=/, Secure,
 * SameSite=None) or the browser keeps the original alongside this one.
 */
function clearAccessCookie(): void {
  if (typeof document === 'undefined') {
    return
  }
  document.cookie = `${COOKIE_NAME}=; Max-Age=0; path=/; secure; samesite=none`
}

/** Where the clock says we stand, and what the prompt should therefore show. */
function evaluateAccessSession(): void {
  // The cookie is deliberately absent mid-renewal; the renewal's own poll owns
  // the verdict until it settles.
  if (isRenewing.value) {
    return
  }

  const expiresAt = getKnownAccessExpiry()
  if (expiresAt === null) {
    promptState.value = 'hidden'
    return
  }

  const remaining = expiresAt - Date.now()
  remainingMs.value = Math.max(0, remaining)

  if (remaining <= 0) {
    // Past the deadline, a dismissal no longer applies — there is nothing left
    // to postpone.
    promptState.value = 'expired'
    return
  }

  if (remaining > WARNING_LEAD_MS) {
    // Renewed somewhere — this tab's popup, or another tab's. A fresh deadline
    // earns a fresh warning.
    dismissedForExpiry = null
    promptState.value = 'hidden'
    return
  }

  promptState.value = dismissedForExpiry === expiresAt ? 'hidden' : 'warning'
}

function clearTick(): void {
  if (tickTimerId !== null) {
    clearTimeout(tickTimerId)
    tickTimerId = null
  }
}

/**
 * Sleep until the warning opens, then tick once a second while it is up.
 *
 * Always scheduled from the wall clock rather than from a running count, so a
 * background tab (timers throttled to once a minute) or a closed laptop (timers
 * stopped outright) costs the countdown resolution, never accuracy — the check
 * on return recomputes and lands wherever the clock actually is.
 */
function scheduleTick(): void {
  clearTick()
  if (!isWatching || isRenewing.value) {
    return
  }

  const expiresAt = getKnownAccessExpiry()
  if (expiresAt === null) {
    return
  }

  const remaining = expiresAt - Date.now()
  const delay = remaining > WARNING_LEAD_MS
    ? remaining - WARNING_LEAD_MS + BOUNDARY_DELAY_MS
    : PROMPT_TICK_MS
  tickTimerId = setTimeout(handleTick, delay)
}

function handleTick(): void {
  tickTimerId = null
  evaluateAccessSession()
  scheduleTick()
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== 'visible') {
    return
  }
  // The one check that covers a tab left open across the deadline: whatever the
  // throttled timer did or didn't do while hidden, this recomputes on return.
  evaluateAccessSession()
  scheduleTick()
}

/** Poll for a cookie that outlives the one we cleared. */
function waitForRenewal(previousExpiry: number | null, popup: Window): Promise<boolean> {
  return new Promise((resolve) => {
    const giveUpAt = Date.now() + RENEW_TIMEOUT_MS

    const poll = setInterval(() => {
      const expiresAt = getAccessExpiry()
      const isRenewed = expiresAt !== null
        && expiresAt > Date.now()
        && expiresAt !== previousExpiry
      if (isRenewed) {
        clearInterval(poll)
        resolve(true)
        return
      }

      // A popup the user closed by hand, or one that never got there. Read once
      // more before giving up — the cookie lands with the HTTP response, so it
      // can beat the close by a tick.
      if (popup.closed || Date.now() > giveUpAt) {
        clearInterval(poll)
        const settled = getAccessExpiry()
        resolve(settled !== null && settled > Date.now() && settled !== previousExpiry)
      }
    }, RENEW_POLL_MS)
  })
}

/**
 * Renew the Access session in place.
 *
 * A popup rather than a reload: the whole point of warning ahead is that the
 * user keeps the drawer or half-filled form they were working in. If the IdP
 * session is still alive — the common case — Access re-issues silently and the
 * popup is gone before it is really noticed; only a lapsed one turns into a
 * visible sign-in.
 */
async function handleAccessRenew(): Promise<void> {
  if (isRenewing.value || typeof window === 'undefined') {
    return
  }

  isRenewing.value = true
  clearTick()

  // Read before clearing — afterwards there is nothing left to read.
  const previousExpiry = getAccessExpiry()
  clearAccessCookie()

  // Cache-busted: a page served from the browser's cache never reaches the edge,
  // and it is the round trip through Cloudflare that mints the new cookie.
  const renewUrl = `${RENEW_PATH}?t=${Date.now()}`
  // Opened empty and given a loading screen first, then sent on: the request
  // goes through Access (and possibly an IdP sign-in) before any page arrives,
  // and opening the URL directly left the popup a blank white about:blank for
  // that whole wait. Chrome keeps showing this page until the next one lands.
  const popup = window.open('', 'connect-access-renew', 'width=520,height=680')
  if (!popup) {
    // Popup blocked. A full navigation renews just as well; it only costs
    // whatever was on screen, which beats leaving the user stuck.
    window.location.reload()
    return
  }
  try {
    popup.document.write(RENEW_LOADING_HTML)
    popup.document.close()
  } catch {
    // A popup left open from an earlier attempt, now on Cloudflare's sign-in
    // (another origin): its document can't be written, but it can still be sent
    // on — the loading screen is only a courtesy.
  }
  popup.location.href = renewUrl

  const isRenewed = await waitForRenewal(previousExpiry, popup)
  if (!popup.closed) {
    popup.close()
  }

  isRenewing.value = false
  if (!isRenewed) {
    // Nothing was renewed and the cookie is gone, so the session is over as far
    // as this tab is concerned — hold the prompt open (now unskippable) and let
    // them try again.
    lastKnownExpiry = Date.now()
  }
  evaluateAccessSession()
  scheduleTick()
}

/** Postpone the warning until this deadline actually arrives. */
function handleAccessDismiss(): void {
  const expiresAt = getKnownAccessExpiry()
  if (expiresAt === null || expiresAt <= Date.now()) {
    return
  }
  dismissedForExpiry = expiresAt
  promptState.value = 'hidden'
}

/**
 * Asked by the request guards whether a failure they can't otherwise explain was
 * Cloudflare Access. True means the prompt now owns it and the caller should stop
 * dressing the failure up as its own.
 *
 * Deliberately narrow: only a deadline this tab has actually seen, and only once
 * it is past. A tab that never held a cookie answers false, so local dev and a
 * re-enabled HttpOnly attribute both leave the existing error handling alone.
 */
export function handleAccessFailure(): boolean {
  const expiresAt = getKnownAccessExpiry()
  if (expiresAt === null || expiresAt > Date.now()) {
    return false
  }

  evaluateAccessSession()
  scheduleTick()
  return true
}

function startAccessWatch(): void {
  if (typeof window === 'undefined' || isWatching) {
    return
  }

  isWatching = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
  evaluateAccessSession()
  scheduleTick()
}

export function useCloudflareAccess() {
  return {
    promptState: readonly(promptState),
    remainingMs: readonly(remainingMs),
    isRenewing: readonly(isRenewing),
    startAccessWatch,
    handleAccessRenew,
    handleAccessDismiss,
  }
}
