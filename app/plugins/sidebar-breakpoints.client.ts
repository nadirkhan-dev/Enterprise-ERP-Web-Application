import { useNavigationStore } from '~/stores/navigation'

/**
 * Resolve the sidebar's mobile/collapsed state from the viewport BEFORE the first
 * paint, so the app layout's `margin-left: sidebarWidth` is correct immediately.
 *
 * Without this, the store's defaults (`isMobile: false`, `isCollapsed: false`)
 * make `sidebarWidth` start at the expanded 224px, squeezing the content until
 * something corrects it — a visible layout shift on every load below 1440px.
 *
 * Client plugins run before the app mounts, so seeding it here lands the right
 * width on the first render. The default layout re-asserts it whenever the shell
 * (re)mounts after auth, and `useSidebarBreakpoints` attaches the live
 * `matchMedia` listeners for subsequent viewport changes — all three share the
 * store's `resolveResponsiveState` so the logic can't drift.
 */
export default defineNuxtPlugin(() => {
  useNavigationStore().resolveResponsiveState()
})
