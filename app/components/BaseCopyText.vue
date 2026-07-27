<script setup lang="ts">
interface Props {
  value: string
  // Overrides what lands on the clipboard when it should differ from the
  // displayed `value` (e.g. copy `24.86` while showing `$24.86`). Falls back to
  // `value` when not provided.
  copyValue?: string | null
  iconPosition?: 'left' | 'right'
  labelColor?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  copyValue: null,
  iconPosition: 'left',
  labelColor: null,
})

const textToCopy = computed(() => props.copyValue ?? props.value)

const labelStyle = computed(() =>
  (props.labelColor ? { '--label-color': props.labelColor } : null),
)

const toast = useToast()

async function copyValue() {
  await navigator.clipboard.writeText(textToCopy.value)
  toast.add({
    severity: 'success',
    summary: 'Success',
    detail: `${textToCopy.value} is copied.`,
    life: 2000,
  })
}
</script>

<template>
  <span
    v-if="value"
    class="base-copy-text"
    :class="{ 'base-copy-text--icon-right': iconPosition === 'right' }"
    :style="labelStyle"
  >
    <BaseIconButton
      icon="pi pi-copy"
      label="Copy to clipboard"
      class="base-copy-text__icon"
      @click.stop.prevent="copyValue"
    />
    <span class="base-copy-text__link">{{ value }}</span>
  </span>
</template>

<style scoped>
.base-copy-text {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
    vertical-align: middle;
}

.base-copy-text--icon-right .base-copy-text__icon {
    order: 1;
}

.base-copy-text__link {
    color: var(--label-color, var(--p-deepblue-900));
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    line-height: var(--p-spacing-6);
    text-decoration: none;
}
</style>
