import type { Ref } from 'vue'
import type { ResponsiveAssetUrl } from '~/composables/useAssetUrl'

/** Section-panel and picker thumbnails (the 30px plate at up to 2x DPR). */
export const LOGO_THUMB_WIDTH = 56
/** The manufacturers list plate, which is wider than the shared thumb. */
export const LOGO_PLATE_WIDTH = 84
/** The association drawer's 150px detail logo. */
export const LOGO_DETAIL_WIDTH = 150

interface AssetImageRowOptions {
  /** Where the STABLE Directus file id lives on the row (never a built URL). */
  fileIdKey: string
  width: number
  height?: number | null
  /** Transient fields the built URLs are written to. */
  srcKey?: string
  srcsetKey?: string
  /** Transient flag set once the row's image has actually painted. */
  loadedKey?: string
}

interface AssetImageSourceOptions {
  /** 1x/2x mode: the rendered width. Ignored when `widths` is given. */
  width?: number
  height?: number | null
  /** Width-descriptor mode: every candidate width the `sizes` attribute can pick. */
  widths?: number[]
  /** height/width for the candidates; `null` scales proportionally (logos). */
  aspectRatio?: number | null
}

interface AssetImageRowMethods {
  hydrateAssetImages: (rows: Record<string, any>[]) => Promise<void>
  clearAssetImages: (rows: Record<string, any>[]) => void
  handleAssetImageLoad: (row: Record<string, any>) => void
  handleAssetImageError: (row: Record<string, any>, event: Event) => Promise<void>
}

interface AssetImageSourceMethods {
  assetSrc: Ref<string | null>
  assetSrcset: Ref<string | null>
  refreshAssetSource: () => Promise<void>
  handleAssetError: (event: Event) => Promise<void>
}

function getFailedUrl(event: Event, fallback: string | null): string {
  // Read synchronously: `currentTarget` is null once the handler awaits. The
  // browser reports the candidate it actually chose, which is the URL whose
  // token has to be probed.
  const image = event.currentTarget as HTMLImageElement | null
  return image?.currentSrc || image?.src || fallback || ''
}

/**
 * Build and recover logo URLs across a collection of rows.
 * @param options - where the file id is, and the size the image renders at
 */
export function useAssetImageRows(options: AssetImageRowOptions): AssetImageRowMethods {
  const { getResponsiveUrl, handleResponsiveUrlError } = useAssetUrl()

  const srcKey = options.srcKey ?? '_logoSrc'
  const srcsetKey = options.srcsetKey ?? '_logoSrcset'
  const loadedKey = options.loadedKey ?? '_logoLoaded'
  const height = options.height ?? null

  // Keyed by the row OBJECT, not the file id: two rows sharing one logo each
  // get their own attempt, and a refetch (new objects) starts clean.
  const recoveredRows = new WeakSet<object>()

  async function hydrateAssetImages(rows: Record<string, any>[]): Promise<void> {
    await Promise.all(rows.map(async (row) => {
      const responsive = await getResponsiveUrl(row[options.fileIdKey] ?? null, options.width, height)
      row[srcKey] = responsive?.src ?? null
      row[srcsetKey] = responsive?.srcset ?? null
      // A fresh URL has painted nothing yet — callers that show a loader read
      // this alongside the src (src set + not loaded = still on its way in).
      row[loadedKey] = false
    }))
  }

  /**
   * Drop the built URLs, keeping the file ids — for state restored from a cache
   * that predates the current token.
   */
  function clearAssetImages(rows: Record<string, any>[]): void {
    for (const row of rows) {
      row[srcKey] = null
      row[srcsetKey] = null
      row[loadedKey] = false
    }
  }

  /** The row's image painted — retires whatever the caller shows while waiting. */
  function handleAssetImageLoad(row: Record<string, any>): void {
    row[loadedKey] = true
  }

  async function handleAssetImageError(row: Record<string, any>, event: Event): Promise<void> {
    const fileId = row[options.fileIdKey] ?? null
    const failedUrl = getFailedUrl(event, row[srcKey] ?? null)

    // Show the placeholder while the retry is in flight, so the broken-image
    // icon is never on screen — and stays the final state if recovery fails.
    row[srcKey] = null
    row[srcsetKey] = null
    row[loadedKey] = false

    if (!fileId || recoveredRows.has(row)) { return }
    recoveredRows.add(row)

    const responsive = await handleResponsiveUrlError(failedUrl, fileId, options.width, height)
    row[srcKey] = responsive?.src ?? null
    row[srcsetKey] = responsive?.srcset ?? null
  }

  return { hydrateAssetImages, clearAssetImages, handleAssetImageLoad, handleAssetImageError }
}

/**
 * Build and recover a single image that tracks one file id.
 * @param fileId - the record's current logo/avatar file id, null when it has none
 * @param options - srcset candidates (`widths`) or a single rendered `width`
 */
export function useAssetImageSource(
  fileId: Ref<string | null | undefined>,
  options: AssetImageSourceOptions,
): AssetImageSourceMethods {
  const {
    getResponsiveUrl,
    getResponsiveSrcset,
    handleResponsiveUrlError,
    handleResponsiveSrcsetError,
  } = useAssetUrl()

  const assetSrc = ref<string | null>(null)
  const assetSrcset = ref<string | null>(null)
  let hasRecovered = false

  const isSrcsetMode = Array.isArray(options.widths)
  const width = options.width ?? 0
  const height = options.height ?? null
  const aspectRatio = options.aspectRatio ?? null

  function buildSource(id: string | null): Promise<ResponsiveAssetUrl | null> {
    return isSrcsetMode
      ? getResponsiveSrcset(id, options.widths as number[], aspectRatio)
      : getResponsiveUrl(id, width, height)
  }

  function rebuildSource(failedUrl: string, id: string): Promise<ResponsiveAssetUrl | null> {
    return isSrcsetMode
      ? handleResponsiveSrcsetError(failedUrl, id, options.widths as number[], aspectRatio)
      : handleResponsiveUrlError(failedUrl, id, width, height)
  }

  async function refreshAssetSource(): Promise<void> {
    const responsive = await buildSource(fileId.value ?? null)
    assetSrc.value = responsive?.src ?? null
    assetSrcset.value = responsive?.srcset ?? null
  }

  watch(fileId, async () => {
    // A different file is a different image: it earns its own retry.
    hasRecovered = false
    await refreshAssetSource()
  }, { immediate: true })

  async function handleAssetError(event: Event): Promise<void> {
    const id = fileId.value ?? null
    const failedUrl = getFailedUrl(event, assetSrc.value)

    // Placeholder first, so nothing broken is ever on screen.
    assetSrc.value = null
    assetSrcset.value = null

    if (!id || hasRecovered) { return }
    hasRecovered = true

    const responsive = await rebuildSource(failedUrl, id)
    assetSrc.value = responsive?.src ?? null
    assetSrcset.value = responsive?.srcset ?? null
  }

  return { assetSrc, assetSrcset, refreshAssetSource, handleAssetError }
}
