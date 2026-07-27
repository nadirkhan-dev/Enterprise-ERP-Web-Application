<script setup lang="ts">
// Shared search icon for every drawer + table-section search (NOT the top nav).
// Empty → a gray magnifier (clicking it expands a collapsed field). Once the
// user types → a keyboard-focusable × that clears the query. Sits in the exact
// magnifier position (`.section-filter__icon`) so it never overflows the input.
// `activate` fires for both; the parent's handler expands when empty and clears
// (+ collapses) when active.
defineProps<{ active: boolean }>()
const emit = defineEmits<{ activate: [] }>()
</script>

<template>
  <i
    :class="[
      'section-filter__icon',
      active ? 'pi pi-times section-filter__icon--active' : 'pi pi-search',
    ]"
    :role="active ? 'button' : undefined"
    :tabindex="active ? 0 : undefined"
    :aria-label="active ? 'Clear search' : undefined"
    :aria-hidden="active ? undefined : 'true'"
    @click="emit('activate')"
    @keydown.enter.space.prevent="active && emit('activate')"
  />
</template>
