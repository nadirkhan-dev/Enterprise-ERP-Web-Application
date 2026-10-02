import { handleAuthFailure } from '~/composables/useSessionExpiry'
import { useDirectus } from '~/composables/useDirectus'

// ProfileCard avatar renders at 120px (mobile) / 150px (desktop, ≥768px), so the
// logo needs those widths at 1x and 2x DPR. The matching `sizes` attribute on
// each <img> is `(min-width: 768px) 150px, 120px` — keep both in sync with
// ProfileCard's `--profile-avatar-size` breakpoints.
export const PROFILE_AVATAR_WIDTHS = [120, 150, 240, 300]

export interface ResponsiveAssetUrl {
  src: string
  srcset: string
}

interface AssetUrlMethods {
  getAssetUrl: (fileId: string | null, transforms?: Record<string, string | number>) => Promise<string | null>
  getResponsiveUrl: (fileId: string | null, width: number, height?: number | null) => Promise<ResponsiveAssetUrl | null>
  getResponsiveSrcset: (fileId: string | null, widths: number[], aspectRatio?: number | null) => Promise<ResponsiveAssetUrl | null>
  handleResponsiveUrlError: (failedUrl: string, fileId: string | null, width: number, height?: number | null) => Promise<ResponsiveAssetUrl | null>
  handleResponsiveSrcsetError: (failedUrl: string, fileId: string | null, widths: number[], aspectRatio?: number | null) => Promise<ResponsiveAssetUrl | null>
}

/**
 * Composable for building authenticated Directus asset URLs
 * with optional image-transform support for responsive srcset.
 */
export function useAssetUrl(): AssetUrlMethods {
  const directus = useDirectus()

  /**
   * Build an authenticated asset URL for a Directus file.
   */
  async function buildAssetUrl(
    fileId: string | null,
    transforms: Record<string, string | number> = {},
    cacheBust: number | null = null,
  ): Promise<string | null> {
    if (!fileId) {return null}
    const token = await directus.getToken()
    const params = new URLSearchParams()
    if (token) {
      params.set('access_token', token)
    }
    for (const [key, value] of Object.entries(transforms)) {
      params.set(key, String(value))
    }
    if (cacheBust !== null) {
      params.set('asset_retry', String(cacheBust))
    }
    const query = params.toString()
    return `/directus/assets/${fileId}${query ? `?${query}` : ''}`
  }

  function getAssetUrl(fileId: string | null, transforms: Record<string, string | number> = {}): Promise<string | null> {
    return buildAssetUrl(fileId, transforms)
  }

  async function buildResponsiveUrl(
    fileId: string | null,
    width: number,
    height: number | null,
    cacheBust: number | null = null,
  ): Promise<ResponsiveAssetUrl | null> {
    if (!fileId) {return null}

    const baseTransforms: Record<string, string | number> = { width, fit: 'cover', quality: 80, format: 'auto' }
    const retinaTransforms: Record<string, string | number> = { width: width * 2, fit: 'cover', quality: 80, format: 'auto' }

    if (height) {
      baseTransforms.height = height
      retinaTransforms.height = height * 2
    }

    const [url1x, url2x] = await Promise.all([
      buildAssetUrl(fileId, baseTransforms, cacheBust),
      buildAssetUrl(fileId, retinaTransforms, cacheBust),
    ])

    return {
      src: url1x as string,
      srcset: `${url1x} 1x, ${url2x} 2x`,
    }
  }

  /**
   * Build src and srcset URLs with 1x and 2x variants for a Directus image.
   */
  function getResponsiveUrl(fileId: string | null, width: number, height: number | null = null): Promise<ResponsiveAssetUrl | null> {
    return buildResponsiveUrl(fileId, width, height)
  }

  async function canRebuildFailedAsset(failedUrl: string, fileId: string | null): Promise<boolean> {
    if (!failedUrl || !fileId) {return false}

    const { data: response, error } = await tryCatch(fetch(failedUrl, { cache: 'no-store' }))
    if (error || !response) {return false}

    if (response.status === 401) {
      return handleAuthFailure()
    }

    return response.ok
  }
  async function handleResponsiveUrlError(
    failedUrl: string,
    fileId: string | null,
    width: number,
    height: number | null = null,
  ): Promise<ResponsiveAssetUrl | null> {
    if (!await canRebuildFailedAsset(failedUrl, fileId)) {return null}

    return buildResponsiveUrl(fileId, width, height, Date.now())
  }
  async function handleResponsiveSrcsetError(
    failedUrl: string,
    fileId: string | null,
    widths: number[],
    aspectRatio: number | null = null,
  ): Promise<ResponsiveAssetUrl | null> {
    if (!await canRebuildFailedAsset(failedUrl, fileId)) {return null}

    return buildResponsiveSrcset(fileId, widths, aspectRatio, Date.now())
  }

  async function buildResponsiveSrcset(
    fileId: string | null,
    widths: number[],
    aspectRatio: number | null = 1,
    cacheBust: number | null = null,
  ): Promise<ResponsiveAssetUrl | null> {
    if (!fileId) {return null}

    const sortedWidths = [...new Set(widths)].sort((a, b) => a - b)
    const urls = await Promise.all(
      sortedWidths.map((width) =>
        buildAssetUrl(fileId, {
          width,
          ...(aspectRatio === null
            ? {}
            : { height: Math.round(width * aspectRatio), fit: 'cover' }),
          quality: 80,
          format: 'auto',
        }, cacheBust),
      ),
    )

    return {
      // Largest variant as the plain `src` fallback for no-srcset browsers.
      src: urls[urls.length - 1] as string,
      srcset: sortedWidths.map((width, index) => `${urls[index]} ${width}w`).join(', '),
    }
  }

  function getResponsiveSrcset(
    fileId: string | null,
    widths: number[],
    aspectRatio: number | null = 1,
  ): Promise<ResponsiveAssetUrl | null> {
    return buildResponsiveSrcset(fileId, widths, aspectRatio)
  }

  return {
    getAssetUrl,
    getResponsiveUrl,
    getResponsiveSrcset,
    handleResponsiveUrlError,
    handleResponsiveSrcsetError,
  }
}
