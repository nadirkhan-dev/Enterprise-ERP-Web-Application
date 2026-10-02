/**
 * Integration endpoints and credential locations, read from Directus (server-only).
 *
 * The `providers` collection is the registry of the services CONNECT talks to —
 * a `shipping_carriers` row points at the provider that rates it, so FedEx
 * Freight resolving to the `fedex` provider is what tells this code to rate it
 * through the FedEx API. Each row carries where the service lives
 * (`api_base_url`, plus `api_config.sandbox_base_url`) and which environment
 * variables hold its credentials (`api_key_env_var`, `api_secret_env_var`, and
 * `api_config.env_vars` for services needing more than two). Editing a base URL
 * in Directus therefore moves an integration without a deploy.
 *
 * Secrets themselves never live in Directus — the row names the variable, the
 * value stays in `.env`.
 *
 * `api_config` shape (all optional):
 *   {
 *     "sandbox_base_url": "https://apis-sandbox.fedex.com",
 *     "env_var":          "NUXT_FEDEX_ENV",   // which env selects the base URL
 *     "production_value": "production",       // its value meaning "use api_base_url"
 *     "env_vars": { "account": "NUXT_FEDEX_ACCOUNT" }  // extra credentials
 *   }
 *
 * Every lookup fails soft, returning null rather than throwing: a Directus
 * outage must not take shipping estimates down when the credentials are sitting
 * in `.env` already. Callers fall back to `runtimeConfig`.
 */

export interface ProviderCredentials {
  /** Sandbox or production host, chosen by the `api_config.env_var` flag. */
  baseUrl: string
  apiKey: string
  apiSecret: string
  /** Extra credentials named in `api_config.env_vars`, resolved from the environment. */
  values: Record<string, string>
  /**
   * The row's `api_config`, verbatim. Canonical key:value defaults — data only,
   * never behaviour: the caller owns the typed code that validates and applies
   * it, and must never `eval` any part of it.
   */
  config: Record<string, unknown>
}

export interface ProviderLookupOptions {

  fallbackApiKeyEnvVar?: string
}

interface CachedProvider {
  credentials: ProviderCredentials | null
  expiresAt: number
}

const PROVIDER_CACHE_TTL_MS = 5 * 60 * 1000
const providerCache = new Map<string, CachedProvider>()

interface ProviderApiConfig {
  sandbox_base_url?: string | null
  env_var?: string | null
  production_value?: string | null
  env_vars?: Record<string, string> | null
  // Providers carry their own canonical defaults alongside these — Priority1's
  // `ltlEstimateDefaults`, for one. They reach the caller through `config`.
  [key: string]: unknown
}

interface DirectusProviderResponse {
  data?: Array<{
    api_base_url?: string | null
    api_key_env_var?: string | null
    api_secret_env_var?: string | null
    api_config?: ProviderApiConfig | null
  }>
}

function readEnv(name: unknown): string {
  const key = String(name ?? '').trim()
  return key ? String(process.env[key] ?? '').trim() : ''
}

/**
 * Pick the host for the current environment. A provider that names no
 * `env_var` has one host and always uses `api_base_url`; otherwise the sandbox
 * host wins unless the variable reads exactly `production_value`.
 */
function resolveBaseUrl(baseUrl: string, config: ProviderApiConfig | null): string {
  const sandboxBaseUrl = String(config?.sandbox_base_url ?? '').trim()
  const envVar = String(config?.env_var ?? '').trim()
  if (!sandboxBaseUrl || !envVar) {
    return baseUrl
  }
  const productionValue = String(config?.production_value ?? 'production').trim().toLowerCase()
  const isProduction = readEnv(envVar).toLowerCase() === productionValue
  return isProduction ? baseUrl : sandboxBaseUrl
}

/**
 * The endpoint and credentials for one provider, looked up by its immutable
 * `code` (`fedex`, `ups`, `priority1`).
 *
 * @returns the resolved credentials, or null when the provider has no row, the
 *          row names no credential variable, or Directus could not be reached —
 *          all of which mean "fall back to runtimeConfig", never "fail".
 */
export async function fetchProviderCredentials(
  code: string,
  options: ProviderLookupOptions = {},
): Promise<ProviderCredentials | null> {
  // Keyed by code AND fallback name: two callers asking for the same provider
  // under different local variable names must not read each other's answer.
  const cacheKey = `${code}::${options.fallbackApiKeyEnvVar ?? ''}`
  const cached = providerCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.credentials
  }

  const credentials = await lookupProvider(code, options)
  providerCache.set(cacheKey, { credentials, expiresAt: Date.now() + PROVIDER_CACHE_TTL_MS })
  return credentials
}

async function lookupProvider(
  code: string,
  options: ProviderLookupOptions = {},
): Promise<ProviderCredentials | null> {
  const runtime = useRuntimeConfig()
  const directusUrl = String(runtime.directusUrl || '').replace(/\/$/, '')
  const directusToken = String(runtime.directusToken || '')
  if (!directusUrl || !directusToken) {
    return null
  }

  const url = new URL(`${directusUrl}/items/providers`)
  url.searchParams.set('fields', 'api_base_url,api_key_env_var,api_secret_env_var,api_config')
  url.searchParams.set('filter[code][_eq]', code)
  url.searchParams.set('limit', '1')

  let response: Response
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${directusToken}` },
    })
  } catch (error) {
    console.warn(`[providerConfig] Directus network error for "${code}": ${(error as Error).message}`)
    return null
  }

  if (!response.ok) {
    console.warn(`[providerConfig] Directus lookup for "${code}" failed (${response.status})`)
    return null
  }

  const payload = (await response.json()) as DirectusProviderResponse
  const provider = payload.data?.[0]
  if (!provider) {
    return null
  }

  const apiKey = readEnv(provider.api_key_env_var) || readEnv(options.fallbackApiKeyEnvVar)
  const apiSecret = readEnv(provider.api_secret_env_var)
  // A row naming no variable that resolves is not configured for this app —
  // treat it as absent so the caller keeps its own credentials.
  if (!apiKey && !apiSecret) {
    return null
  }

  const config = provider.api_config ?? null
  const values: Record<string, string> = {}
  for (const [name, envVar] of Object.entries(config?.env_vars ?? {})) {
    values[name] = readEnv(envVar)
  }

  return {
    baseUrl: resolveBaseUrl(String(provider.api_base_url ?? '').trim(), config),
    apiKey,
    apiSecret,
    values,
    config: (config ?? {}) as Record<string, unknown>,
  }
}

/** Test seam — drops the cached providers so the next call re-reads Directus. */
export function resetProviderCredentials(): void {
  providerCache.clear()
}
