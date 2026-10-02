<script setup lang="ts">
/**
 * The "something needs a refresh" prompt — logo, heading, one line of
 * explanation, and a pair of actions.
 *
 * Extracted from AppUpdateBanner's simple update prompt when the Cloudflare
 * Access session warning needed the same card. Presentational only: it holds no
 * state and decides nothing, so the two callers stay in charge of when they
 * appear and what they say.
 *
 * `isDismissible` covers the whole escape surface, not just the button — a
 * prompt the user must act on has to close off the mask and the escape key too,
 * or it is only nominally forced.
 */
interface Props {
  visible: boolean
  heading: string
  message: string
  confirmLabel?: string
  dismissLabel?: string
  isDismissible?: boolean
  isConfirming?: boolean
}

withDefaults(defineProps<Props>(), {
  confirmLabel: 'Refresh',
  dismissLabel: 'Not Now',
  isDismissible: true,
  isConfirming: false,
})

const emit = defineEmits<{
  confirm: []
  dismiss: []
}>()

const logoSrc = '/logo.svg'

const dialogStyle = {
  width: '600px',
  maxWidth: 'calc(100vw - 2rem)',
  height: 'auto',
  minHeight: '260px',
  maxHeight: 'calc(100vh - 2rem)',
}

function handleDismiss(): void {
  emit('dismiss')
}
</script>

<template>
  <Dialog
    :visible="visible"
    :style="dialogStyle"
    :closable="false"
    :draggable="false"
    :dismissable-mask="isDismissible"
    :close-on-escape="isDismissible"
    header=" "
    modal
    class="update-dialog update-dialog--simple"
    :pt="{ mask: { class: 'app-backdrop-blur' } }"
    @update:visible="handleDismiss"
  >
    <div class="update-dialog__body">
      <div class="update-dialog__update update-dialog__update--simple">
        <img
          class="update-dialog__logo"
          :src="logoSrc"
          alt="Connect logo"
        >

        <h2 class="update-dialog__heading">
          {{ heading }}
        </h2>

        <p class="update-dialog__message update-dialog__message--update">
          {{ message }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="update-dialog__actions">
        <Button
          v-if="isDismissible"
          :label="dismissLabel"
          severity="secondary"
          @click="handleDismiss"
        />
        <Button
          :label="confirmLabel"
          :loading="isConfirming"
          @click="emit('confirm')"
        >
          <template #loadingicon>
            <BaseSpinner size="sm" />
          </template>
        </Button>
      </div>
    </template>
  </Dialog>
</template>

<style scoped>
/* Kept scoped, matching AppUpdateBanner, rather than moved to main.css with the
   rest of the chrome: `:deep()` compiles to a descendant selector, so hoisting
   it would change which elements it reaches and risk shifting the update card. */
:deep(.update-dialog) {
  overflow: hidden;
  border: 0 !important;
  outline: 1px solid rgba(0, 0, 0, 0.06);
}

.update-dialog__message {
  margin: 0;
  font-size: var(--p-font-size-base);
  font-weight: var(--p-font-weight-normal);
  color: var(--p-surface-500);
}

.update-dialog__message--update {
  color: var(--p-gray-800);
  margin-top: calc(var(--p-spacing-4) * -1 + var(--p-spacing-1));
  margin-bottom: clamp(var(--p-spacing-), calc(var(--p-spacing-7) - 2vw), var(--p-spacing-5));
  text-align: center;
}

.update-dialog__update--simple {
  align-items: center;
  text-align: center;
  padding: 0 clamp(var(--p-spacing-4), 1.2vw, var(--p-spacing-5)) clamp(var(--p-spacing-3), 0.8vw, var(--p-spacing-4));
}
</style>

<style>
.update-dialog--simple .p-dialog-content {
  /* This prompt fits within the fixed dialog height — no scroll needed, so no
     strip is reserved and the right padding returns to the full gutter. */
  padding-right: var(--p-spacing-4-375) !important;
  overflow-y: hidden !important;
  scrollbar-gutter: auto !important;
  scrollbar-width: none !important;
}

.update-dialog--simple .p-dialog-content::-webkit-scrollbar {
  display: none !important;
}
</style>
