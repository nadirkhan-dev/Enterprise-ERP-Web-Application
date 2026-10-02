import {
  createDirectus,
  authentication,
  rest,
  realtime,
  type AuthenticationData,
  type AuthenticationStorage,
  type DirectusClient,
  type AuthenticationClient,
  type RestClient,
  type RestCommand,
  type WebSocketClient,
} from '@directus/sdk'
import { handleAccessFailure } from '~/composables/useCloudflareAccess'

type AppDirectusClient = DirectusClient<object> & AuthenticationClient<object> & RestClient<object> & WebSocketClient<object>

/**
 * Asked to salvage a request that came back 401. Resolves true once the session
 * has been renewed (the request is then retried once), false when the session is
 * gone for good — the failure is handed back to the caller either way.
 *
 * Injected rather than imported: the handler needs the auth store, which needs
 * this module, and this module must stay at the bottom of that chain.
 */
type AuthFailureHandler = () => Promise<boolean>

let client: AppDirectusClient | null = null
let persistRefreshToken: boolean = false
let handleAuthFailure: AuthFailureHandler | null = null
let isAuthStorageSealed: boolean = false

/**
 * Refuse token writes between sign-out and the next sign-in. `logout()` clears
 * the stored session, but a refresh already in flight when it ran (the guard's
 * recovery, or the SDK's own auto-refresh) settles afterwards and would write
 * freshly rotated tokens back into localStorage — a live session blob behind a
 * signed-out UI, which the next reload's `checkAuth()` would resurrect.
 * Clearing (`set(null)`) stays allowed while sealed.
 */
export function sealAuthStorage(): void {
  isAuthStorageSealed = true
}

export function unsealAuthStorage(): void {
  isAuthStorageSealed = false
}

/**
 * Controls whether the Directus refresh_token is persisted alongside the
 * access token. With it, sessions survive browser restarts up to
 * REFRESH_TOKEN_TTL (default 7d). Without it, the session ends when the
 * access token expires (ACCESS_TOKEN_TTL, default 15m) because the SDK
 * has no token to call /auth/refresh with.
 */
export function setAuthPersistence(persistent: boolean): void {
  persistRefreshToken = persistent
}

function readStoredAuth(): AuthenticationData | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem('directus-auth')
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Ground truth after a reload: inspect the stored token blob and report
 * whether it still carries a refresh_token. Used to keep the in-memory
 * flag in sync with what's actually on disk.
 */
export function resolveAuthPersistence(): boolean {
  return Boolean(readStoredAuth()?.refresh_token)
}

/**
 * When the stored access token expires (epoch ms), or null when there's no stored
 * session — or one the SDK never dated. Reading it is the only way to notice an
 * expiry without making a request: `getToken()` hands back the stale token when
 * its own silent refresh fails, so it can't be used to tell live from expired.
 */
export function getStoredAuthExpiry(): number | null {
  return readStoredAuth()?.expires_at ?? null
}

/**
 * Whether a session blob exists at all — not whether it's still any good.
 *
 * Absence is decisive: the SDK never removes this key, it blanks the fields in
 * place while refreshing (`set()` is only ever called with an object). So a
 * missing key means something outside the SDK wiped the session — a signed-out
 * tab, cleared site data, devtools — and there is nothing left to renew.
 */
export function hasStoredSession(): boolean {
  return readStoredAuth() !== null
}

/**
 * A failure caused by the session rather than by the caller.
 *
 * 401 is the signal for a token Directus rejected: it answers 401 only for an
 * expired or invalid one, never for a permissions denial (that's 403, and it must
 * never end anyone's session).
 *
 * A wiped session doesn't produce a 401 at all, though — with nothing in storage
 * the SDK attaches no Authorization header, so Directus evaluates the request as
 * anonymous and answers 403. Hence the second half: any failure while holding no
 * session is a session failure.
 */
function isAuthErrorResponse(error: unknown): boolean {
  if (!hasStoredSession()) {
    return true
  }
  return (error as { response?: { status?: number } } | null)?.response?.status === 401
}

export function setAuthFailureHandler(handler: AuthFailureHandler | null): void {
  handleAuthFailure = handler
}

export function cleanupStaleAuthStorage(): void {
  if (typeof window === 'undefined') return
  sessionStorage.removeItem('directus-auth')
}

export function clearAuthStorage(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem('directus-auth')
  sessionStorage.removeItem('directus-auth')
}

class AuthStorageAdapter implements AuthenticationStorage {
  get(): AuthenticationData | null {
    if (typeof window === 'undefined') {
      return null
    }
    const raw = localStorage.getItem('directus-auth')
    return raw ? this._safeParse(raw) : null
  }

  _safeParse(json: string): AuthenticationData | null {
    try {
      return JSON.parse(json)
    } catch {
      localStorage.removeItem('directus-auth')
      sessionStorage.removeItem('directus-auth')
      return null
    }
  }

  set(value: AuthenticationData | null): void {
    if (typeof window === 'undefined') {
      return
    }
    if (value) {
      // Sealed after logout: a late-settling refresh must not write rotated
      // tokens back into a session the user just ended (see sealAuthStorage).
      if (isAuthStorageSealed) {
        return
      }
      const payload: AuthenticationData = persistRefreshToken
        ? value
        : { ...value, refresh_token: null }
      localStorage.setItem('directus-auth', JSON.stringify(payload))
    } else {
      localStorage.removeItem('directus-auth')
      sessionStorage.removeItem('directus-auth')
    }
  }
}

export function resetDirectusClient(): void {
  client = null
}

/**
 * A REST-only Directus client with NO authentication layer — for public flows
 * (password reset request / confirm) that must never carry a bearer token.
 *
 * The shared `useDirectus()` client attaches whatever access token is in storage
 * to every request. On the login page a stale/expired token from a prior session
 * still lingers there (no refresh token to clear it), so Directus validates that
 * bearer first and rejects the request with TOKEN_EXPIRED — before it ever
 * handles the public endpoint. This client sends no Authorization header.
 */
export function createPublicDirectusClient(): DirectusClient<object> & RestClient<object> {
  const config = useRuntimeConfig()
  let directusUrl = config.public.directusUrl as string
  if (directusUrl.startsWith('/') && typeof window !== 'undefined') {
    directusUrl = `${window.location.origin}${directusUrl}`
  }
  return createDirectus(directusUrl).with(rest())
}

/**
 * Build realtime config with direct WebSocket URL.
 * The Nuxt HTTP proxy doesn't support WebSocket upgrades,
 * so the realtime client connects directly to Directus.
 *
 * URL is read from runtime config `public.directusWebsocketUrl`,
 * which is set via the `NUXT_PUBLIC_DIRECTUS_WEBSOCKET_URL` env var.
 */
function buildRealtimeConfig(wsUrl: string): Parameters<typeof realtime>[0] {
  const config: Parameters<typeof realtime>[0] = {
    authMode: 'strict',
    reconnect: { delay: 3000, retries: 10 },
    heartbeat: true,
  }
  if (wsUrl) {
    config.url = wsUrl
  }
  return config
}

/**
 * Route every `.request()` through the session-failure handler, so an expired
 * session surfaces as a sign-out instead of a screen that quietly stops working.
 *
 * The SDK's `rest()` hooks (`onRequest`/`onResponse`) only run on a *successful*
 * response, so wrapping `request` is the one place a failed call can be seen for
 * every collection, composable, and store at once. A recovered session replays
 * the request, so the caller never learns it happened; an unrecoverable one still
 * gets the original error, leaving each caller's own error handling intact.
 *
 * Deliberately not applied to `createPublicDirectusClient` — the password flows
 * carry no session to lose.
 */
function withAuthFailureGuard(instance: AppDirectusClient): AppDirectusClient {
  const performRequest = instance.request.bind(instance) as (
    command: RestCommand<unknown, object>,
  ) => Promise<unknown>

  instance.request = (async (command: RestCommand<unknown, object>) => {
    const { data: payload, error: requestError } = await tryCatch(performRequest(command))
    if (!requestError) {
      return payload
    }
    // Cloudflare Access sits in front of every request and answers an expired
    // one with a cross-origin redirect to its login page — which reaches the
    // browser as a bare network failure carrying no status at all. Left to the
    // checks below that reads as "Directus is unreachable", so ask the Access
    // clock first; once it takes the failure, its own prompt owns the recovery
    // and there is no Directus session to end over it.
    if (handleAccessFailure()) {
      throw requestError
    }
    if (!isAuthErrorResponse(requestError) || !handleAuthFailure) {
      throw requestError
    }

    const isRecovered = await handleAuthFailure()
    if (!isRecovered) {
      throw requestError
    }
    return await performRequest(command)
  }) as AppDirectusClient['request']

  return instance
}

export function useDirectus(): AppDirectusClient {
  if (client) {
    return client
  }

  const config = useRuntimeConfig()
  let directusUrl = config.public.directusUrl as string
  if (directusUrl.startsWith('/') && typeof window !== 'undefined') {
    directusUrl = `${window.location.origin}${directusUrl}`
  }
  const base = createDirectus(directusUrl)
    .with(authentication('json', {
      storage: new AuthStorageAdapter(),
      autoRefresh: true,
      msRefreshBeforeExpires: 30000,
    }))
    .with(rest())

  // WebSocket is browser-only — skip realtime composable during SSR
  if (typeof window !== 'undefined') {
    const wsUrl = (config.public.directusWebsocketUrl as string) || ''
    client = withAuthFailureGuard(base.with(realtime(buildRealtimeConfig(wsUrl))))
  } else {
    client = base as AppDirectusClient
  }

  return client
}
