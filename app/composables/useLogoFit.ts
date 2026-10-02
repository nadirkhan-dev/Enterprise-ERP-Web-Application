import type { Ref } from 'vue'

/**
 * How much of a circular avatar's content box a logo may fill.
 *
 * The avatar's content box is a SQUARE, but the ring around it is a CIRCLE, so
 * the square's corners fall outside the ring. A wide wordmark letterboxes into a
 * short band through the circle's middle and keeps its intended inset, while a
 * square-ish mark drawn to the same box drives its corners straight into the
 * ring — the AMTROL case, which reads as "no padding at all".
 *
 * Rather than a second hardcoded padding, the artwork is scaled by the factor
 * that lands its DIAGONAL exactly where a wide wordmark's edge already sits:
 *
 *     fit = 1 / √(1 + 1 / ratio²)     ratio = long side ÷ short side
 *
 * 1.00 for an infinitely wide wordmark (today's rendering, untouched), 0.95 at
 * 3:1, 0.89 at 2:1, 0.71 at a perfect square — so every logo, whatever its
 * shape, ends up the same distance off the ring. Symmetrical in `ratio`, so a
 * tall mark is inset exactly like the wide one it mirrors.
 *
 * The factor is only known once the image has decoded, so the artwork stays
 * hidden until then (`isLogoMeasured` → `.avatar-logo-image--measuring`, which
 * hides with `visibility` and leaves the avatar's box untouched). Otherwise the
 * logo paints at the full box for a frame and then snaps to its fit.
 *
 * Spend both on `.avatar-logo-image` (main.css): `--logo-fit` for the scale, the
 * measuring class while `isLogoMeasured` is false.
 *
 * Because the artwork is held back until it decodes, a slow logo leaves the
 * avatar EMPTY — not the placeholder, which `v-else`'s itself out the moment a
 * src exists. So the same measured/not-measured fact also drives a spinner, with
 * NO deferral: the ring is never blank, however briefly. A cached logo measures
 * from `handleLogoMount` in the same flush it mounts, so the spinner is retired
 * before that first paint rather than flashing.
 *
 * @param logoSrc - the image currently in the avatar; a change re-measures
 * @returns the scale factor, whether it has been measured yet, whether it is
 *          still on its way in, and the two handlers the <img> needs: @load,
 *          plus a :ref for images that are already decoded before the load
 *          listener exists
 */
export function useLogoFit(logoSrc: Ref<string | null | undefined>): {
  logoFit: Ref<number>
  isLogoMeasured: Ref<boolean>
  isLogoLoading: Ref<boolean>
  handleLogoLoad: (event: Event) => void
  handleLogoMount: (element: unknown) => void
} {
  const logoFit = ref(1)
  const isLogoMeasured = ref(false)

  // A src that hasn't been measured yet is a logo still on its way in. No src
  // means the placeholder is on screen, which is a final state, not a wait.
  const isLogoLoading = computed(() => !!logoSrc.value && !isLogoMeasured.value)

  function applyLogoFit(image: HTMLImageElement) {
    const { naturalWidth, naturalHeight } = image

    // An SVG with no intrinsic width/height reports 0 here (so does a decode
    // that failed). Nothing to measure, so fall back to the full box — the
    // shape it has always been drawn at — and show it either way.
    if (!naturalWidth || !naturalHeight) {
      logoFit.value = 1
      isLogoMeasured.value = true
      return
    }

    const ratio = Math.max(naturalWidth / naturalHeight, naturalHeight / naturalWidth)
    logoFit.value = 1 / Math.sqrt(1 + 1 / (ratio * ratio))
    isLogoMeasured.value = true
  }

  function handleLogoLoad(event: Event) {
    applyLogoFit(event.target as HTMLImageElement)
  }

  // A cached image can finish decoding before Vue attaches the load listener —
  // on hydration it may even arrive already complete — and no load event is
  // then coming. Measure straight off the element instead, so a cache hit
  // reveals in the same frame it mounts rather than staying hidden.
  function handleLogoMount(element: unknown) {
    const image = element as HTMLImageElement | null
    if (image?.complete) {
      applyLogoFit(image)
    }
  }

  // A new logo re-measures on load — drop the old factor first so the previous
  // image's inset never lingers on a differently shaped one, and keep it hidden
  // until the new one has been measured in its turn.
  watch(logoSrc, () => {
    logoFit.value = 1
    isLogoMeasured.value = false
  })

  return {
    logoFit,
    isLogoMeasured,
    isLogoLoading,
    handleLogoLoad,
    handleLogoMount,
  }
}
