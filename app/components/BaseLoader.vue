<script setup lang="ts">
interface Props {
  overlay?: boolean
  label?: string | null
}

withDefaults(defineProps<Props>(), {
  overlay: false,
  label: null,
})
</script>

<template>
  <div :class="overlay ? 'base-loader--overlay' : 'base-loader--inline'">
    <div class="base-loader__content">
      <BaseSpinner size="md" />
      <span
        v-if="label"
        class="base-loader__label"
      >
        {{ label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.base-loader--overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: rgba(255, 255, 255, var(--p-opacity-overlay));
}

.base-loader--inline {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--p-spacing-8) 0;
}

.base-loader__content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-3);
}

.base-loader__label {
    font-size: var(--p-font-size-sm);
    color: var(--p-text-muted-color);
    font-weight: var(--p-font-weight-normal);
}
</style>
