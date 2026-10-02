/**
 * Overlay scrollbar — a drawn scroll indicator for touch devices.
 *
 * A scrollable list gets no persistent bar on mobile: Safari ignores
 * `::-webkit-scrollbar` and `scrollbar-width` / `scrollbar-color` on overflow
 * containers outright, and the platform indicator is painted only while a
 * gesture is in flight. So a dropdown or filter list that opens already
 * overflowing reads as complete — option rows are uniform height, the list cuts
 * clean at a row edge, and nothing says there is more below until the user
 * happens to swipe.
 *
 * There is no CSS or scripted-scroll trick that makes the platform bar show on
 * open, so we draw our own: a track pinned to the list's right edge with a thumb
 * sized and offset from the scroll metrics. It paints as soon as the list has a
 * measurable height — i.e. the moment the panel opens — and stays up for as long
 * as the panel is, tracking scrolls, resizes, and options that arrive late. The
 * track is purely visual (`pointer-events: none` in `main.css`); scrolling stays
 * the platform's own touch scrolling on the unmodified overflow container.
 *
 * Exactly one bar, always. Attaching also stamps `overlay-scrollbar-host` on the
 * list, which `main.css` uses to suppress the platform's own indicator for that
 * element — otherwise iOS would paint its hairline over ours mid-gesture and the
 * user would be watching two indicators disagree. The class is applied only from
 * here, so it only ever lands on a platform this file has already gated.
 *
 * Gated to platforms that paint overlay scrollbars with a coarse primary pointer
 * — iOS Safari and Android. A mouse already gets a real, styled scrollbar
 * (`main.css`), and a classic space-reserving scrollbar would sit right next to
 * ours, so both are excluded. See `getIsDrawnScrollbarPlatform`.
 */

// Floor on the thumb so it stays legible on a long list. Mirrors the page
// scrollbar in `layouts/default.vue`.
const MIN_THUMB_PX = 24

export interface OverlayScrollbarHandle {
  /** Re-measure after a content change the observers can't see. */
  measure: () => void
  destroy: () => void
}

// Lists that already carry a drawn bar. The plugin's body watcher and the
// `v-overlay-scrollbar` directive can both land on the same element; without
// this a second call would stack a second track on the same overlay.
const attachedScrollElements = new WeakSet<HTMLElement>()

let hasOverlayScrollbars: boolean | null = null

/**
 * Whether the platform paints overlay scrollbars — compositor-drawn, transient,
 * reserving no layout width (iOS, Android, macOS) — rather than the classic
 * space-reserving bar of Windows / Linux.
 *
 * Probed rather than sniffed from the user agent: iPadOS reports itself as a
 * Mac, and a scrollbar that reserves a gutter is exactly the case where drawing
 * our own would double up on a bar the user can already see.
 */
function getHasOverlayScrollbars(): boolean {
  if (hasOverlayScrollbars !== null) { return hasOverlayScrollbars }

  const probe = document.createElement('div')
  // `overflow: scroll` reserves the gutter whether or not the probe has content,
  // so an empty box is enough to read the platform's scrollbar width.
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll'
  document.body.appendChild(probe)
  hasOverlayScrollbars = probe.offsetWidth - probe.clientWidth === 0
  probe.remove()

  return hasOverlayScrollbars
}

/**
 * Whether this platform needs a drawn scrollbar. Feature checks only, so a
 * touchscreen laptop (fine primary pointer) and a touch-only Windows tablet
 * (classic scrollbars) both keep their native bar untouched.
 */
export function getIsDrawnScrollbarPlatform(): boolean {
  if (!import.meta.client) { return false }
  return window.matchMedia('(pointer: coarse)').matches && getHasOverlayScrollbars()
}

/**
 * Attach a drawn scrollbar to `scrollElement`, tracking it until destroyed.
 *
 * @param scrollElement the overflow container the bar reports on
 * @returns a handle, or `null` on a platform with native bars / with nothing to
 *   attach to / when the element already has one
 */
export function createOverlayScrollbar(
  scrollElement: HTMLElement | null = null,
): OverlayScrollbarHandle | null {
  if (!scrollElement || !getIsDrawnScrollbarPlatform()) { return null }
  if (attachedScrollElements.has(scrollElement)) { return null }

  // The bar is a sibling of the list rather than a child: a child would scroll
  // away with the content it measures.
  const host = scrollElement.parentElement
  if (!host) { return null }

  const track = document.createElement('div')
  track.className = 'overlay-scrollbar'
  track.setAttribute('aria-hidden', 'true')

  const thumb = document.createElement('div')
  thumb.className = 'overlay-scrollbar__thumb'
  track.appendChild(thumb)

  // The track is absolutely positioned, so the host has to be its containing
  // block. Anything already positioned (PrimeVue's overlay panels) is left alone.
  const didPromoteHost = getComputedStyle(host).position === 'static'
  if (didPromoteHost) { host.style.position = 'relative' }
  host.appendChild(track)

  // Stands the drawn bar down as the list's only indicator — see the rules this
  // class carries in `main.css`. Set from JS rather than authored against the
  // list's own selectors so it can never reach a platform the gate rejected.
  scrollElement.classList.add('overlay-scrollbar-host')
  attachedScrollElements.add(scrollElement)

  let rafId: number | null = null

  /**
   * The list's top and right edges in the coordinate space an absolutely
   * positioned child of the host resolves against (the host's padding box).
   *
   * PrimeVue opens its overlays on a 300ms `scale(0.93)` keyframe animation
   * (`p-anchored-overlay-enter-active`), and `getBoundingClientRect()` reports
   * transformed geometry — measuring mid-animation off rects lands the track
   * off the list. `offsetTop` / `offsetLeft` are transform-immune and already
   * resolve against the offset parent's padding box, so when the host *is* the
   * offset parent (every PrimeVue overlay, since the panel is positioned) they
   * are exactly the numbers we want, correct from the very first frame. Rects
   * stay as the fallback for a list nested below some other positioned ancestor.
   */
  function getListEdges() {
    if (scrollElement!.offsetParent === host) {
      return {
        top: scrollElement!.offsetTop,
        right: scrollElement!.offsetLeft + scrollElement!.offsetWidth,
      }
    }

    const hostRect = host!.getBoundingClientRect()
    const listRect = scrollElement!.getBoundingClientRect()
    return {
      top: listRect.top - hostRect.top - host!.clientTop + host!.scrollTop,
      right: listRect.right - hostRect.left - host!.clientLeft + host!.scrollLeft,
    }
  }

  function measure() {
    if (!scrollElement) { return }
    const { scrollHeight, clientHeight, scrollTop } = scrollElement
    const scrollableDistance = scrollHeight - clientHeight

    // Nothing to scroll, or not laid out yet (a panel mid enter-animation).
    // Mirrors the native behaviour and keeps a short list from showing a
    // full-height thumb that can't move; the observers below re-measure once the
    // list has a height, which is what puts the bar up on open.
    if (scrollableDistance < 1 || clientHeight <= 0) {
      track.classList.remove('overlay-scrollbar--visible')
      return
    }

    const { top, right } = getListEdges()
    track.style.top = `${top}px`
    // Sit on the list's right edge; the CSS pulls the track back inside by its
    // own width, so the width stays a token rather than a number here.
    track.style.left = `${right}px`
    track.style.height = `${clientHeight}px`

    // Thumb length is the visible fraction of the list, floored so it stays
    // legible and capped at the track so it can never overrun it.
    const thumbHeight = Math.min(
      Math.max((clientHeight / scrollHeight) * clientHeight, MIN_THUMB_PX),
      clientHeight,
    )
    const maxThumbTravel = Math.max(clientHeight - thumbHeight, 0)
    const scrollProgress = Math.min(Math.max(scrollTop / scrollableDistance, 0), 1)

    thumb.style.setProperty('--overlay-scrollbar-thumb-height', `${thumbHeight}px`)
    thumb.style.setProperty('--overlay-scrollbar-thumb-offset', `${scrollProgress * maxThumbTravel}px`)
    track.classList.add('overlay-scrollbar--visible')
  }

  function scheduleMeasure() {
    if (rafId !== null) { return }
    rafId = requestAnimationFrame(() => {
      rafId = null
      measure()
    })
  }

  // Height arrives a frame or two after the panel opens (enter animation, async
  // options); ResizeObserver fires on observe and on every change after, so the
  // bar goes up as soon as there is something to measure.
  const resizeObserver = new ResizeObserver(scheduleMeasure)
  resizeObserver.observe(scrollElement)

  // Rows added or filtered out change the scrollable distance without resizing
  // the container.
  const mutationObserver = new MutationObserver(scheduleMeasure)
  mutationObserver.observe(scrollElement, { childList: true, subtree: true })

  // The open animation changes no layout box, so neither observer above fires
  // when it settles. `getListEdges` is transform-immune and this is a single
  // event rather than a loop, so it costs one extra measure per open and covers
  // the rect fallback path plus any overlay that animates its layout box.
  const handleHostAnimationSettled = () => scheduleMeasure()
  host.addEventListener('animationend', handleHostAnimationSettled)
  host.addEventListener('transitionend', handleHostAnimationSettled)

  // The bar never leaves while the panel is open; a scroll only slides the thumb.
  scrollElement.addEventListener('scroll', scheduleMeasure, { passive: true })
  measure()

  function destroy() {
    scrollElement?.removeEventListener('scroll', scheduleMeasure)
    host!.removeEventListener('animationend', handleHostAnimationSettled)
    host!.removeEventListener('transitionend', handleHostAnimationSettled)
    resizeObserver.disconnect()
    mutationObserver.disconnect()
    if (rafId !== null) { cancelAnimationFrame(rafId) }
    track.remove()
    scrollElement?.classList.remove('overlay-scrollbar-host')
    if (didPromoteHost) { host!.style.position = '' }
    if (scrollElement) { attachedScrollElements.delete(scrollElement) }
  }

  return { measure, destroy }
}
