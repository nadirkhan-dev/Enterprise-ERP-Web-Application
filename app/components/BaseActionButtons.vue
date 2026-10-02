<script setup lang="ts">
interface Props {
  saveLabel?: string
  saveLoading?: boolean
  saveDisabled?: boolean
  cancelLabel?: string
  destructiveLabel?: string
  showDestructive?: boolean
  size?: string | null
  align?: string
}

withDefaults(defineProps<Props>(), {
  saveLabel: 'Save',
  saveLoading: false,
  saveDisabled: false,
  cancelLabel: 'Cancel',
  destructiveLabel: 'Delete',
  showDestructive: false,
  size: null,
  align: 'start',
})

defineEmits<{
  save: []
  cancel: []
  delete: []
}>()
</script>

<template>
  <!-- TEMPORARY: the Delete button below is commented out until the deletion
       workflow (permissions, confirmation, UX) is finalised. Callers still pass
       `show-destructive` and listen for @delete, and every handler behind it is
       intact — uncomment the button and restore the `--spread` class to bring it
       back. `--spread` is off meanwhile so Save/Cancel don't sit against a gap
       where Delete used to be. -->
  <div
    :class="{
      'base-action-buttons--center': align === 'center',
    }"
  >
    <div class="base-action-buttons__primary">
      <Button
        :label="saveLabel"
        :icon="saveLoading ? undefined : 'pi pi-check'"
        :size="size"
        :disabled="saveDisabled"
        @click="$emit('save')"
      >
        <BaseSpinner
          v-if="saveLoading"
          size="sm"
          class="base-action-buttons__spinner"
        />
        <span v-if="saveLoading">{{ saveLabel }}</span>
      </Button>
      <Button
        :label="cancelLabel"
        icon="pi pi-times"
        severity="secondary"
        :size="size"
        class="base-action-buttons__cancel"
        @click="$emit('cancel')"
      />
    </div>
    <!--
    <Button
      v-if="showDestructive"
      :label="destructiveLabel"
      icon="pi pi-trash"
      severity="danger"
      outlined
      :size="size"
      @click="$emit('delete')"
    />
    -->
  </div>
</template>

<style scoped>
.base-action-buttons__primary {
  display: flex;
  gap: var(--p-spacing-3);
}

.base-action-buttons--spread {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.base-action-buttons--center {
  display: flex;
  justify-content: center;
}

/* Cancel: borderless filled-secondary button — grey background (gray-50 =
   #f3f5f6) with the standard tideblue-50 hover used across the app. */
:deep(.base-action-buttons__cancel.p-button) {
    border-color: transparent;
    background: var(--p-gray-50);
    color: var(--p-deepblue-900);
}

:deep(.base-action-buttons__cancel.p-button:hover),
:deep(.base-action-buttons__cancel.p-button:focus-visible) {
    border-color: transparent;
    background: var(--p-tideblue-50);
    color: var(--p-deepblue-900);
}

/* Label is hidden while loading, so center the spinner. Colors are left to
   BaseSpinner's defaults for consistency with every other loading button. */
.base-action-buttons__spinner {
    margin: 0 auto;
}
</style>
