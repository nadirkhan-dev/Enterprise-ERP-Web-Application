// @ts-nocheck

const mocks = vi.hoisted(() => ({
  token: 'token-original',
  handleAuthFailure: vi.fn(),
}))

vi.mock('~/composables/useDirectus', () => ({
  useDirectus: () => ({
    getToken: () => Promise.resolve(mocks.token),
  }),
}))

vi.mock('~/composables/useSessionExpiry', () => ({
  handleAuthFailure: mocks.handleAuthFailure,
}))

import { useAssetUrl } from '../../app/composables/useAssetUrl'

describe('Scenario: Authenticated Directus asset URLs', () => {
  beforeEach(() => {
    mocks.token = 'token-original'
    mocks.handleAuthFailure.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    globalThis.tryCatch = async (operation) => {
      try {
        return { data: await operation, error: null }
      } catch (error) {
        return { data: null, error }
      }
    }
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds responsive URLs with the current access token', async () => {
    const { getResponsiveUrl } = useAssetUrl()

    const responsive = await getResponsiveUrl('file-1', 84)

    expect(responsive?.src).toContain('/directus/assets/file-1?access_token=token-original')
    expect(responsive?.src).toContain('width=84')
    expect(responsive?.srcset).toContain('width=168')
  })

  it('refreshes a rejected session and rebuilds the URLs with the new token', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 401 }))
    mocks.handleAuthFailure.mockImplementation(() => {
      mocks.token = 'token-refreshed'
      return Promise.resolve(true)
    })
    const { handleResponsiveUrlError } = useAssetUrl()

    const responsive = await handleResponsiveUrlError('/directus/assets/file-1?access_token=expired', 'file-1', 84)

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/directus/assets/file-1?access_token=expired',
      { cache: 'no-store' },
    )
    expect(mocks.handleAuthFailure).toHaveBeenCalledOnce()
    expect(responsive?.src).toContain('access_token=token-refreshed')
    expect(responsive?.src).toContain('asset_retry=123456')
  })

  it('cache-busts a browser-cached failure without refreshing a valid session', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 200 }))
    const { handleResponsiveUrlError } = useAssetUrl()

    const responsive = await handleResponsiveUrlError('/directus/assets/file-1?access_token=token-original', 'file-1', 84)

    expect(mocks.handleAuthFailure).not.toHaveBeenCalled()
    expect(responsive?.src).toContain('access_token=token-original')
    expect(responsive?.src).toContain('asset_retry=123456')
  })

  it('does not retry a genuinely unavailable asset', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 404 }))
    const { handleResponsiveUrlError } = useAssetUrl()

    const responsive = await handleResponsiveUrlError('/directus/assets/missing', 'missing', 84)

    expect(responsive).toBeNull()
    expect(mocks.handleAuthFailure).not.toHaveBeenCalled()
  })
})
describe('Scenario: Recovering a width-descriptor srcset', () => {
  beforeEach(() => {
    mocks.token = 'token-original'
    mocks.handleAuthFailure.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(123456)
    globalThis.tryCatch = async (operation) => {
      try {
        return { data: await operation, error: null }
      } catch (error) {
        return { data: null, error }
      }
    }
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds one candidate per width, largest as the plain src', async () => {
    const { getResponsiveSrcset } = useAssetUrl()

    const responsive = await getResponsiveSrcset('file-1', [120, 150, 240, 300], null)

    expect(responsive?.srcset).toContain('width=120')
    expect(responsive?.srcset).toContain('120w')
    expect(responsive?.srcset).toContain('300w')
    expect(responsive?.src).toContain('width=300')
    // Width-only (aspectRatio null) so a wordmark is scaled, never cropped.
    expect(responsive?.srcset).not.toContain('fit=cover')
  })

  it('rebuilds every candidate with the refreshed token after a rotation', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 401 }))
    mocks.handleAuthFailure.mockImplementation(() => {
      mocks.token = 'token-refreshed'
      return Promise.resolve(true)
    })
    const { handleResponsiveSrcsetError } = useAssetUrl()

    const responsive = await handleResponsiveSrcsetError(
      '/directus/assets/file-1?access_token=expired&width=240',
      'file-1',
      [120, 240],
      null,
    )

    expect(mocks.handleAuthFailure).toHaveBeenCalledOnce()
    const candidates = (responsive?.srcset ?? '').split(', ')
    expect(candidates).toHaveLength(2)
    for (const candidate of candidates) {
      expect(candidate).toContain('access_token=token-refreshed')
      expect(candidate).toContain('asset_retry=123456')
    }
  })

  it('does not rebuild a srcset whose asset is genuinely gone', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response(null, { status: 403 }))
    const { handleResponsiveSrcsetError } = useAssetUrl()

    const responsive = await handleResponsiveSrcsetError('/directus/assets/x?width=120', 'x', [120], null)

    expect(responsive).toBeNull()
    expect(mocks.handleAuthFailure).not.toHaveBeenCalled()
  })
})
