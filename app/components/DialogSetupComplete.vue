<script setup lang="ts">
interface Props {
  visible: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  continue: []
  cancel: []
}>()

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})
</script>

<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    :draggable="false"
    :closable="false"
    :style="{ width: 'min(640px, calc(100vw - 24px))' }"
    class="setup-complete-dialog"
    :pt="{ mask: { class: 'app-backdrop-blur' } }"
  >
    <template #header>
      <div class="setup-complete-header">
        <span class="setup-complete-header__title">Setup Complete</span>
        <Button
          icon="pi pi-times"
          severity="secondary"
          text
          class="setup-complete-header__close"
          aria-label="Close dialog"
          @click="emit('cancel')"
        />
      </div>
    </template>

    <div class="setup-complete-body">
      <i
        class="pi pi-check-circle setup-complete-icon"
        aria-hidden="true"
      />
      <p class="setup-complete-message">Setup Verification Successful</p>
    </div>

    <template #footer>
      <Button
        icon="pi pi-check"
        label="Continue"
        class="setup-complete-continue"
        @click="emit('continue')"
      />
      <Button
        icon="pi pi-times"
        label="Cancel"
        severity="secondary"
        class="setup-complete-cancel"
        @click="emit('cancel')"
      />
    </template>
  </Dialog>
</template>

<style>
.setup-complete-dialog.p-dialog {
    width: min(640px, calc(100vw - 24px)) !important;
    border-radius: var(--p-border-radius-xs) !important;
    overflow: hidden;
}

.setup-complete-dialog .p-dialog-header {
    width: 100%;
    padding: 18px 18px 10px 20px !important;
    border-bottom: none !important;
}

.setup-complete-dialog .p-dialog-content {
    width: 100%;
    border-bottom: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    box-sizing: border-box;
}

.setup-complete-dialog .p-dialog-footer {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    width: 100%;
    border-top: none !important;
    box-shadow: none !important;
    padding: 0 20px 18px !important;
    box-sizing: border-box;
}

.setup-complete-dialog .setup-complete-cancel.p-button,
.setup-complete-dialog .setup-complete-cancel.p-button:hover,
.setup-complete-dialog .setup-complete-cancel.p-button:focus,
.setup-complete-dialog .setup-complete-cancel.p-button:focus-visible,
.setup-complete-dialog .setup-complete-cancel.p-button:active {
    border: none !important;
    box-shadow: none !important;
    outline: none !important;
    background: var(--p-gray-50) !important;
    color: var(--p-deepblue-900) !important;
}

.setup-complete-dialog .setup-complete-cancel.p-button:hover {
    background: var(--p-tideblue-50) !important;
}

.setup-complete-dialog .setup-complete-cancel .p-button-icon {
    color: var(--p-deepblue-900) !important;
}
</style>

<style scoped>
.setup-complete-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
}

.setup-complete-header__title {
    color: var(--p-deepblue-900);
    font-family: "TT Norms Pro", sans-serif;
    font-size: 18px;
    font-weight: 500;
    line-height: 26px;
}

:deep(.setup-complete-header__close.p-button),
:deep(.setup-complete-header__close.p-button:hover),
:deep(.setup-complete-header__close.p-button:focus),
:deep(.setup-complete-header__close.p-button:focus-visible),
:deep(.setup-complete-header__close.p-button:active) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    min-width: 40px;
    padding: 0;
    background: transparent;
    color: var(--p-deepblue-900);
    box-shadow: none;
    outline: none;
}

.setup-complete-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    width: 100%;
    padding: 10px 20px 28px;
    box-sizing: border-box;
}

.setup-complete-icon {
    font-size: 56px;
    color: var(--p-vividgreen-500);
}

.setup-complete-message {
    margin: 0;
    color: var(--p-vividgreen-500);
    font-family: "TT Norms Pro", sans-serif;
    font-size: 16px;
    font-weight: 700;
    line-height: 24px;
    text-align: center;
}

:deep(.setup-complete-continue.p-button),
:deep(.setup-complete-cancel.p-button) {
    min-height: 36px;
    padding: 0 16px;
    gap: 8px;
    border-radius: var(--p-border-radius-xs) !important;
}

:deep(.setup-complete-continue.p-button) {
    box-shadow: none !important;
}

:deep(.setup-complete-continue .p-button-icon),
:deep(.setup-complete-cancel .p-button-icon) {
    font-size: 16px;
}

:deep(.setup-complete-continue .p-button-label),
:deep(.setup-complete-cancel .p-button-label) {
    font-family: "TT Norms Pro", sans-serif;
    font-size: 14px;
    font-weight: 700;
    line-height: 22px;
}

@media (max-width: 640px) {
    .setup-complete-dialog .p-dialog-header {
        padding: 14px 14px 10px 16px !important;
    }

    .setup-complete-dialog .p-dialog-footer {
        padding: 0 16px 16px !important;
        gap: 10px;
        flex-wrap: wrap;
    }

    .setup-complete-header__title {
        font-size: 16px;
        line-height: 24px;
    }

    .setup-complete-body {
        gap: 14px;
        padding: 6px 16px 20px;
    }

    .setup-complete-icon {
        font-size: 34px;
    }

    .setup-complete-message {
        font-size: 14px;
        line-height: 20px;
    }

    :deep(.setup-complete-continue.p-button),
    :deep(.setup-complete-cancel.p-button) {
        flex: 1 1 calc(50% - 5px);
        justify-content: center;
        min-width: 0;
    }
}

@media (max-width: 420px) {
    .setup-complete-icon {
        font-size: 30px;
    }

    .setup-complete-message {
        font-size: 13px;
        line-height: 18px;
    }

    .setup-complete-dialog .p-dialog-footer {
        flex-direction: column;
    }

    :deep(.setup-complete-continue.p-button),
    :deep(.setup-complete-cancel.p-button) {
        width: 100%;
        flex-basis: auto;
    }
}
</style>
