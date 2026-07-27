<script setup lang="ts">
import {
  MATERIAL_ICON_PATHS,
  MATERIAL_ICON_VIEWBOX,
  PLACEHOLDER_ICONS,
  type PlaceholderCategory,
} from '~/config/materialIcons'

// The "this record has no logo/photo yet" artwork: the category's own icon, the
// same one the sidebar uses for that section. Bridges the two icon systems the
// same way AppNavIcon does — "ms:<name>" draws as an inline <svg> at its native
// viewBox, anything else is a PrimeIcons class on an <i>.
//
// Deliberately carries NO size or colour of its own. The container sets both, via
// `.placeholder-avatar__icon` (round avatar) or `.placeholder-thumb__icon` (table
// row) in main.css — and sets font-size alongside width/height, because the two
// icon systems size off different properties.
const props = defineProps<{ category: PlaceholderCategory }>()

// Layout classes come from the parent as fall-through attrs and must land on
// whichever element we render, so bind $attrs manually.
defineOptions({ inheritAttrs: false })

const MATERIAL_PREFIX = 'ms:'

const icon = computed(() => PLACEHOLDER_ICONS[props.category])
const materialPath = computed(() =>
  icon.value.startsWith(MATERIAL_PREFIX)
    ? MATERIAL_ICON_PATHS[icon.value.slice(MATERIAL_PREFIX.length)] ?? null
    : null,
)
</script>

<template>
  <svg
    v-if="materialPath"
    class="placeholder-icon"
    :viewBox="MATERIAL_ICON_VIEWBOX"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    v-bind="$attrs"
  >
    <path :d="materialPath" />
  </svg>
  <i
    v-else
    class="placeholder-icon"
    :class="icon"
    aria-hidden="true"
    v-bind="$attrs"
  />
</template>
