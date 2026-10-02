import { useNavigationStore } from '~/stores/navigation'

/**
 * Sidebar dimensions used by the swipe gesture math.
 * SIDEBAR_WIDTH must match the open width in AppSideNav.vue's CSS (.app-side-nav width).
 */
export const SIDEBAR_WIDTH = 224
const EDGE_ZONE = 24
const SWIPE_LOCK_THRESHOLD = 10

/**
 * Edge-swipe-to-open / backdrop-swipe-to-close gesture for the mobile sidebar.
 *
 * Tracks a single touch from start to release, locks horizontal vs. vertical
 * intent after a small movement, and drives `navStore.dragOffset` so the
 * sidebar width follows the finger live. On release, snaps open or closed
 * based on which side of the midpoint the offset finished on.
 */
export function useSidebarSwipe() {
  const navStore = useNavigationStore()

  let swipeStartX = 0
  let swipeStartY = 0
  let swipeTracking = false
  let swipeLocked = false
  let swipeMode: 'open' | 'close' | null = null

  function handleSwipeStart(event: TouchEvent) {
    if (!navStore.isMobile || navStore.dragOffset !== null) return

    const touch = event.touches[0]
    swipeStartX = touch.clientX
    swipeStartY = touch.clientY
    swipeLocked = false

    if (navStore.isCollapsed && touch.clientX <= EDGE_ZONE) {
      swipeTracking = true
      swipeMode = 'open'
    } else if (!navStore.isCollapsed && touch.clientX > SIDEBAR_WIDTH) {
      swipeTracking = true
      swipeMode = 'close'
    } else {
      swipeTracking = false
      swipeMode = null
    }
  }

  function handleSwipeMove(event: TouchEvent) {
    if (!swipeTracking) return

    const touch = event.touches[0]
    const deltaX = touch.clientX - swipeStartX
    const deltaY = touch.clientY - swipeStartY

    if (!swipeLocked) {
      if (Math.abs(deltaX) < SWIPE_LOCK_THRESHOLD && Math.abs(deltaY) < SWIPE_LOCK_THRESHOLD) {
        return
      }
      if (Math.abs(deltaY) > Math.abs(deltaX)) {
        swipeTracking = false
        swipeMode = null
        return
      }
      swipeLocked = true
      navStore.setDragOffset(swipeMode === 'open' ? 0 : SIDEBAR_WIDTH)
    }

    event.preventDefault()

    if (swipeMode === 'open') {
      navStore.setDragOffset(Math.max(0, Math.min(SIDEBAR_WIDTH, deltaX)))
    } else if (swipeMode === 'close') {
      navStore.setDragOffset(Math.max(0, Math.min(SIDEBAR_WIDTH, SIDEBAR_WIDTH + deltaX)))
    }
  }

  function handleSwipeEnd() {
    if (!swipeTracking || !swipeLocked) {
      swipeTracking = false
      swipeMode = null
      return
    }

    const shouldOpen = navStore.dragOffset !== null && navStore.dragOffset > SIDEBAR_WIDTH / 2
    navStore.isCollapsed = !shouldOpen
    navStore.endDrag()
    swipeTracking = false
    swipeLocked = false
    swipeMode = null
  }

  onMounted(() => {
    document.addEventListener('touchstart', handleSwipeStart, { passive: true })
    document.addEventListener('touchmove', handleSwipeMove, { passive: false })
    document.addEventListener('touchend', handleSwipeEnd)
    document.addEventListener('touchcancel', handleSwipeEnd)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('touchstart', handleSwipeStart)
    document.removeEventListener('touchmove', handleSwipeMove)
    document.removeEventListener('touchend', handleSwipeEnd)
    document.removeEventListener('touchcancel', handleSwipeEnd)
  })
}
