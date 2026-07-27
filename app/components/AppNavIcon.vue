<script setup lang="ts">
import { MATERIAL_ICON_PATHS, MATERIAL_ICON_VIEWBOX } from '~/config/materialIcons'

// Renders a nav icon from a config string, bridging two icon systems:
// PrimeIcons ("pi pi-*", the default) and local Material Symbols vectors
// ("ms:<name>", see materialIcons.ts). Material icons render as inline <svg>
// at their native viewBox — original design, aspect ratio and centering intact.
// Used by the sidebar nav and by the ProfileCard detail-page tab strip.
const props = defineProps<{ icon: string }>()

// Layout/aria classes are passed by the parent as fall-through attrs and must
// land on whichever element we render, so bind $attrs manually.
defineOptions({ inheritAttrs: false })

const MATERIAL_PREFIX = 'ms:'
const materialPath = computed(() =>
  props.icon.startsWith(MATERIAL_PREFIX)
    ? MATERIAL_ICON_PATHS[props.icon.slice(MATERIAL_PREFIX.length)] ?? null
    : null,
)
const materialViewBox = MATERIAL_ICON_VIEWBOX
</script>

<template>
  <svg
    v-if="materialPath"
    class="app-nav-icon-svg"
    :viewBox="materialViewBox"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    v-bind="$attrs"
  >
    <path :d="materialPath" />
  </svg>
  <i
    v-else
    :class="icon"
    v-bind="$attrs"
  />
</template>

<style scoped>
/* Material Symbols are drawn on a 24dp grid with ~17% built-in padding, so the
   glyph fills only ~83% of its box. Rendering the box at font-size + 2px lands
   the visible glyph at the design's spec size (e.g. 16px box → ~13.3px glyph),
   optically matching the surrounding 14px PrimeIcons. The native viewBox keeps
   the icon's true (non-square) aspect ratio and centering — no distortion. */
.app-nav-icon-svg {
    width: calc(1em + var(--p-spacing-0-5));
    height: calc(1em + var(--p-spacing-0-5));
    display: inline-block;
    vertical-align: middle;
}
</style>
