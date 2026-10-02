import type { Ref } from 'vue'

const DEFAULT_DELAY_MS = 600

/**
 * Defers showing a loading indicator until a delay has passed.
 * If loading completes before the delay, the loader is never shown,
 * avoiding a flickering effect on fast loads.
 *
 * @param isLoading - Reactive ref that tracks the actual loading state
 * @param delayMs - Milliseconds to wait before showing the loader (default: 600)
 * @returns showLoader - Ref that is true only when loading has lasted longer than the delay
 */
export function useDeferredLoading(
  isLoading: Ref<boolean>,
  delayMs: number = DEFAULT_DELAY_MS,
): { showLoader: Ref<boolean> } {
  const showLoader = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  watch(isLoading, (loading) => {
    if (loading) {
      clearTimer()
      timer = setTimeout(() => {
        if (isLoading.value) {
          showLoader.value = true
        }
        timer = null
      }, delayMs)
    } else {
      clearTimer()
      showLoader.value = false
    }
  }, { immediate: true })

  onBeforeUnmount(() => {
    clearTimer()
  })

  return { showLoader }
}
