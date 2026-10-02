/**
 * Route manifest — single source of truth for auth routing.
 * Any route NOT in PUBLIC_ROUTES requires authentication (deny-by-default).
 */
export const PUBLIC_ROUTES: string[] = [
  '/login',
  '/password-reset',
]

export const LOGIN_ROUTE: string = '/login'
export const DEFAULT_ROUTE: string = '/items'
