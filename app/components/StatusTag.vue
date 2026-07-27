<script setup lang="ts">
/**
 * Status pill. Maps a raw status value to a shared colour treatment via
 * getStatusTag() — Open / Active share the green style, Cancelled / Inactive
 * share the red style, Closed is neutral grey. Only the label (the raw
 * status text) differs between tables; the styling is reused.
 */
interface Props {
  status?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  status: null,
})

const tag = computed(() => getStatusTag(props.status))
</script>

<template>
  <Tag
    v-if="tag.label"
    :value="tag.label"
    :class="tag.class"
  />
</template>
