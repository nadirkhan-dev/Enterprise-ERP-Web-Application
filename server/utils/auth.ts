/**
 * Server-side request auth (Directus session validation).
 *
 * The frontend forwards the user's Directus access token in the
 * `Authorization: Bearer <token>` header. We verify the token by hitting
 * Directus's `/users/me` and capture the resolved user id.
 *
 * The user's role is then resolved with the SERVICE token, not their own:
 * the headless policies (app_access false, e.g. CONNECT Internal Sales) have
 * no grant on `directus_users.role` or `directus_roles`, so asking /users/me
 * for `role.id` silently returns null for exactly those users — and every
 * permission endpoint downstream then sees an empty policy set and fails
 * closed (all rights false).
 *
 * Validations are cached in-memory for 60s — Directus tokens themselves
 * expire after 15m by default, so re-checking once a minute is safe and
 * keeps the carrier-rate path cheap.
 */

import type { H3Event } from 'h3'

export interface AuthenticatedUser {
  id: string
  role: string | null
}

interface CachedAuth {
  user: AuthenticatedUser
  expiresAt: number
}

const AUTH_CACHE_TTL_MS = 60 * 1000
const authCache = new Map<string, CachedAuth>()

export class AuthError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 401) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}

interface DirectusMeResponse {
  data?: {
    id?: string
    role?: { id?: string | null } | string | null
  }
}

/**
 * The user's role id, read with the service token — the caller's own token
 * cannot be trusted for this (headless policies can't read `role`, see the
 * module docblock). Degrades to null if the service token is missing or the
 * lookup fails: same answer the old code produced, so nothing gets worse —
 * the permission endpoints just fall back to their no-rights answers.
 */
async function fetchRoleAsService(userId: string): Promise<string | null> {
  const runtime = useRuntimeConfig()
  const directusUrl = String(runtime.directusUrl || '').replace(/\/$/, '')
  const serviceToken = String(runtime.directusToken || '')
  if (!directusUrl || !serviceToken) {
    return null
  }

  try {
    const response = await fetch(`${directusUrl}/users/${userId}?fields=role`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
    })
    if (!response.ok) {
      return null
    }
    const payload = (await response.json()) as DirectusMeResponse
    const rawRole = payload.data?.role
    return typeof rawRole === 'string' ? rawRole : rawRole?.id ?? null
  } catch {
    return null
  }
}

/**
 * The caller's raw Directus token. Routes that act *on the user's behalf* (e.g.
 * uploading a file so `uploaded_by` is the real person) need to forward it, not
 * just know who they are.
 */
export function extractBearerToken(event: H3Event): string | null {
  const header = getHeader(event, 'authorization')
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const token = match[1]?.trim()
  return token ? token : null
}

export async function requireAuthenticatedUser(event: H3Event): Promise<AuthenticatedUser> {
  const token = extractBearerToken(event)
  if (!token) {
    throw new AuthError('Missing or malformed Authorization header.', 401)
  }
  return authenticateToken(token)
}

export async function authenticateToken(token: string): Promise<AuthenticatedUser> {
  if (!token) {
    throw new AuthError('Missing access token.', 401)
  }

  const cached = authCache.get(token)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user
  }

  const runtime = useRuntimeConfig()
  const directusUrl = String(runtime.directusUrl || '').replace(/\/$/, '')
  if (!directusUrl) {
    throw new AuthError('Directus URL is not configured (DIRECTUS_URL missing).', 500)
  }

  let response: Response
  try {
    response = await fetch(`${directusUrl}/users/me?fields=id`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (error) {
    throw new AuthError(`Auth check network error: ${(error as Error).message}`, 502)
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthError('Invalid or expired session.', 401)
  }
  if (!response.ok) {
    throw new AuthError(`Auth check failed (${response.status})`, 502)
  }

  const payload = (await response.json()) as DirectusMeResponse
  const userId = payload.data?.id
  if (!userId) {
    throw new AuthError('Auth check returned no user id.', 502)
  }

  const role = await fetchRoleAsService(userId)

  const user: AuthenticatedUser = { id: userId, role }
  authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS })
  return user
}
