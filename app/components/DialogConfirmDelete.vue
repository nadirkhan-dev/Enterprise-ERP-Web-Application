<script setup lang="ts">
/**
 * Second half of the double-confirmation pattern for deletions (CONNECT-1031): a
 * trash icon never deletes on its own — it opens this, and the delete happens only
 * when the user confirms here.
 *
 * Shaped after DialogUnsavedChanges so the two prompts read as one family, and
 * generic in its copy (`title` / `message`) so every deletion we approve from here
 * on asks in the same shape.
 */
interface Props {
  visible: boolean
  title: string
  message: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  confirm: []
  cancel: []
}>()

// Closing via the header X / Escape / mask falls through update:visible rather
// than either button — the parent reads that as "don't delete", the safe reading
// of an ambiguous dismissal.
const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})

// Matches the update-notification modal's sizing (AppUpdateBanner simple prompt).
const dialogStyle = {
  width: '600px',
  maxWidth: 'calc(100vw - 2rem)',
  height: 'auto',
  minHeight: '260px',
  maxHeight: 'calc(100vh - 2rem)',
}
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    :style="dialogStyle"
    :draggable="false"
    modal
    header=" "
    class="confirm-delete-dialog"
    :pt="{ mask: { class: 'app-backdrop-blur' } }"
  >
    <div class="confirm-delete-dialog__body">
      <img
        class="confirm-delete-dialog__logo"
        src="/logo.svg"
        alt="Connect logo"
      >
      <h2 class="confirm-delete-dialog__heading">
        {{ title }}
      </h2>
      <p class="confirm-delete-dialog__message">
        {{ message }}
      </p>
    </div>

    <template #footer>
      <div class="confirm-delete-dialog__actions">
        <Button
          label="Cancel"
          severity="secondary"
          @click="$emit('cancel')"
        />
        <Button
          label="Confirm"
          @click="$emit('confirm')"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
:deep(.confirm-delete-dialog) {
    overflow: hidden;
    border: 0 !important;
    outline: 1px solid rgba(0, 0, 0, 0.06);
}

.confirm-delete-dialog__body {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--p-spacing-3);
    min-height: 100%;
    /* Mirror the Version Details modal's content block — logo/heading/message
       flow from the top, small bottom inset; top space is the header band. */
    padding-bottom: var(--p-spacing-1);
}

.confirm-delete-dialog__logo {
    width: var(--p-spacing-20);
    height: auto;
    margin-bottom: calc(var(--p-spacing-4) * 0.2);
}

.confirm-delete-dialog__heading {
    margin: 0 0 calc(var(--p-spacing-1) * -2) 0;
    font-size: var(--p-font-size-xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-line-height-tight);
}

.confirm-delete-dialog__message {
    margin: 0 0 var(--p-spacing-2) 0;
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
}

.confirm-delete-dialog__actions {
    display: flex;
    justify-content: center;
    gap: var(--p-spacing-2);
    width: 100%;
}
</style>

<style>
.confirm-delete-dialog,
.confirm-delete-dialog .p-dialog-header,
.confirm-delete-dialog .p-dialog-content,
.confirm-delete-dialog .p-dialog-footer {
    border-radius: var(--p-border-radius-sm) !important;
}

.confirm-delete-dialog .p-dialog-header {
    height: var(--p-spacing-8) !important;
    padding-top: 0 !important;
    padding-right: var(--p-spacing-4-375) !important;
    padding-left: var(--p-spacing-4-375) !important;
    padding-bottom: 0 !important;
}

.confirm-delete-dialog .p-dialog-content {
    /* Top space comes from the header band; footer owns the bottom space. */
    padding: 0 var(--p-spacing-4-375) !important;
}

.confirm-delete-dialog .p-dialog-footer {
    min-height: var(--p-spacing-12) !important;
    padding: var(--p-spacing-2) var(--p-spacing-4-375) var(--p-spacing-8) !important;
    justify-content: center !important;
    align-items: center !important;
}

.confirm-delete-dialog .p-dialog-footer .p-button-secondary {
    border-color: transparent;
}

/* Strip the default border / focus ring that PrimeVue draws around the header
   close (X) icon, matching the update-notification modal. */
.confirm-delete-dialog .p-dialog-close-button,
.confirm-delete-dialog .p-dialog-header-icon {
    border: 0 !important;
    outline: 0 !important;
    box-shadow: none !important;
    /* Nudge the X down without moving the logo (relative = no reflow). */
    position: relative;
    top: var(--p-spacing-4);
}

.confirm-delete-dialog .p-dialog-close-button:focus,
.confirm-delete-dialog .p-dialog-close-button:focus-visible,
.confirm-delete-dialog .p-dialog-header-icon:focus,
.confirm-delete-dialog .p-dialog-header-icon:focus-visible {
    outline: 0 !important;
    box-shadow: none !important;
}

.confirm-delete-dialog .p-dialog-close-button:focus:not(:focus-visible),
.confirm-delete-dialog .p-dialog-header-icon:focus:not(:focus-visible) {
    background: transparent !important;
}

.confirm-delete-dialog .p-dialog-close-button:hover,
.confirm-delete-dialog .p-dialog-header-icon:hover {
    background: var(--p-tideblue-50) !important;
    border-radius: var(--p-border-radius-xs) !important;
}
</style>
