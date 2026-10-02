import { BREAKPOINT_TABLET, BREAKPOINT_DESKTOP } from '~/utils/breakpoints'

interface NavigationState {
  isCollapsed: boolean
  isMobile: boolean
  activeRoute: string
  expandedGroups: string[]
  dragOffset: number | null
}

const ROUTE_TO_GROUP: Record<string, string> = {
  '/items': 'inventory',
  '/manufacturers': 'inventory',
  '/customers': 'sales',
  '/quotes': 'sales',
  '/orders': 'sales',
  '/shipments': 'sales',
  '/invoices': 'sales',
  '/suppliers': 'procurement',
  '/procurement/purchase-orders': 'procurement',
  '/tools': 'tools',
}

function getParentGroupKey(path: string): string | null {
  const matchedRoute = Object.keys(ROUTE_TO_GROUP)
    .sort((a, b) => b.length - a.length)
    .find((route) => path.startsWith(route))
  return matchedRoute ? ROUTE_TO_GROUP[matchedRoute] : null
}

export const useNavigationStore = defineStore('navigation', {
  state: (): NavigationState => ({
    isCollapsed: false,
    isMobile: false,
    activeRoute: '/',
    expandedGroups: [],
    dragOffset: null,
  }),
  actions: {
    toggleSidebar() {
      this.isCollapsed = !this.isCollapsed
    },
    setDragOffset(value: number) {
      this.dragOffset = value
    },
    endDrag() {
      this.dragOffset = null
    },
    setMobile(isMobileValue: boolean) {
      this.isMobile = isMobileValue
      if (isMobileValue) {
        this.isCollapsed = true
      }
    },
    /**
     * Derive isMobile / isCollapsed from the LIVE viewport — the single source of
     * truth for the sidebar's responsive width. Called at bootstrap (the client
     * plugin), whenever the app shell (default layout) mounts or re-mounts once
     * auth becomes ready, and on every matchMedia change (useSidebarBreakpoints).
     * Client-only and idempotent, so any of those entry points can call it without
     * a seed-then-correct race leaving the expanded 224px default (which squeezes
     * the content). See app/plugins/sidebar-breakpoints.client.ts for the rationale.
     */
    resolveResponsiveState() {
      if (typeof window === 'undefined') { return }
      const isTablet = window.matchMedia(`(min-width: ${BREAKPOINT_TABLET})`).matches
      const isDesktop = window.matchMedia(`(min-width: ${BREAKPOINT_DESKTOP})`).matches
      const isMobile = !isTablet
      this.isMobile = isMobile
      // Mobile → overlay (collapsed). Non-mobile → collapsed below the desktop
      // breakpoint, expanded at/above it.
      this.isCollapsed = isMobile ? true : !isDesktop
    },
    setActiveRoute(path: string) {
      this.activeRoute = path
      const groupKey = getParentGroupKey(path)
      if (groupKey && !this.expandedGroups.includes(groupKey)) {
        this.expandedGroups = [groupKey]
      }
      if (this.isMobile) {
        this.isCollapsed = true
      }
    },
    setExpandedGroups(groups: string[]) {
      this.expandedGroups = groups
    },
    toggleGroup(key: string) {
      const idx = this.expandedGroups.indexOf(key)
      idx === -1
        ? this.expandedGroups.push(key)
        : this.expandedGroups.splice(idx, 1)
    },
  },
  getters: {
    sidebarWidth: (state): string => {
      if (state.isMobile) {return '0px'}
      return state.isCollapsed ? '64px' : '224px'
    },
    isGroupExpanded: (state): ((key: string) => boolean) => (key: string) => state.expandedGroups.includes(key),
    isRouteActive: (state): ((itemRoute: string) => boolean) => (itemRoute: string) => {
      if (itemRoute === '/') { return state.activeRoute === '/' }
      return state.activeRoute === itemRoute || state.activeRoute.startsWith(`${itemRoute}/`)
    },
  },
})
