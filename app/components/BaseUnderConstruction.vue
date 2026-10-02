<script setup>
import constructionImage from '~/assets/images/under-construction.png'
import { useFullPageAssetReady } from '~/composables/useFullPageAssetReady'

const props = defineProps({
  mode: {
    type: String,
    default: 'overlay',
    validator: (value) => ['overlay', 'inline'].includes(value),
  },
})

const isOverlay = computed(() => props.mode === 'overlay')
const { isReady } = useFullPageAssetReady({ imageSrc: constructionImage })
</script>

<template>
  <div
    class="construction"
    :class="[
      isOverlay ? 'construction--overlay' : 'construction--inline',
      { 'construction--ready': isReady },
    ]"
  >
    <img
      v-show="isReady"
      :src="constructionImage"
      alt=""
      width="1216"
      height="961"
      class="construction__art"
      fetchpriority="high"
      decoding="async"
    >
  </div>
</template>

<style scoped>
.construction {
    --construction-art-width: min(clamp(560px, 80vmax, 1200px), calc(90vh * 1216 / 961));
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--p-surface-50);
    overflow: hidden;
    opacity: 0;
    transition: opacity var(--p-transition-duration-slow) var(--p-transition-timing-ease-out);
}

@media (max-width: 767px) {
    .construction {
        /* Cap with 80vmax (viewport-aware) instead of a fixed 540px so the
           image keeps growing with the viewport at custom widths between
           ~480px and 768px, instead of stranding at 540px. At standard
           phone widths (≤480) the 132vw term is the binding one, so this
           leaves those views unchanged, and at 767→768 the image lands on
           the same size the base formula produces (no snap at the
           breakpoint). */
        --construction-art-width: min(clamp(380px, 132vw, 80vmax), calc((100svh - var(--app-top-nav-height, 60px) - 32px) * 1216 / 961));
    }
}

.construction--overlay,
.construction--inline {
    position: absolute;
    inset: 0;
    z-index: 10;
}

.construction--ready {
    opacity: 1;
}

.construction__art {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    /* Width is the smaller of the viewport-driven clamp and a height-bound
       width derived from the image's 1216:961 aspect ratio. Without the
       second term, landscape laptops scale the image tall enough to spill
       past the content area (height ignored when clamping by vmax). */
    width: var(--construction-art-width);
    height: auto;
    z-index: 0;
}
</style>
