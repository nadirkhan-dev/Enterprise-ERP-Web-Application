<script setup>
import errorImage from '~/assets/images/error-404.png'
import { useFullPageAssetReady } from '~/composables/useFullPageAssetReady'

const props = defineProps({
  message: {
    type: String,
    default: "Yarr! URL doesn't exist on the map",
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
</script>

<template>
  <div
    class="error404"
    :class="[
      isOverlay ? 'error404--overlay' : 'error404--inline',
      { 'error404--ready': isReady },
    ]"
  >
    <img
      v-show="isReady"
      :src="errorImage"
      alt=""
      width="1216"
      height="961"
      class="error404__art"
      fetchpriority="high"
      decoding="async"
    >
    <div v-show="isReady" class="error404__content">
      <span class="error404__icon">
        <i class="pi pi-map" />
      </span>
      <h1 class="error404__code">
        404
      </h1>
      <p class="error404__message">
        {{ message }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.error404 {
    --error404-art-width: min(clamp(560px, 80vmax, 1200px), calc(90vh * 1216 / 961));
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--p-surface-50);
    overflow: hidden;
    opacity: 0;
    transition: opacity var(--p-transition-duration-slow) var(--p-transition-timing-ease-out);
}

@media (max-width: 767px) {
    .error404 {
        /* Cap with 80vmax (viewport-aware) instead of a fixed 540px so the
           parchment keeps growing with the viewport at custom widths between
           ~480px and 768px, instead of stranding at 540px while text keeps
           scaling. At standard phone widths (≤480) the 132vw term is the
           binding one, so this leaves those views unchanged, and at 767→768
           the image lands on the same size the tablet formula produces (no
           snap at the breakpoint). */
        --error404-art-width: min(clamp(380px, 132vw, 80vmax), calc((100svh - var(--app-top-nav-height, 60px) - 32px) * 1216 / 961));
    }
}

.error404--overlay,
.error404--inline {
    position: absolute;
    inset: 0;
    z-index: 10;
}

.error404--ready {
    opacity: 1;
}

.error404__art {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    /* Width is the smaller of the viewport-driven clamp and a height-bound
       width derived from the image's 1216:961 aspect ratio. Without the
       second term, landscape laptops scale the image tall enough to spill
       past the content area (height ignored when clamping by vmax). */
    width: var(--error404-art-width);
    height: auto;
    z-index: 0;
}

.error404__content {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(var(--p-spacing-2), 2vmin, var(--p-spacing-5));
    padding-block: clamp(var(--p-spacing-2), 2vmin, var(--p-spacing-5));
    padding-inline: clamp(var(--p-spacing-3), 4vmin, var(--p-spacing-6));
    text-align: center;
    max-width: min(90vw, 90%);
}

@media (min-width: 768px) and (max-width: 1024px) {
    .error404__content {
        top: 50%;
        gap: var(--p-spacing-2);
    }
}

/* Icon — fluid sizing, locks at spacing-10 (40px) once there's room */
.error404__icon {
    --error404-icon-size: clamp(var(--p-spacing-7), 7vmin, var(--p-spacing-10));
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--p-orange-500);
    width: var(--error404-icon-size);
    height: var(--error404-icon-size);
    font-size: var(--error404-icon-size);
    line-height: 1;
}

.error404__icon .pi {
    font-size: inherit;
    line-height: 1;
}

/* "404" — fluid down, full 80px when space allows */
h1.error404__code {
    color: var(--p-deepblue-900);
    font-size: clamp(44px, 10vmin, 80px);
    font-weight: var(--p-font-weight-bold);
    line-height: 1;
    margin: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

/* Message — fluid type, balanced wrapping at every width.
   max-width is ~45% of the art width — that's the tan center of the
   parchment. (The torn-paper outer edge is at ~80% of the canvas, but the
   text reads best inside the tan area, away from the rough torn edges.) */
.error404__message {
    color: var(--p-orange-500);
    font-size: clamp(var(--p-font-size-2xs), 2.2vmin, var(--p-font-size-lg));
    font-weight: var(--p-font-weight-bold);
    line-height: var(--p-line-height-normal);
    margin: 0;
    max-width: calc(var(--error404-art-width) * 0.45);
    text-wrap: balance;
}

@media (min-width: 768px) and (max-width: 1024px) {
    .error404__message {
        max-width: calc(var(--error404-art-width) * 0.32);
    }
}
</style>
