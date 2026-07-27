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
  type WebSocketClient,
} from '@directus/sdk'

type AppDirectusClient = DirectusClient<object> & AuthenticationClient<object> & RestClient<object> & WebSocketClient<object>

let client: AppDirectusClient | null = null
let persistRefreshToken: boolean = false

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

/**
 * Ground truth after a reload: inspect the stored token blob and report
 * whether it still carries a refresh_token. Used to keep the in-memory
 * flag in sync with what's actually on disk.
 */
export function resolveAuthPersistence(): boolean {
  if (typeof window === 'undefined') return false
  const raw = localStorage.getItem('directus-auth')
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw)
    return Boolean(parsed?.refresh_token)
  } catch {
    return false
  }
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
    client = base.with(realtime(buildRealtimeConfig(wsUrl)))
  } else {
    client = base as AppDirectusClient
  }

  return client
}
