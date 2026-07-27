<script setup>
import errorImage from '~/assets/images/error-500.png'
import { useFullPageAssetReady } from '~/composables/useFullPageAssetReady'

const props = defineProps({
  message: {
    type: String,
    default: 'Oops! An Error Occured',
  },
  mode: {
    type: String,
    default: 'overlay',
    validator: (value) => ['overlay', 'inline'].includes(value),
  },
})

const isOverlay = computed(() => props.mode === 'overlay')
const { isReady } = useFullPageAssetReady({
  imageSrc: errorImage,
  fontFamily: 'primeicons',
})

const artScale = ref(1.5)
const rootRef = ref(null)
let resizeObserver = null

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}
const lerp = (a, b, t) => a + (b - a) * t

const computeOverlayArtScale = (w) => {
  if (w <= 768) return lerp(1.5, 1.4, smoothstep(480, 768, w))
  if (w <= 1024) return lerp(1.4, 1.55, smoothstep(768, 1024, w))
  if (w <= 1440) return lerp(1.55, 1.7, smoothstep(1024, 1440, w))
  return 1.7
}

const computeInlineArtScale = (w) => {
  if (w <= 768) return lerp(1.7, 1.6, smoothstep(480, 768, w))
  if (w <= 1024) return lerp(1.6, 1.5, smoothstep(768, 1024, w))
  return 1.5
}

const updateArtScale = () => {
  if (!rootRef.value) return
  const containerWidth = rootRef.value.clientWidth
  artScale.value = isOverlay.value
    ? computeOverlayArtScale(containerWidth)
    : computeInlineArtScale(containerWidth)
}

onMounted(() => {
  updateArtScale()
  if (rootRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(updateArtScale)
    resizeObserver.observe(rootRef.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<template>
  <div
    ref="rootRef"
    class="error500"
    :class="[
      isOverlay ? 'error500--overlay' : 'error500--inline',
      { 'error500--ready': isReady },
    ]"
  >
    <div v-show="isReady" class="error500__stage">
      <img
        :src="errorImage"
        alt=""
        class="error500__art"
        fetchpriority="high"
        decoding="async"
        :style="{ '--error500-art-scale': artScale }"
      >
      <div class="error500__content">
        <span class="error500__icon">
          <i class="pi pi-exclamation-circle" />
        </span>
        <h1 class="error500__code">
          500
        </h1>
        <p class="error500__message">
          {{ message }}
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error500 {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--p-surface-0);
    overflow: hidden;
    opacity: 0;
    transition: opacity var(--p-transition-duration-slow) var(--p-transition-timing-ease-out);
}

.error500--overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
}

.error500--inline {
    position: absolute;
    inset: 0;
    z-index: 10;
}

.error500--ready {
    opacity: 1;
}

.error500__stage {
    position: relative;
    width: 100%;
    height: 100%;
}

.error500__art {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    z-index: 0;
    transform: scale(var(--error500-art-scale, 1.5));
    transform-origin: center;
}

.error500__content {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(8px, 2vmin, 20px);
    padding-block: clamp(8px, 2vmin, 20px);
    padding-inline: clamp(12px, 4vmin, 24px);
    text-align: center;
    max-width: min(90vw, 90%);
}

/* Icon — fluid on small screens, locks at 40px once there's room */
.error500__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--p-red-500);
    width: clamp(28px, 7vmin, 40px);
    height: clamp(28px, 7vmin, 40px);
    font-size: clamp(28px, 7vmin, 40px);
    line-height: 1;
}

.error500__icon .pi {
    font-size: inherit;
    line-height: 1;
}

/* "500" — fluid down, full 80px when space allows */
h1.error500__code {
    color: var(--text-primary, #1C3C70);
    font-family: var(--H1-fontfamily, "TT Norms Pro");
    font-size: clamp(44px, 10vmin, 80px);
    font-weight: 700;
    letter-spacing: var(--H1-letterspacing, 0);
    line-height: 1;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

/* Message — wraps on narrow screens, single line on wide ones */
.error500__message {
    color: var(--p-red-700);
    font-family: var(--H3-fontfamily, "TT Norms Pro");
    font-size: clamp(14px, 2.4vmin, var(--H3-fontsize, 20px));
    font-weight: 700;
    line-height: var(--H3-lineheight, 28px);
    margin: 0;
    white-space: nowrap;
}

</style>