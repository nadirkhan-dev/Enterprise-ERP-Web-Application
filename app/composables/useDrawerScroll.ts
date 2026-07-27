import type { Ref, ComputedRef } from 'vue'

/**
 * Detects whether a PrimeVue Drawer's content area is scrollable
 * and whether the user has scrolled to the bottom.
 */
export function useDrawerScroll(
  contentRef: Ref<HTMLElement | null>,
  visibleRef: Ref<boolean>,
): {
  isScrollable: Ref<boolean>
  isScrolledToBottom: Ref<boolean>
  showFooterShadow: ComputedRef<boolean>
  showHeaderShadow: ComputedRef<boolean>
} {
  const isScrollable = ref(false)
  const isScrolledToTop = ref(true)
  const isScrolledToBottom = ref(false)
  let resizeObserver: ResizeObserver | null = null
  let scrollContainer: HTMLElement | null = null

  function getScrollContainer(): HTMLElement | null {
    return contentRef.value?.closest('.p-drawer-content') ?? null
  }

  function checkScroll(): void {
    const container = scrollContainer || getScrollContainer()
    if (!container) { return }

    isScrollable.value = container.scrollHeight > container.clientHeight
    isScrolledToTop.value = container.scrollTop <= 0
    isScrolledToBottom.value =
      container.scrollTop + container.clientHeight >= container.scrollHeight - 1
  }

  function onScroll(): void {
    checkScroll()
  }

  function setup(): void {
    cleanup()

    scrollContainer = getScrollContainer()
    if (!scrollContainer) { return }

    resizeObserver = new ResizeObserver(checkScroll)
    resizeObserver.observe(scrollContainer)

    scrollContainer.addEventListener('scroll', onScroll, { passive: true })

    checkScroll()
  }

  function cleanup(): void {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', onScroll)
      scrollContainer = null
    }
  }

  function lockBodyScroll(): void {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarWidth}px`
  }

  function unlockBodyScroll(): void {
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  }

  watch(visibleRef, (isVisible: boolean) => {
    if (isVisible) {
      lockBodyScroll()
      nextTick(setup)
    } else {
      cleanup()
      unlockBodyScroll()
      isScrollable.value = false
      isScrolledToTop.value = true
      isScrolledToBottom.value = false
    }
  })

  onUnmounted(() => {
    cleanup()
    unlockBodyScroll()
  })

  const showFooterShadow = computed(() => isScrollable.value && !isScrolledToBottom.value)
  const showHeaderShadow = computed(() => isScrollable.value && !isScrolledToTop.value)

  return { isScrollable, isScrolledToBottom, showFooterShadow, showHeaderShadow }
}
