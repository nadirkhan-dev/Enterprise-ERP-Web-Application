import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { RequestOptions } from 'node:https'
import { URL } from 'node:url'

interface SapSession {
  cookie: string
}

interface SapServiceLayerConfig {
  baseUrl: string
  companyDb: string
  username: string
  password: string
  allowSelfSignedCert: boolean
}

interface SapRequestOptions {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  retryOnUnauthorized?: boolean
}

export interface SapServiceLayerClient {
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body: Record<string, unknown>) => Promise<T>
}

export class SapServiceLayerError extends Error {
  statusCode: number
  details?: unknown

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message)
    this.name = 'SapServiceLayerError'
    this.statusCode = statusCode
    this.details = details
  }
}

let session: SapSession | null = null
let loginPromise: Promise<SapSession> | null = null

function getSapConfig(): SapServiceLayerConfig {
  const config = useRuntimeConfig()
  const sapConfig = {
    baseUrl: String(config.sapServiceLayerUrl || '').replace(/\/+$/, ''),
    companyDb: String(config.sapCompanyDb || ''),
    username: String(config.sapUsername || ''),
    password: String(config.sapPassword || ''),
    allowSelfSignedCert: String(config.sapAllowSelfSignedCert || '').toLowerCase() === 'true',
  }

  if (!sapConfig.baseUrl || !sapConfig.companyDb || !sapConfig.username || !sapConfig.password) {
    throw new SapServiceLayerError('SAP Service Layer is not configured.', 500)
  }

  return sapConfig
}

function normalizeSetCookie(setCookie: string | string[] | null | undefined): string[] {
  if (Array.isArray(setCookie)) {
    return setCookie
  }

  if (!setCookie) {
    return []
  }

  return setCookie.split(/,(?=\s*[^;,\s]+=)/)
}

function extractSessionCookie(setCookie: string | string[] | null | undefined): string {
  const cookies = normalizeSetCookie(setCookie)
    .map(cookie => cookie.split(';')[0]?.trim())
    .filter(cookie => cookie.startsWith('B1SESSION=') || cookie.startsWith('ROUTEID='))

  if (!cookies.length) {
    throw new SapServiceLayerError('SAP login did not return a session cookie.', 502)
  }

  return cookies.join('; ')
}

function getErrorStatus(error: unknown): number {
  const err = error as any
  return Number(err?.response?.status || err?.statusCode || err?.status || 500)
}

function getErrorMessage(error: unknown): string {
  const err = error as any
  const causeCode = err?.cause?.code || err?.code

  if (causeCode === 'SELF_SIGNED_CERT_IN_CHAIN' || causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
    return 'SAP Service Layer TLS certificate is not trusted. Install the SAP certificate authority or set NUXT_SAP_ALLOW_SELF_SIGNED_CERT=true for this environment.'
  }

  if (causeCode === 'ENOTFOUND') {
    return 'SAP Service Layer host could not be resolved from the Nuxt server.'
  }

  if (causeCode === 'ECONNREFUSED') {
    return 'SAP Service Layer refused the connection from the Nuxt server.'
  }

  if (causeCode === 'ETIMEDOUT' || causeCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'SAP Service Layer connection timed out from the Nuxt server.'
  }

  return String(
    err?.data?.error?.message?.value ||
    err?.data?.error?.message ||
    err?.statusMessage ||
    err?.message ||
    'SAP Service Layer request failed.',
  )
}

function isUnauthorized(error: unknown): boolean {
  return getErrorStatus(error) === 401
}

function nativeSapRequest<T>(
  url: string,
  options: {
    method: 'GET' | 'POST'
    body?: Record<string, unknown>
    cookie?: string
    allowSelfSignedCert: boolean
  },
): Promise<{ data: T; setCookie: string[] }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const body = options.body ? JSON.stringify(options.body) : undefined
    const requestOptions: RequestOptions = {
      method: options.method,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      rejectUnauthorized: !options.allowSelfSignedCert,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.cookie ? { Cookie: options.cookie } : {}),
      },
    }

    const requester = parsedUrl.protocol === 'https:' ? httpsRequest : httpRequest
    const request = requester(requestOptions, (response) => {
      const chunks: Buffer[] = []

      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        const statusCode = response.statusCode || 500

        let data: any = null
        if (text) {
          try {
            data = JSON.parse(text)
          } catch {
            data = text
          }
        }

        if (statusCode >= 400) {
          reject(new SapServiceLayerError(getErrorMessage({ data, statusCode }), statusCode, data))
          return
        }

        resolve({
          data,
          setCookie: response.headers['set-cookie'] || [],
        })
      })
    })

    request.on('error', reject)

    if (body) {
      request.write(body)
    }

    request.end()
  })
}

async function login(): Promise<SapSession> {
  if (loginPromise) {
    return loginPromise
  }

  loginPromise = (async () => {
    try {
      const config = getSapConfig()
      const loginBody = {
        CompanyDB: config.companyDb,
        UserName: config.username,
        Password: config.password,
      }

      const setCookie = config.allowSelfSignedCert
        ? (await nativeSapRequest(`${config.baseUrl}/Login`, {
            method: 'POST',
            body: loginBody,
            allowSelfSignedCert: config.allowSelfSignedCert,
          })).setCookie
        : (await $fetch.raw(`${config.baseUrl}/Login`, {
            method: 'POST',
            body: loginBody,
          })).headers.get('set-cookie')

      const nextSession = { cookie: extractSessionCookie(setCookie) }
      session = nextSession
      return nextSession
    } catch (error) {
      session = null
      if (error instanceof SapServiceLayerError) {
        throw error
      }
      throw new SapServiceLayerError(getErrorMessage(error), getErrorStatus(error), (error as any)?.data)
    }
  })()

  try {
    return await loginPromise
  } finally {
    loginPromise = null
  }
}

async function getSession(): Promise<SapSession> {
  if (session) {
    return session
  }

  return await login()
}

async function sapRequest<T>(
  path: string,
  options: SapRequestOptions = {},
): Promise<T> {
  const config = getSapConfig()
  const currentSession = await getSession()
  const method = options.method || 'GET'
  const retryOnUnauthorized = options.retryOnUnauthorized !== false

  try {
    const url = `${config.baseUrl}/${path.replace(/^\/+/, '')}`
    if (config.allowSelfSignedCert) {
      const response = await nativeSapRequest<T>(url, {
        method,
        body: options.body,
        cookie: currentSession.cookie,
        allowSelfSignedCert: config.allowSelfSignedCert,
      })
      return response.data
    }

    return await $fetch<T>(url, {
      method,
      body: options.body,
      headers: { Cookie: currentSession.cookie },
    }) as unknown as T
  } catch (error) {
    if (retryOnUnauthorized && isUnauthorized(error)) {
      session = null
      await login()
      return await sapRequest<T>(path, { ...options, retryOnUnauthorized: false })
    }

    throw new SapServiceLayerError(getErrorMessage(error), getErrorStatus(error), (error as any)?.data)
  }
}

export function useSapServiceLayer(): SapServiceLayerClient {
  return {
    get: path => sapRequest(path),
    post: (path, body) => sapRequest(path, { method: 'POST', body }),
  }
}

export function resetSapServiceLayerSession(): void {
  session = null
  loginPromise = null
}
