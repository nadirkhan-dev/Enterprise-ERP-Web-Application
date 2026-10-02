/**
 * Tracks whether the page has scrolled past a threshold and exposes a smooth
 * scroll-to-top handler. Used by the sidebar to surface its scroll-to-top
 * button only when the user has scrolled meaningfully.
 *
 * The button is also gated on the page being genuinely scrollable beyond the
 * threshold — without this gate, mobile Safari's URL-bar collapse and
 * rubber-band overscroll briefly push scrollY past the threshold even when
 * there's no real content to scroll, causing the button to flicker.
 *
 * @param threshold pixels of scrollY past which `showScrollTop` becomes true
 */
export function usePageScrollTop(threshold: number = 300) {
  const showScrollTop = ref(false)
  let handlePageScroll: (() => void) | null = null
  let handleViewportResize: (() => void) | null = null
  let contentObserver: ResizeObserver | null = null

  function getIsPageScrollable() {
    const scrollableHeight =
      document.documentElement.scrollHeight - window.innerHeight
    return scrollableHeight > threshold
  }

  function updateScrollTopVisibility() {
    if (!getIsPageScrollable()) {
      showScrollTop.value = false
      return
    }
    showScrollTop.value = window.scrollY > threshold
  }

  onMounted(() => {
    handlePageScroll = updateScrollTopVisibility
    handleViewportResize = updateScrollTopVisibility
    updateScrollTopVisibility()
    window.addEventListener('scroll', handlePageScroll, { passive: true })
    window.addEventListener('resize', handleViewportResize)

    if (typeof ResizeObserver !== 'undefined') {
      contentObserver = new ResizeObserver(updateScrollTopVisibility)
      contentObserver.observe(document.documentElement)
    }
  })

  onBeforeUnmount(() => {
    if (handlePageScroll) {
      window.removeEventListener('scroll', handlePageScroll)
      handlePageScroll = null
    }
    if (handleViewportResize) {
      window.removeEventListener('resize', handleViewportResize)
      handleViewportResize = null
    }
    if (contentObserver) {
      contentObserver.disconnect()
      contentObserver = null
    }
  })

  function handleScrollTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return { showScrollTop, handleScrollTop }
}
