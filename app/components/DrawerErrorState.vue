<script setup lang="ts">
interface Props {
  visible?: boolean
  title?: string
  message?: string
}

withDefaults(defineProps<Props>(), {
  visible: false,
  title: 'Internal Error Occured',
  message: 'Oops! An Error Occured',
})

defineEmits<{
  'update:visible': [value: boolean]
}>()
</script>

<template>
  <BaseDrawer
    :title="title"
    :visible="visible"
    has-error
    :error-message="message"
    @update:visible="$emit('update:visible', $event)"
  />
</template>
