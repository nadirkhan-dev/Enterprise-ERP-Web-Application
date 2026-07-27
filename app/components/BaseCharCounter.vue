<script setup lang="ts">
/**
 * Character-limit counter shown on a field's label row (CONNECT-536).
 *
 * Echoes the Directus "soft limit" (schema max_length) so the user knows the
 * length budget before a save fails. It is a soft warning, not a hard block —
 * typing past the limit is allowed and the counter turns red to signal the
 * save is expected to fail. Renders nothing when no `max` is provided.
 */
interface Props {
  /** The current field value (its length is counted). */
  value?: string | null
  /** The soft limit (Directus schema max_length). */
  max?: number | null
}

const props = withDefaults(defineProps<Props>(), {
  value: '',
  max: null,
})

const length = computed(() => String(props.value ?? '').length)
const isOver = computed(() => props.max != null && length.value > props.max)
// Empty field reads as a placeholder-grey hint; once the user starts typing the
// counter darkens to the body text colour to match the now-active input.
const hasValue = computed(() => length.value > 0)
</script>

<template>
  <span
    v-if="max"
    class="char-counter"
    :class="{ 'char-counter--active': hasValue, 'char-counter--over': isOver }"
    aria-live="polite"
  >{{ length }}/{{ max }}</span>
</template>

<style scoped>
.char-counter {
    flex-shrink: 0;
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-4);
    color: var(--p-gray-300);
    white-space: nowrap;
}

.char-counter--active {
    color: var(--p-gray-800);
}

.char-counter--over {
    color: var(--p-red-500);
}
</style>
