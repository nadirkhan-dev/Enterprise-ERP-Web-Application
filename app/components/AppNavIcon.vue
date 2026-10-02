<script setup lang="ts">
import { MATERIAL_ICONS } from '~/config/materialIcons'

// Renders a nav icon from a config string, bridging two icon systems:
// PrimeIcons ("pi pi-*", the default) and local Material Symbols vectors
// ("ms:<name>", see materialIcons.ts). Material icons render as inline <svg>
// at their own trimmed viewBox — aspect ratio and centering intact.
// Used by the sidebar nav and by the ProfileCard detail-page tab strip.
const props = defineProps<{ icon: string }>()

// Layout/aria classes are passed by the parent as fall-through attrs and must
// land on whichever element we render, so bind $attrs manually.
defineOptions({ inheritAttrs: false })

const MATERIAL_PREFIX = 'ms:'
const materialIcon = computed(() =>
  props.icon.startsWith(MATERIAL_PREFIX)
    ? MATERIAL_ICONS[props.icon.slice(MATERIAL_PREFIX.length)] ?? null
    : null,
)
</script>

<template>
  <svg
    v-if="materialIcon"
    class="app-nav-icon-svg"
    :viewBox="materialIcon.viewBox"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    v-bind="$attrs"
  >
    <path :d="materialIcon.path" />
  </svg>
  <i
    v-else
    :class="icon"
    v-bind="$attrs"
  />
</template>

<style scoped>
/* The viewBox is trimmed to the glyph, so a 1em box draws the artwork itself at
   the inherited font-size — the same size the surrounding PrimeIcons render at.
   The default preserveAspectRatio keeps non-square glyphs undistorted and
   centred within that box, exactly as the design lays them out. */
.app-nav-icon-svg {
    width: 1em;
    height: 1em;
    display: inline-block;
    vertical-align: middle;
}
</style>
