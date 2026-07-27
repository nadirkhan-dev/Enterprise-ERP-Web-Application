<script setup lang="ts">
interface Props {
  visible: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  save: []
  discard: []
}>()

// Closing via the header X / Escape / mask falls through update:visible — the
// parent treats that as "keep editing" (no save, no discard).
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
    class="unsaved-dialog"
    :pt="{ mask: { class: 'app-backdrop-blur' } }"
  >
    <div class="unsaved-dialog__body">
      <img
        class="unsaved-dialog__logo"
        src="/logo.svg"
        alt="Connect logo"
      >
      <h2 class="unsaved-dialog__heading">
        Unsaved Changes
      </h2>
      <p class="unsaved-dialog__message">
        Save or discard your changes before closing.
      </p>
    </div>

    <template #footer>
      <div class="unsaved-dialog__actions">
        <Button
          label="Discard Changes"
          severity="secondary"
          @click="$emit('discard')"
        />
        <Button
          label="Save Changes"
          @click="$emit('save')"
        />
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
:deep(.unsaved-dialog) {
    overflow: hidden;
    border: 0 !important;
    outline: 1px solid rgba(0, 0, 0, 0.06);
}

.unsaved-dialog__body {
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

.unsaved-dialog__logo {
    width: var(--p-spacing-20);
    height: auto;
    margin-bottom: calc(var(--p-spacing-4) * 0.2);
}

.unsaved-dialog__heading {
    margin: 0 0 calc(var(--p-spacing-1) * -2) 0;
    font-size: var(--p-font-size-xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-line-height-tight);
}

.unsaved-dialog__message {
    margin: 0 0 var(--p-spacing-2) 0;
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
}

.unsaved-dialog__actions {
    display: flex;
    justify-content: center;
    gap: var(--p-spacing-2);
    width: 100%;
}
</style>

<style>
.unsaved-dialog,
.unsaved-dialog .p-dialog-header,
.unsaved-dialog .p-dialog-content,
.unsaved-dialog .p-dialog-footer {
    border-radius: var(--p-border-radius-sm) !important;
}

.unsaved-dialog .p-dialog-header {
    height: var(--p-spacing-8) !important;
    padding-top: 0 !important;
    padding-right: var(--p-spacing-4-375) !important;
    padding-left: var(--p-spacing-4-375) !important;
    padding-bottom: 0 !important;
}

.unsaved-dialog .p-dialog-content {
    /* Top space comes from the header band; footer owns the bottom space. */
    padding: 0 var(--p-spacing-4-375) !important;
}

.unsaved-dialog .p-dialog-footer {
    min-height: var(--p-spacing-12) !important;
    padding: var(--p-spacing-2) var(--p-spacing-4-375) var(--p-spacing-8) !important;
    justify-content: center !important;
    align-items: center !important;
}

.unsaved-dialog .p-dialog-footer .p-button-secondary {
    border-color: transparent;
}

/* Strip the default border / focus ring that PrimeVue draws around the header
   close (X) icon, matching the update-notification modal. */
.unsaved-dialog .p-dialog-close-button,
.unsaved-dialog .p-dialog-header-icon {
    border: 0 !important;
    outline: 0 !important;
    box-shadow: none !important;
    /* Nudge the X down without moving the logo (relative = no reflow). */
    position: relative;
    top: var(--p-spacing-4);
}

.unsaved-dialog .p-dialog-close-button:focus,
.unsaved-dialog .p-dialog-close-button:focus-visible,
.unsaved-dialog .p-dialog-header-icon:focus,
.unsaved-dialog .p-dialog-header-icon:focus-visible {
    outline: 0 !important;
    box-shadow: none !important;
}

.unsaved-dialog .p-dialog-close-button:focus:not(:focus-visible),
.unsaved-dialog .p-dialog-header-icon:focus:not(:focus-visible) {
    background: transparent !important;
}

.unsaved-dialog .p-dialog-close-button:hover,
.unsaved-dialog .p-dialog-header-icon:hover {
    background: var(--p-tideblue-50) !important;
    border-radius: var(--p-border-radius-xs) !important;
}
</style>
