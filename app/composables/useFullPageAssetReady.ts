import type { Ref } from 'vue'

interface UseFullPageAssetReadyOptions {
  imageSrc: string
  fontFamily?: string | null
}

export function useFullPageAssetReady(
  options: UseFullPageAssetReadyOptions,
): { isReady: Ref<boolean> } {
  const { imageSrc, fontFamily = null } = options

  const isImageLoaded = ref(false)
  const isFontReady = ref(fontFamily === null)

  const isReady = computed(() => isImageLoaded.value && isFontReady.value)

  const markImageLoaded = () => {
    isImageLoaded.value = true
  }

  onMounted(async () => {
    if (import.meta.client && typeof Image !== 'undefined') {
      const preloader = new Image()
      preloader.onload = markImageLoaded
      preloader.onerror = markImageLoaded
      preloader.src = imageSrc
      if (preloader.complete) {
        markImageLoaded()
      }
    } else {
      markImageLoaded()
    }

    if (
      fontFamily
      && import.meta.client
      && typeof document !== 'undefined'
      && document.fonts?.load
    ) {
      await tryCatch(document.fonts.load(`1em ${fontFamily}`))
      isFontReady.value = true
    }
  })

  return { isReady }
}
