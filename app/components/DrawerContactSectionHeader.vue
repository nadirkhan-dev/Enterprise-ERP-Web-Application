<script setup lang="ts">
interface Props {
  title: string
  collapsed: boolean
  editing?: boolean
  showEditControls?: boolean
}

withDefaults(defineProps<Props>(), {
  editing: false,
  showEditControls: false,
})

defineEmits<{
  'toggle-collapse': []
  'apply': []
  'cancel': []
  'enter-edit': []
}>()
</script>

<template>
  <div class="confirm-section-header">
    <Button
      :icon="collapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
      text
      size="small"
      severity="secondary"
      class="confirm-collapse-btn"
      @click="$emit('toggle-collapse')"
    />
    <div class="drawer-section__heading">
      <span class="drawer-section__title">{{ title }}</span>
    </div>
    <template v-if="showEditControls">
      <div
        v-if="editing"
        class="confirm-section-header__actions"
      >
        <Button
          icon="pi pi-check"
          label="Apply"
          size="small"
          class="confirm-edit-btn"
          @click="$emit('apply')"
        />
        <Button
          icon="pi pi-times"
          label="Cancel"
          size="small"
          severity="secondary"
          outlined
          class="confirm-edit-btn"
          @click="$emit('cancel')"
        />
      </div>
      <Button
        v-else
        icon="pi pi-pencil"
        label="Edit"
        size="small"
        severity="info"
        class="confirm-edit-btn"
        @click="$emit('enter-edit')"
      />
    </template>
  </div>
</template>

<style scoped>
.confirm-section-header {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    margin-bottom: var(--p-spacing-2);
}

:deep(.confirm-collapse-btn.p-button) {
    display: flex;
    color: var(--p-deepblue-900);
    border-color: var(--p-surface-200);
    width: var(--button-sm-icon-only-width, 28px);
    padding: var(--button-sm-padding-y, 5.25px) 0;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;

    @media (min-width: 768px) {
        display: none;
    }
}

.confirm-section-header__actions {
    display: flex;
    gap: var(--p-spacing-2);
    flex-shrink: 0;
}

.confirm-section-header .drawer-section__heading {
    flex: 1;
    min-width: 0;
    overflow: hidden;
}

.confirm-section-header .drawer-section__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
}

.confirm-section-header .drawer-section__heading::after {
    flex: 1 1 0;
    min-width: var(--p-spacing-4);
}

:deep(.confirm-edit-btn.p-button) {
    display: flex;
    border-color: transparent;
    width: var(--button-icon-only-width, 35px);
    padding: var(--button-padding-y, 7px) 0;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;

    @media (min-width: 768px) {
        display: flex;
        width: auto;
        height: auto;
        min-width: auto;
        padding: var(--button-sm-padding-y, 5.25px) var(--button-sm-padding-x, 8.75px);
        align-items: center;
        gap: var(--button-gap, 7px);
    }
}

:deep(.confirm-edit-btn.p-button-outlined) {
    border-color: transparent;
    border-width: 0;
    background: var(--p-surface-50);
}

:deep(.confirm-edit-btn.p-button .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}
</style>
