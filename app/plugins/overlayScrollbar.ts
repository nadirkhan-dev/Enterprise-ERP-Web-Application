/**
 * `v-overlay-scrollbar` — draws a scroll indicator on a transient list so a touch
 * user can tell at a glance that there is more below the fold. See
 * `app/utils/overlayScrollbar.ts` for why this needs JS at all (Safari renders no
 * persistent bar for an overflow container, styled or not).
 *
 * Apply it to lists that appear inside a panel the user can't judge length from —
 * filter option lists, drawer pickers. It is a no-op wherever the platform draws
 * a real, persistent scrollbar already (desktop).
 *
 * PrimeVue's own dropdown overlays (Select / MultiSelect / AutoComplete) are
 * teleported straight to `<body>` on open and destroyed on close, so there is no
 * element in our templates to carry the directive. Watching `<body>`'s direct
 * children below catches every one of them without touching the files that use
 * those components.
 */
import type { OverlayScrollbarHandle } from '~/utils/overlayScrollbar'

const OVERLAY_LIST_SELECTOR = [
  '.p-select-list-container',
  '.p-multiselect-list-container',
  '.p-autocomplete-list-container',
].join(', ')

function watchOverlayPanels() {
  // Platforms with a real, persistent bar keep it — no observer, no bookkeeping.
  if (!getIsDrawnScrollbarPlatform()) { return }

  const scrollbars = new Map<HTMLElement, OverlayScrollbarHandle>()

  function attachWithin(node: Node) {
    if (!(node instanceof HTMLElement)) { return }

    const lists = node.matches(OVERLAY_LIST_SELECTOR)
      ? [node]
      : Array.from(node.querySelectorAll<HTMLElement>(OVERLAY_LIST_SELECTOR))

    for (const list of lists) {
      if (scrollbars.has(list)) { continue }
      const scrollbar = createOverlayScrollbar(list)
      if (scrollbar) { scrollbars.set(list, scrollbar) }
    }
  }

  // A closing panel is torn out of the DOM wholesale, so rather than matching
  // removed nodes to their lists, drop whatever no longer belongs to the page.
  function destroyDetached() {
    for (const [list, scrollbar] of scrollbars) {
      if (document.contains(list)) { continue }
      scrollbar.destroy()
      scrollbars.delete(list)
    }
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(attachWithin)
    }
    destroyDetached()
  })

  observer.observe(document.body, { childList: true })

  // Panels already open (hot reload, or a plugin registered after one opened).
  attachWithin(document.body)
}

const directiveScrollbars = new WeakMap<HTMLElement, OverlayScrollbarHandle>()

export default defineNuxtPlugin((nuxtApp) => {
  // Registered on the server too, or SSR fails to resolve the directive.
  nuxtApp.vueApp.directive('overlay-scrollbar', {
    mounted(el: HTMLElement) {
      const scrollbar = createOverlayScrollbar(el)
      if (scrollbar) { directiveScrollbars.set(el, scrollbar) }
    },
    // The list re-renders on every search keystroke and on every option load;
    // re-measure so the thumb tracks the new row count.
    updated(el: HTMLElement) {
      directiveScrollbars.get(el)?.measure()
    },
    unmounted(el: HTMLElement) {
      directiveScrollbars.get(el)?.destroy()
      directiveScrollbars.delete(el)
    },
  })

  if (import.meta.client) { watchOverlayPanels() }
})
