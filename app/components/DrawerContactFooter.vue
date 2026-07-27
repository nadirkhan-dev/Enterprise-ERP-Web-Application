<script setup lang="ts">
interface Props {
  isEditMode: boolean
  currentStep: number
  isSaving: boolean
  isCheckingDuplicates: boolean
  allRowsDismissed: boolean
  canCreateContact: boolean
  /** True while a phone edit form is open (adding/editing) and not yet committed
   *  — blocks saving the contact until that phone is saved or discarded. */
  phoneEditOpen?: boolean
}

withDefaults(defineProps<Props>(), {
  phoneEditOpen: false,
})

defineEmits<{
  save: []
  cancel: []
  delete: []
  'next-step': []
  'back-to-form': []
  'final-review': []
}>()
</script>

<template>
  <BaseActionButtons
    v-if="isEditMode && currentStep === 1"
    :show-destructive="true"
    :save-loading="isSaving"
    :save-disabled="isSaving || phoneEditOpen"
    @save="$emit('save')"
    @cancel="$emit('cancel')"
    @delete="$emit('delete')"
  />

  <div
    v-else-if="currentStep === 2"
    class="drawer-footer-actions"
  >
    <Button
      severity="secondary"
      outlined
      @click="$emit('back-to-form')"
    >
      <i class="pi pi-arrow-left" />
      Back to Form
    </Button>
    <Button
      :disabled="!allRowsDismissed"
      @click="$emit('final-review')"
    >
      Final Review
      <i class="pi pi-arrow-right" />
    </Button>
  </div>

  <div
    v-else-if="currentStep === 3"
    class="drawer-footer-actions"
  >
    <Button
      :disabled="!canCreateContact || isSaving || phoneEditOpen"
      @click="$emit('save')"
    >
      <BaseSpinner
        v-if="isSaving"
        size="sm"
      />
      <i
        v-else
        class="pi pi-check"
      />
      {{ isEditMode ? 'Save Contact' : 'Create Contact' }}
    </Button>
    <Button
      label="Cancel"
      icon="pi pi-times"
      severity="secondary"
      outlined
      class="footer-cancel-btn"
      @click="$emit('cancel')"
    />
  </div>

  <Button
    v-else-if="currentStep === 1"
    :disabled="isCheckingDuplicates || phoneEditOpen"
    @click="$emit('next-step')"
  >
    Next Step
    <span class="step-next-icon">
      <BaseSpinner
        v-if="isCheckingDuplicates"
        size="sm"
      />
      <i
        v-else
        class="pi pi-arrow-right"
      />
    </span>
  </Button>
</template>

<style scoped>
.step-next-icon {
    display: inline-flex;
    align-items: center;
    margin-left: var(--p-spacing-0-5);
}

.drawer-footer-actions {
    display: flex;
    justify-content: center;
    align-items: stretch;
    gap: var(--p-spacing-3);
    width: 100%;

    @media (min-width: 768px) {
        justify-content: flex-start;
    }
}

.drawer-footer-actions > * {
    flex: 1;
    white-space: nowrap;

    @media (min-width: 768px) {
        flex: none;
    }
}

:deep(.footer-cancel-btn.p-button-outlined) {
    border-color: transparent;
    background: var(--p-surface-50);
}
</style>
