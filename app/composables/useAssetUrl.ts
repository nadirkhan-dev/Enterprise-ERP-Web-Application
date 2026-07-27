// ProfileCard avatar renders at 120px (mobile) / 150px (desktop, ≥768px), so the
// logo needs those widths at 1x and 2x DPR. The matching `sizes` attribute on
// each <img> is `(min-width: 768px) 150px, 120px` — keep both in sync with
// ProfileCard's `--profile-avatar-size` breakpoints.
export const PROFILE_AVATAR_WIDTHS = [120, 150, 240, 300]

/**
 * Composable for building authenticated Directus asset URLs
 * with optional image-transform support for responsive srcset.
 */
export function useAssetUrl(): {
  getAssetUrl: (fileId: string | null, transforms?: Record<string, string | number>) => Promise<string | null>
  getResponsiveUrl: (fileId: string | null, width: number, height?: number | null) => Promise<{ src: string; srcset: string } | null>
  getResponsiveSrcset: (fileId: string | null, widths: number[], aspectRatio?: number) => Promise<{ src: string; srcset: string } | null>
} {
  const directus = useDirectus()

  /**
   * Build an authenticated asset URL for a Directus file.
   */
  async function getAssetUrl(fileId: string | null, transforms: Record<string, string | number> = {}): Promise<string | null> {
    if (!fileId) {return null}
    const token = await directus.getToken()
    const params = new URLSearchParams()
    if (token) {
      params.set('access_token', token)
    }
    for (const [key, value] of Object.entries(transforms)) {
      params.set(key, String(value))
    }
    const query = params.toString()
    return `/directus/assets/${fileId}${query ? `?${query}` : ''}`
  }

  /**
   * Build src and srcset URLs with 1x and 2x variants for a Directus image.
   */
  async function getResponsiveUrl(fileId: string | null, width: number, height: number | null = null): Promise<{ src: string; srcset: string } | null> {
    if (!fileId) {return null}

    const baseTransforms: Record<string, string | number> = { width, fit: 'cover', quality: 80, format: 'auto' }
    const retinaTransforms: Record<string, string | number> = { width: width * 2, fit: 'cover', quality: 80, format: 'auto' }

    if (height) {
      baseTransforms.height = height
      retinaTransforms.height = height * 2
    }

    const [url1x, url2x] = await Promise.all([
      getAssetUrl(fileId, baseTransforms),
      getAssetUrl(fileId, retinaTransforms),
    ])

    return {
      src: url1x as string,
      srcset: `${url1x} 1x, ${url2x} 2x`,
    }
  }

  /**
   * Build a width-descriptor srcset (e.g. `url 120w, url 240w`) for a fluid
   * image whose rendered width varies by breakpoint. Pair with a `sizes`
   * attribute that states the rendered width per breakpoint so the browser
   * fetches the right candidate (rendered width × DPR). `aspectRatio` is
   * height/width (1 = square, the default).
   */
  async function getResponsiveSrcset(
    fileId: string | null,
    widths: number[],
    aspectRatio = 1,
  ): Promise<{ src: string; srcset: string } | null> {
    if (!fileId) {return null}

    const sortedWidths = [...new Set(widths)].sort((a, b) => a - b)
    const urls = await Promise.all(
      sortedWidths.map((width) =>
        getAssetUrl(fileId, {
          width,
          height: Math.round(width * aspectRatio),
          fit: 'cover',
          quality: 80,
          format: 'auto',
        }),
      ),
    )

    return {
      // Largest variant as the plain `src` fallback for no-srcset browsers.
      src: urls[urls.length - 1] as string,
      srcset: sortedWidths.map((width, index) => `${urls[index]} ${width}w`).join(', '),
    }
  }

  return { getAssetUrl, getResponsiveUrl, getResponsiveSrcset }
}
