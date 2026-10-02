<script setup lang="ts">
/**
 * One-click suggestion chips shown beneath a text field, sourced from the
 * Directus interface's `options.presets` (see `useFieldPresets`). Free text is
 * always still allowed — the chips are a shortcut, not a closed list.
 *
 * Used by the address Tags field and every Inactive Note field (CONNECT-708).
 * Renders nothing when there are no suggestions, so a field with no presets
 * configured in Directus simply shows no chip row.
 */
interface Props {
  suggestions?: string[]
  // Values already chosen — matching chips render disabled. Single-value fields
  // pass a one-element array; multi-value fields pass the whole selection.
  selected?: string[]
  // Disables every chip — for fields the user has no write permission on, where
  // a click would mutate a value the save could never persist.
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  suggestions: () => [],
  selected: () => [],
  disabled: false,
})

const emit = defineEmits<{
  select: [value: string]
}>()

// Case-insensitive, matching the address Tags field's dedupe behaviour.
function isSelected(suggestion: string): boolean {
  const normalized = suggestion.toLowerCase()
  return props.selected.some((value) => (value ?? '').trim().toLowerCase() === normalized)
}
</script>

<template>
  <div
    v-if="suggestions.length"
    class="suggestion-chips"
  >
    <Button
      v-for="suggestion in suggestions"
      :key="suggestion"
      :label="suggestion"
      size="small"
      severity="secondary"
      :disabled="disabled || isSelected(suggestion)"
      @click="emit('select', suggestion)"
    />
  </div>
</template>

<style scoped>
.suggestion-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--p-spacing-2);
    margin-top: var(--p-spacing-1);

    button {
      height: var(--p-spacing-7);
      border-color: var(--p-skyblue-50);
      font-size: var(--p-font-size-xs);
      background: var(--p-skyblue-50);
      color: var(--p-deepblue-900);
    }

    button:hover:not(:disabled) {
      background: var(--p-skyblue-500);
      color: var(--p-neutral-0);
    }
}
</style>
