import { BREAKPOINT_TABLET, BREAKPOINT_DESKTOP } from '~/utils/breakpoints'
import { useNavigationStore } from '~/stores/navigation'

/**
 * Wires the sidebar's collapsed/mobile state to viewport-width media queries.
 *
 * - Desktop (≥1440px): expanded by default; below desktop on non-mobile, collapsed.
 * - Tablet boundary (768px): below this, switches to mobile mode (overlay).
 *
 * Initial state is applied synchronously on mount by invoking the change
 * handlers with the MediaQueryList itself (it shares the `.matches` shape).
 */
export function useSidebarBreakpoints() {
  const navStore = useNavigationStore()

  let tabletQuery: MediaQueryList | null = null
  let desktopQuery: MediaQueryList | null = null
  let handleChange: (() => void) | null = null

  onMounted(() => {
    // Re-derive the full responsive state whenever either boundary is crossed —
    // one shared handler so mobile (768) and desktop (1440) can't fall out of sync.
    handleChange = () => navStore.resolveResponsiveState()
    tabletQuery = window.matchMedia(`(min-width: ${BREAKPOINT_TABLET})`)
    desktopQuery = window.matchMedia(`(min-width: ${BREAKPOINT_DESKTOP})`)
    handleChange()
    tabletQuery.addEventListener('change', handleChange)
    desktopQuery.addEventListener('change', handleChange)
  })

  onBeforeUnmount(() => {
    if (handleChange) {
      tabletQuery?.removeEventListener('change', handleChange)
      desktopQuery?.removeEventListener('change', handleChange)
    }
  })
}
