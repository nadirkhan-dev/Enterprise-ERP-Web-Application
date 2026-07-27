/**
 * Shared height + opacity transition hooks for the auth-flow card swaps
 * (login ↔ inquiry, login ↔ TFA, form ↔ forgot-password, TFA setup ↔
 * complete, inquiry form ↔ success).
 *
 * Usage in a template:
 *   const swap = useCardSwapTransition()
 *   <Transition
 *     name="card-swap"
 *     mode="out-in"
 *     @before-enter="swap.onBeforeEnter"
 *     @enter="swap.onEnter"
 *     @leave="swap.onLeave"
 *   >
 *     <div v-if="..." key="a">...</div>
 *     <div v-else key="b">...</div>
 *   </Transition>
 *
 * The .card-swap-enter-active / .card-swap-leave-active CSS in main.css decides
 * WHAT animates; these hooks only drive it. Height can't be transitioned from CSS
 * alone (`auto` has no animatable value), so the hooks measure it and animate it
 * inline — but only when the CSS says height is in play. Under reduced motion it
 * isn't: main.css fades the cards and leaves their size alone, so the hooks skip
 * the height work and let the card take its natural height straight away.
 *
 * These hooks take Vue's `done` callback, which means Vue hands them the whole
 * transition: it skips its own duration-based fallback and will not finish the
 * swap until `done()` is called (see `hasExplicitCallback` in runtime-dom). So
 * `done()` has to be guaranteed, and a `transitionend` listener alone does not
 * guarantee it — the event never fires when there is no transition to run, when the
 * animated value doesn't actually change, or when the transition is interrupted
 * (that emits `transitioncancel` instead). Miss the call and, under `mode="out-in"`,
 * the leaving card stays collapsed while the entering card is never inserted —
 * stranding the user on an empty card with no way out but a reload. Hence
 * `settleSwap`: it resolves on whichever lands first, the event or the clock.
 */

// Headroom over the CSS duration before the backstop timer takes over — comfortably
// past the two frames the enter hook spends measuring, so a real transition always
// gets to finish on its own `transitionend` and the timer only fires as a rescue.
const SETTLE_BUFFER_MS = 300

interface SwapTiming {
  // The slowest transitioned property: the one whose `transitionend` marks the swap
  // as over. Null when nothing is transitioned at all.
  settlingProperty: string | null
  durationMs: number
  // Whether the CSS actually transitions height, i.e. whether it's worth the hooks
  // measuring and animating it. False under reduced motion.
  isHeightAnimated: boolean
}

// What the browser says this element's transition will do, read off the -active class
// Vue has already applied. The source of truth is the CSS, so a change there needs no
// matching change here.
function getSwapTiming(host: HTMLElement): SwapTiming {
  const styles = getComputedStyle(host)
  const properties = styles.transitionProperty.split(',').map((property) => property.trim())
  const durations = styles.transitionDuration.split(',')
  const delays = styles.transitionDelay.split(',')

  const secondsAt = (index: number) =>
    (parseFloat(durations[index] || '0') || 0) + (parseFloat(delays[index] || '0') || 0)

  let settlingProperty: string | null = null
  let slowestSeconds = 0
  let isHeightAnimated = false

  properties.forEach((property, index) => {
    const seconds = secondsAt(index)
    if (property === 'none' || seconds === 0) return
    if (property === 'height' || property === 'all') {
      isHeightAnimated = true
    }
    if (seconds > slowestSeconds) {
      slowestSeconds = seconds
      settlingProperty = property
    }
  })

  return { settlingProperty, durationMs: slowestSeconds * 1000, isHeightAnimated }
}

/**
 * Resolve `finish` exactly once — when the transition ends, when it's cancelled, or
 * when the clock runs out. Returns a probe the hooks use to skip animation work once
 * the swap is already over.
 */
function settleSwap(host: HTMLElement, timing: SwapTiming, finish: () => void): () => boolean {
  let isSettled = false

  function settle() {
    if (isSettled) return
    isSettled = true
    clearTimeout(timerId)
    host.removeEventListener('transitionend', handleTransitionEvent)
    host.removeEventListener('transitioncancel', handleTransitionEvent)
    finish()
  }

  function handleTransitionEvent(event: TransitionEvent) {
    // Children transition too (inputs, buttons); only this element's own slowest
    // property finishing means the swap is done.
    if (event.target !== host || event.propertyName !== timing.settlingProperty) return
    settle()
  }

  // Nothing transitions here, so no transitionend is coming: settle on the next tick
  // and let the swap be instant, rather than holding an empty card until a timer fires.
  const timerId = setTimeout(settle, timing.durationMs === 0 ? 0 : timing.durationMs + SETTLE_BUFFER_MS)

  if (timing.durationMs > 0) {
    host.addEventListener('transitionend', handleTransitionEvent)
    host.addEventListener('transitioncancel', handleTransitionEvent)
  }

  return () => isSettled
}

export function useCardSwapTransition() {
  // Only opacity: it's faded in both modes, and the -active class Vue needs for the
  // timing read isn't on the element yet, so height can't be decided until onEnter.
  function onBeforeEnter(element: Element) {
    const host = element as HTMLElement
    host.style.opacity = '0'
  }

  function onEnter(element: Element, done: () => void) {
    const host = element as HTMLElement
    const timing = getSwapTiming(host)

    // Clearing the inline values is what makes settling safe from any point in the
    // animation — including before it started, e.g. a background tab where rAF never
    // ran: the card lands at its natural height, fully visible.
    const hasSettled = settleSwap(host, timing, () => {
      host.style.height = ''
      host.style.opacity = ''
      done()
    })

    // Fade only: the card is already at its natural height, so there's nothing to
    // measure — just let the contents come up.
    if (!timing.isHeightAnimated) {
      requestAnimationFrame(() => {
        if (hasSettled()) return
        host.style.opacity = ''
      })
      return
    }

    // Grow from nothing to the height the content wants. Vue runs this before the
    // browser paints, so the collapsed start is never seen as a flash.
    host.style.height = '0px'
    // Double rAF lets nested children lay out before we measure scrollHeight.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // An instant swap has already handed the card its natural height — pinning a
        // measured pixel height on it now would freeze it at that size for good.
        if (hasSettled()) return
        host.style.height = `${host.scrollHeight}px`
        host.style.opacity = ''
      })
    })
  }

  function onLeave(element: Element, done: () => void) {
    const host = element as HTMLElement
    const timing = getSwapTiming(host)
    const hasSettled = settleSwap(host, timing, done)

    if (!timing.isHeightAnimated) {
      requestAnimationFrame(() => {
        if (hasSettled()) return
        host.style.opacity = '0'
      })
      return
    }

    // Pin the height it currently has, so there's something to collapse from.
    host.style.height = `${host.scrollHeight}px`
    void host.offsetHeight
    requestAnimationFrame(() => {
      if (hasSettled()) return
      host.style.height = '0px'
      host.style.opacity = '0'
    })
  }

  return { onBeforeEnter, onEnter, onLeave }
}
