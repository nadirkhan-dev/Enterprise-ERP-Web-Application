<script setup lang="ts">
import { useNavigationStore } from '~/stores/navigation'
import { useAuthStore } from '~/stores/auth'
import { useLocationStore } from '~/stores/location'
import { useReferenceDataSync } from '~/composables/useReferenceDataSync'
import { useDeployNotification } from '~/composables/useDeployNotification'

const navStore = useNavigationStore()
const authStore = useAuthStore()
const locationStore = useLocationStore()
const toast = useToast()
const { startSync, stopSync } = useReferenceDataSync()
const { startListening: startDeployWatch, stopListening: stopDeployWatch } = useDeployNotification()

const isPostLoginFade = ref(false)
// The below-the-top-nav offset on mobile lives in toast.css (.p-toast), shared
// with every other toast group — this only tags the root for the group's own
// transparent-card styling.
const crossScopeToastPt = { root: { class: 'search-scope-results-toast-group' } }

function isCrossScopeToast(message: any): boolean {
  return message?.data?.kind === 'cross-scope-results'
}

function isNoResultsToast(message: any): boolean {
  return message?.data?.kind === 'no-results'
}

function viewCrossScopeResults(message: any): void {
  const data = message?.data
  if (!data?.path || !data?.query) { return }

  toast.remove(message)
  navigateTo({ path: data.path, query: data.query })
}

// The app shell's width is driven by navStore.sidebarWidth (margin-left below).
// The bootstrap client plugin seeds it, but the shell is gated on `authReady` and
// the live matchMedia listeners only attach in AppSideNav.onMounted — so a login
// that flips `authReady` can mount the shell against stale/default state (the
// expanded 224px), squeezing the content. Re-derive from the live viewport as the
// shell (re)mounts, before it paints, so the width is always correct on first paint.
if (import.meta.client) {
  watch(
    () => authStore.authReady,
    (ready) => {
      if (ready) { navStore.resolveResponsiveState() }
    },
    { immediate: true },
  )
}

if (import.meta.client) {
  watch(
    () => authStore.authReady,
    (ready) => {
      if (ready && sessionStorage.getItem('auth:fadeIn') === '1') {
        sessionStorage.removeItem('auth:fadeIn')
        isPostLoginFade.value = true
        // Suppress scrollbars while the entrance animation runs — the
        // transient scale/translateY transforms can briefly push content
        // past the viewport on short pages (e.g. under-construction, 404),
        // causing a scrollbar to flicker in and shift the layout.
        const previousHtmlOverflow = document.documentElement.style.overflow
        const previousBodyOverflow = document.body.style.overflow
        document.documentElement.style.overflow = 'hidden'
        document.body.style.overflow = 'hidden'
        setTimeout(() => {
          isPostLoginFade.value = false
          document.documentElement.style.overflow = previousHtmlOverflow
          document.body.style.overflow = previousBodyOverflow
        }, 700)
      }
    },
    { immediate: true },
  )
}

if (import.meta.client) {
  watch(
    () => authStore.isAuthenticated,
    (authenticated) => {
      if (authenticated) {
        startSync()
      } else {
        stopSync()
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stopSync()
  })
}

// Ask for the user's location once they're in the app, so address autocomplete
// can rank nearby matches first. Best-effort: a friendly toast explains the
// benefit just before the native prompt, and every denial/failure degrades to
// the existing unbiased search without blocking anything.
if (import.meta.client) {
  // Keep the sharing toggle in sync with the live browser permission (and react
  // when the user later un/blocks the site in their browser settings).
  locationStore.syncPermission()
  watch(
    () => authStore.isAuthenticated,
    async (authenticated) => {
      if (!authenticated || locationStore.hasRequested) {
        return
      }
      // Only explain ourselves when a prompt will actually appear — an
      // already-granted or already-denied permission shows nothing to react to.
      const permission = await locationStore.readPermissionState()
      if (permission === null || permission === 'prompt') {
        toast.add({
          severity: 'info',
          summary: 'Improve address search',
          detail: 'Allow location access and we’ll surface the closest matching addresses first. You can decline — search still works everywhere.',
          life: 7000,
        })
      }
      locationStore.requestLocation()
    },
    { immediate: true },
  )
}

// Deploy notification — SSE-based, independent of WebSocket sync
if (import.meta.client) {
  watch(
    () => authStore.isAuthenticated,
    (authenticated) => {
      if (authenticated) {
        startDeployWatch()
      } else {
        stopDeployWatch()
      }
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    stopDeployWatch()
  })
}

// ── Overlay page scrollbar ───────────────────────────────────────────────────
// A custom bar synced to the window scroll. It's fixed and floats over the
// content, starting below the top nav, so it reserves no layout width — the
// native page scrollbar is hidden globally (main.css) so it can't shrink the
// viewport and push the nav/content leftward. The thumb shows only while the
// page overflows.

// Per-user preference (auth store): when false, hide every scrollbar in the app.
// The overlay below is gated with v-if, and a class on <html> kills the native /
// thin scrollbars everywhere — including PrimeVue overlays teleported to <body>.
const showPageScrollbar = computed(() => authStore.showPageScrollbar)

if (import.meta.client) {
  watch(
    showPageScrollbar,
    (isVisible) => {
      document.documentElement.classList.toggle('app-hide-scrollbars', !isVisible)
    },
    { immediate: true },
  )
}

// Floor on the thumb so it stays grabbable on very long pages.
const MIN_THUMB_PX = 24

const pageScrollbarTrackRef = ref<HTMLElement | null>(null)
const pageScrollbarThumbHeight = ref(0)
const pageScrollbarThumbOffset = ref(0)
const isPageScrollbarOverflowing = ref(false)
const isPageScrollbarDragging = ref(false)

let pageScrollbarRafId: number | null = null
let pageScrollbarDragStartY = 0
let pageScrollbarDragStartScroll = 0
let pageScrollbarResizeObserver: ResizeObserver | null = null

// Dynamic thumb size/position ride CSS custom properties (the only inline-style
// escape hatch allowed) so the static styling stays token-based in <style>.
const pageScrollbarThumbStyle = computed(() => ({
  '--page-scrollbar-thumb-height': `${pageScrollbarThumbHeight.value}px`,
  '--page-scrollbar-thumb-offset': `${pageScrollbarThumbOffset.value}px`,
}))

function measurePageScrollbar() {
  const viewportHeight = window.innerHeight
  const contentHeight = document.documentElement.scrollHeight
  const scrollableDistance = contentHeight - viewportHeight
  const trackHeight = pageScrollbarTrackRef.value?.clientHeight ?? 0

  if (scrollableDistance <= 0 || trackHeight <= 0) {
    isPageScrollbarOverflowing.value = false
    return
  }
  isPageScrollbarOverflowing.value = true

  const thumbHeight = Math.max(
    (viewportHeight / contentHeight) * trackHeight,
    MIN_THUMB_PX,
  )
  const maxThumbTravel = trackHeight - thumbHeight
  const scrollProgress = Math.min(Math.max(window.scrollY / scrollableDistance, 0), 1)

  pageScrollbarThumbHeight.value = thumbHeight
  pageScrollbarThumbOffset.value = scrollProgress * maxThumbTravel
}

function schedulePageScrollbarMeasure() {
  if (pageScrollbarRafId !== null) { return }
  pageScrollbarRafId = requestAnimationFrame(() => {
    pageScrollbarRafId = null
    measurePageScrollbar()
  })
}

// Dragging maps pointer travel onto scroll distance; the resulting scroll event
// re-runs measure(), so the thumb stays driven by window.scrollY (one source of
// truth) rather than the pointer directly.
function handlePageScrollbarPointerMove(event: PointerEvent) {
  const viewportHeight = window.innerHeight
  const contentHeight = document.documentElement.scrollHeight
  const scrollableDistance = contentHeight - viewportHeight
  const maxThumbTravel = (pageScrollbarTrackRef.value?.clientHeight ?? 0) - pageScrollbarThumbHeight.value
  if (maxThumbTravel <= 0) { return }

  const pointerDelta = event.clientY - pageScrollbarDragStartY
  const scrollDelta = (pointerDelta / maxThumbTravel) * scrollableDistance
  window.scrollTo({ top: pageScrollbarDragStartScroll + scrollDelta })
}

function handlePageScrollbarPointerUp(event: PointerEvent) {
  isPageScrollbarDragging.value = false
  ;(event.target as HTMLElement).releasePointerCapture?.(event.pointerId)
  window.removeEventListener('pointermove', handlePageScrollbarPointerMove)
  window.removeEventListener('pointerup', handlePageScrollbarPointerUp)
}

function handlePageScrollbarPointerDown(event: PointerEvent) {
  isPageScrollbarDragging.value = true
  pageScrollbarDragStartY = event.clientY
  pageScrollbarDragStartScroll = window.scrollY
  ;(event.target as HTMLElement).setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', handlePageScrollbarPointerMove)
  window.addEventListener('pointerup', handlePageScrollbarPointerUp)
  event.preventDefault()
}

if (import.meta.client) {
  onMounted(() => {
    measurePageScrollbar()
    window.addEventListener('scroll', schedulePageScrollbarMeasure, { passive: true })
    window.addEventListener('resize', schedulePageScrollbarMeasure)
    // Catch content-height changes (route changes, async data, expanding panels)
    // that don't fire a scroll/resize event.
    pageScrollbarResizeObserver = new ResizeObserver(schedulePageScrollbarMeasure)
    pageScrollbarResizeObserver.observe(document.documentElement)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', schedulePageScrollbarMeasure)
    window.removeEventListener('resize', schedulePageScrollbarMeasure)
    window.removeEventListener('pointermove', handlePageScrollbarPointerMove)
    window.removeEventListener('pointerup', handlePageScrollbarPointerUp)
    pageScrollbarResizeObserver?.disconnect()
    if (pageScrollbarRafId !== null) { cancelAnimationFrame(pageScrollbarRafId) }
    document.documentElement.classList.remove('app-hide-scrollbars')
  })
}

</script>

<template>
  <template v-if="authStore.authReady">
    <div :class="{ 'app-layout--post-login': isPostLoginFade }">
      <AppSideNav />
      <div class="app-layout__main" :style="{ marginLeft: navStore.sidebarWidth }">
        <AppTopNav />
        <AppUpdateBanner />

        <Toast />
        <Toast
          group="cross-scope-results"
          :pt="crossScopeToastPt"
        >
          <template #container="{ message, closeCallback }">
            <div
              v-if="isCrossScopeToast(message)"
              class="search-scope-results-toast__card"
            >
              <i
                class="pi pi-info-circle search-scope-results-toast__icon"
                aria-hidden="true"
              />
              <span class="search-scope-results-toast__body">
                <span class="search-scope-results-toast__text">
                  {{ message.detail }}
                </span>
                <Button
                  label="View"
                  outlined
                  rounded
                  size="small"
                  class="search-scope-results-toast__view"
                  @click="viewCrossScopeResults(message)"
                />
              </span>
              <BaseIconButton
                icon="pi pi-times"
                label="Dismiss"
                class="search-scope-results-toast__close"
                @click="closeCallback"
              />
            </div>
            <div
              v-else-if="isNoResultsToast(message)"
              class="search-scope-results-toast__card search-scope-results-toast__card--error"
            >
              <i
                class="pi pi-times-circle search-scope-results-toast__icon"
                aria-hidden="true"
              />
              <span class="search-scope-results-toast__body">
                <span class="search-scope-results-toast__text">
                  {{ message.summary }}
                </span>
              </span>
              <BaseIconButton
                icon="pi pi-times"
                label="Dismiss"
                class="search-scope-results-toast__close"
                @click="closeCallback"
              />
            </div>
          </template>
        </Toast>
        <AppSearchScopeResults />

        <main class="app-layout__content">
          <slot />
        </main>
      </div>

      <!-- Overlay page scrollbar — floats over content below the top nav (no
           reserved width). The thumb appears only while the page overflows.
           Hidden entirely when the user's show_page_scrollbar preference is off. -->
      <div
        v-if="showPageScrollbar"
        ref="pageScrollbarTrackRef"
        class="page-scrollbar"
        aria-hidden="true"
      >
        <div
          v-show="isPageScrollbarOverflowing"
          class="page-scrollbar__thumb"
          :class="{ 'page-scrollbar__thumb--dragging': isPageScrollbarDragging }"
          :style="pageScrollbarThumbStyle"
          @pointerdown="handlePageScrollbarPointerDown"
        />
      </div>
    </div>

  </template>
</template>

<style scoped>
/* Mobile base: fixed top nav reserved via padding-top */
.app-layout__main {
  padding-top: var(--app-top-nav-height, var(--p-layout-top-nav-height));
  transition: margin-left var(--p-transition-duration-slow) var(--p-transition-timing-ease-in-out);
  will-change: margin-left;

  @media (min-width: 768px) {
    padding-top: 0;
  }
}

.app-layout__content {
  position: relative;
  flex: 1;
  min-height: calc(100vh - 64px);

  padding: var(--p-spacing-4) clamp(var(--p-spacing-2), 2vw, var(--p-spacing-8));
}

/* Post-login entrance — layered: shell fades + subtly scales,
   content slides up with a small delay for a polished, staggered reveal.
   The script clips overflow on <html>/<body> for the animation duration
   so the transient scale/translateY transforms don't spawn a scrollbar
   that flickers in and shifts the layout (visible on short pages like
   the under-construction and 404 screens). */
.app-layout--post-login {
  animation: post-login-shell 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transform-origin: 50% 30%;
}

.app-layout--post-login .app-layout__content {
  animation: post-login-content 520ms cubic-bezier(0.16, 1, 0.3, 1) 80ms both;
}

@keyframes post-login-shell {
  from {
    opacity: 0;
    transform: scale(0.992);
    filter: blur(var(--p-spacing-0-5, 2px));
  }

  to {
    opacity: 1;
    transform: none;
    filter: blur(0);
  }
}

@keyframes post-login-content {
  from {
    opacity: 0;
    transform: translateY(var(--p-spacing-3));
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {

  .app-layout--post-login,
  .app-layout--post-login .app-layout__content {
    animation: none;
  }
}

/* Overlay page scrollbar track: starts below the top nav (its published height,
   with the layout token as fallback), runs to the viewport bottom, flush to the
   right edge, 9px wide (spacing-2-25). pointer-events: none so the thin strip
   never blocks clicks on the content beneath it — only the thumb is interactive.
   Sits above the app chrome (top/side nav at z-index 100–102) but below PrimeVue
   overlays. */
.page-scrollbar {
  position: fixed;
  top: var(--app-top-nav-height, var(--p-layout-top-nav-height));
  right: 0;
  bottom: 0;
  width: var(--p-spacing-2-25);
  z-index: 200;
  pointer-events: none;
}

.page-scrollbar__thumb {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: var(--page-scrollbar-thumb-height, 0);
  transform: translateY(var(--page-scrollbar-thumb-offset, 0));
  background: var(--p-gray-300);
  border-radius: var(--p-border-radius-sm);
  pointer-events: auto;
  cursor: default;
  transition: background-color var(--p-transition-duration-fast);
}

.page-scrollbar__thumb:hover,
.page-scrollbar__thumb--dragging {
  background: var(--p-gray-500);
}
</style>
