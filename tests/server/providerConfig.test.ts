import {
  fetchProviderCredentials,
  resetProviderCredentials,
} from '../../server/utils/providerConfig'

interface ProviderRow {
  api_base_url?: string | null
  api_key_env_var?: string | null
  api_secret_env_var?: string | null
  api_config?: Record<string, unknown> | null
}

/** A `providers` reply holding one row (or none, for an unregistered code). */
function mockDirectusProvider(row: ProviderRow | null) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: row ? [row] : [] }),
  }) as unknown as Response)
}

// The FedEx row as Directus holds it: production host on `api_base_url`, the
// sandbox host and the extra account variables in `api_config`.
const FEDEX_ROW: ProviderRow = {
  api_base_url: 'https://apis.fedex.com',
  api_key_env_var: 'NUXT_FEDEX_API_KEY',
  api_secret_env_var: 'NUXT_FEDEX_SECRET_KEY',
  api_config: {
    sandbox_base_url: 'https://apis-sandbox.fedex.com',
    env_var: 'NUXT_FEDEX_ENV',
    production_value: 'production',
    env_vars: {
      shipperAccount: 'NUXT_FEDEX_SHIPPER_ACCOUNT',
      account: 'NUXT_FEDEX_ACCOUNT',
    },
  },
}

describe('Scenario: Resolving an integration from its Directus provider row', () => {
  beforeEach(() => {
    resetProviderCredentials()
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
    process.env.NUXT_FEDEX_API_KEY = 'fedex-key'
    process.env.NUXT_FEDEX_SECRET_KEY = 'fedex-secret'
    process.env.NUXT_FEDEX_SHIPPER_ACCOUNT = '111'
    process.env.NUXT_FEDEX_ACCOUNT = '222'
    process.env.NUXT_FEDEX_ENV = 'sandbox'
  })

  afterEach(() => {
    delete process.env.NUXT_FEDEX_API_KEY
    delete process.env.NUXT_FEDEX_SECRET_KEY
    delete process.env.NUXT_FEDEX_SHIPPER_ACCOUNT
    delete process.env.NUXT_FEDEX_ACCOUNT
    delete process.env.NUXT_FEDEX_ENV
  })

  it('reads credentials from the environment variables the row names', async () => {
    globalThis.fetch = mockDirectusProvider(FEDEX_ROW)

    const credentials = await fetchProviderCredentials('fedex')

    expect(credentials?.apiKey).toBe('fedex-key')
    expect(credentials?.apiSecret).toBe('fedex-secret')
    expect(credentials?.values).toEqual({ shipperAccount: '111', account: '222' })
  })

  it('never carries the secrets themselves — only where they live', async () => {
    const fetchMock = mockDirectusProvider(FEDEX_ROW)
    globalThis.fetch = fetchMock
    await fetchProviderCredentials('fedex')

    // The row is asked for variable NAMES; a value would mean a secret in Directus.
    const requestedUrl = String(fetchMock.mock.calls[0][0])
    expect(requestedUrl).toContain('api_key_env_var')
    expect(requestedUrl).not.toContain('fedex-key')
  })

  it('picks the sandbox host until the environment flag says production', async () => {
    globalThis.fetch = mockDirectusProvider(FEDEX_ROW)
    expect((await fetchProviderCredentials('fedex'))?.baseUrl)
      .toBe('https://apis-sandbox.fedex.com')

    resetProviderCredentials()
    process.env.NUXT_FEDEX_ENV = 'production'
    globalThis.fetch = mockDirectusProvider(FEDEX_ROW)
    expect((await fetchProviderCredentials('fedex'))?.baseUrl)
      .toBe('https://apis.fedex.com')
  })

  it('uses the one host when the row names no environment flag', async () => {
    globalThis.fetch = mockDirectusProvider({
      api_base_url: 'https://api.priority1.com',
      api_key_env_var: 'NUXT_FEDEX_API_KEY',
      api_config: null,
    })

    expect((await fetchProviderCredentials('priority1'))?.baseUrl)
      .toBe('https://api.priority1.com')
  })

  it('serves the second caller from cache rather than re-reading Directus', async () => {
    const fetchMock = mockDirectusProvider(FEDEX_ROW)
    globalThis.fetch = fetchMock

    await fetchProviderCredentials('fedex')
    await fetchProviderCredentials('fedex')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// Every one of these has to answer null rather than throw: the caller falls back
// to runtimeConfig, so shipping keeps rating on the values already in `.env`.
describe('Scenario: A provider row that cannot answer', () => {
  beforeEach(() => {
    resetProviderCredentials()
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  it('answers null for a code with no row — Priority1 before it is registered', async () => {
    globalThis.fetch = mockDirectusProvider(null)

    expect(await fetchProviderCredentials('priority1')).toBeNull()
  })

  it('answers null when the named variables hold nothing', async () => {
    globalThis.fetch = mockDirectusProvider({
      api_base_url: 'https://apis.fedex.com',
      api_key_env_var: 'NUXT_UNSET_KEY',
      api_secret_env_var: 'NUXT_UNSET_SECRET',
    })

    expect(await fetchProviderCredentials('fedex')).toBeNull()
  })

  it('answers null when Directus is unreachable', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED') })

    expect(await fetchProviderCredentials('fedex')).toBeNull()
  })

  it('answers null when Directus refuses the lookup', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }) as unknown as Response)

    expect(await fetchProviderCredentials('fedex')).toBeNull()
  })

  it('answers null when Directus is not configured at all', async () => {
    globalThis.useRuntimeConfig = () => ({ directusUrl: '', directusToken: '' })
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock

    expect(await fetchProviderCredentials('fedex')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
