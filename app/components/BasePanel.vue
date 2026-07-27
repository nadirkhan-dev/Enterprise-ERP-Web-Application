<script setup lang="ts">
interface Props {
  title: string
  collapsed?: boolean
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  collapsed: false,
  loading: false,
})

const isCollapsed = ref(props.collapsed)

watch(() => props.collapsed, (collapsed) => {
  isCollapsed.value = collapsed
})
</script>

<template>
  <div class="base-panel">
    <div class="base-panel__header">
      <div
        v-if="loading"
        class="base-panel__loader"
        aria-label="Loading"
      >
        <BaseSpinner size="sm" />
      </div>
      <Button
        v-else
        :icon="isCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
        outlined
        severity="secondary"
        class="toggle-btn"
        @click="isCollapsed = !isCollapsed"
      />
      <div class="base-panel__divider">
        <span class="base-panel__title">
          <slot name="title">{{ title }}</slot>
        </span>
      </div>
      <slot
        v-if="!loading"
        name="actions"
      />
    </div>
    <div
      v-show="!isCollapsed && !loading"
      class="base-panel__body"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.base-panel {
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-xs);
    box-shadow: var(--p-shadow-sm);
    padding: var(--p-spacing-4);

    @media (min-width: 768px) {
        padding: clamp(var(--p-spacing-6), 2vw, var(--p-spacing-8));
    }
}

.base-panel__header {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

/* Toggle button — outlined style per Figma */
:deep(.toggle-btn.p-button-outlined) {
    color: var(--p-deepblue-900);
    border-color: var(--p-surface-200);
    padding: 0;
    width: 28px;
    height: 28px;
    min-width: 24px;
}

:deep(.toggle-btn.p-button-outlined:hover) {
    background: var(--p-tideblue-50);
    border-color: var(--p-surface-200);
    color: var(--p-deepblue-900);
}

/* Header loader — matches the toggle button slot */
.base-panel__loader {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
}

/* Divider — title + line fills remaining space */
.base-panel__divider {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

.base-panel__divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--p-surface-200);
}

.base-panel__title {
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    white-space: nowrap;
    line-height: inherit;
}

/* Action buttons — icon-only + equal size on mobile */
.base-panel__header > :deep(.p-button:not(.toggle-btn) .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

.base-panel__header > :deep(.p-button:not(.toggle-btn)) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;

    @media (min-width: 768px) {
        width: auto;
        min-width: auto;
        height: auto;
        padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    }
}

.base-panel__body {
    margin-top: var(--p-spacing-4);
}
</style>
