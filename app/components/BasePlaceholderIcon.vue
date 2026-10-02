<script setup lang="ts">
import {
  MATERIAL_ICONS,
  PLACEHOLDER_ICONS,
  type PlaceholderCategory,
} from '~/config/materialIcons'

const props = defineProps<{ category: PlaceholderCategory }>()

// Layout classes come from the parent as fall-through attrs and must land on
// whichever element we render, so bind $attrs manually.
defineOptions({ inheritAttrs: false })

const MATERIAL_PREFIX = 'ms:'

const icon = computed(() => PLACEHOLDER_ICONS[props.category])
const materialIcon = computed(() =>
  icon.value.startsWith(MATERIAL_PREFIX)
    ? MATERIAL_ICONS[icon.value.slice(MATERIAL_PREFIX.length)] ?? null
    : null,
)
</script>

<template>
  <svg
    v-if="materialIcon"
    class="placeholder-icon"
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
    class="placeholder-icon"
    :class="icon"
    aria-hidden="true"
    v-bind="$attrs"
  />
</template>
