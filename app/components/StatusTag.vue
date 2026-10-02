<script setup lang="ts">
/**
 * Status pill. Maps a raw status value to a shared colour treatment via
 * getStatusTag() — Open / Active share the green style, Cancelled / Inactive
 * share the red style, Closed is neutral grey. Only the label (the raw
 * status text) differs between tables; the styling is reused.
 */
interface Props {
  status?: string | null
  inactiveNote?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  status: null,
  inactiveNote: '',
})

const tag = computed(() => getStatusTag(props.status))

const note = computed(() => (props.inactiveNote ?? '').trim())

const hasNote = computed(() => tag.value.class === 'status-inactive' && !!note.value)

const iconRef = ref<HTMLElement | null>(null)

function toggleIconTooltip(type: 'mouseenter' | 'mouseleave') {
  if (!hasNote.value) { return }
  iconRef.value?.dispatchEvent(new MouseEvent(type, { bubbles: false }))
}
</script>

<template>
  <Tag
    v-if="tag.label"
    :class="tag.class"
    :aria-label="hasNote ? `${tag.label}: ${note}` : undefined"
    @mouseenter="toggleIconTooltip('mouseenter')"
    @mouseleave="toggleIconTooltip('mouseleave')"
  >
    <span>{{ tag.label }}</span>
    <i
      v-if="hasNote"
      ref="iconRef"
      v-tooltip.top="{ value: note, class: 'status-note-tooltip' }"
      class="pi pi-info-circle status-tag__icon"
      aria-hidden="true"
    />
  </Tag>
</template>

<style scoped>
.status-tag__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-2-5);
    height: var(--p-spacing-2-5);
    color: var(--p-red-700);
    font-size: var(--p-font-size-xxs);
    line-height: var(--p-font-line-height-none);
    pointer-events: none;
}
</style>
