<script setup lang="ts">
import QRCode from 'qrcode'
import { useCardSwapTransition } from '~/composables/useCardSwapTransition'

interface Props {
  mode: 'setup' | 'complete'
  secret: string
  otpauthUrl: string
  codeLength?: number
  loading?: boolean
  required?: boolean
  errorMessage?: string
}

const props = withDefaults(defineProps<Props>(), {
  codeLength: 6,
  loading: false,
  required: false,
  errorMessage: '',
})

const emit = defineEmits<{
  verify: [code: string]
  skip: []
  continue: []
  'clear-error': []
}>()

const verificationCode = ref('')
const qrDataUrl = ref('')
const secretCharacters = computed(() => props.secret.split(''))

watch(() => props.otpauthUrl, async (url) => {
  if (!url) { return }
  try {
    qrDataUrl.value = await QRCode.toDataURL(url, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    })
  } catch {
    // The QR couldn't be generated from this URL — don't strand the user on a
    // stuck/empty setup card; skip the step and continue into the app.
    qrDataUrl.value = ''
    emit('skip')
  }
}, { immediate: true })

watch(verificationCode, (code) => {
  // Editing the code hides the error banner + red input immediately.
  if (props.errorMessage) emit('clear-error')
  if (props.mode === 'setup' && code.length === props.codeLength && !props.loading) {
    handleVerify()
  }
})

watch(() => props.mode, () => {
  verificationCode.value = ''
})

function handleVerify() {
  if (props.loading || verificationCode.value.length !== props.codeLength) return

  emit('verify', verificationCode.value)
}

function handleSkip() {
  if (props.loading) return
  emit('skip')
}

function handleContinue() {
  emit('continue')
}

const swap = useCardSwapTransition()
</script>

<template>
  <Transition
    name="card-swap"
    mode="out-in"
    @before-enter="swap.onBeforeEnter"
    @enter="swap.onEnter"
    @leave="swap.onLeave"
  >
    <div
      v-if="mode === 'complete'"
      key="tfa-complete"
      class="login-tfa-mode login-tfa-mode--complete"
    >
      <i
        class="pi pi-check-circle login-tfa-complete__icon"
        aria-hidden="true"
      />
      <div class="login-tfa-complete__heading">
        <h2 class="login-tfa-complete__title">
          Setup Complete
        </h2>
        <p class="login-tfa-complete__message">
          Setup verification successful
        </p>
      </div>

      <!-- Unlike the full-width Verify/Log in buttons, this one is sized by its own
           content, so swapping the label out for a spinner would collapse it to a
           stub. Drive it with PrimeVue's `loading` instead: the label stays put and
           only the trailing arrow becomes the spinner, so the width holds. -->
      <Button
        label="Continue"
        :loading="loading"
        icon="pi pi-arrow-right"
        icon-pos="right"
        class="login-tfa-complete__continue"
        @click="handleContinue"
      >
        <template #loadingicon>
          <BaseSpinner size="sm" />
        </template>
      </Button>
    </div>

    <div
      v-else
      key="tfa-setup"
      class="login-tfa-mode"
    >
      <div class="login-header">
        <h2 class="login-title login-title--setup">
          Setup Authenticator App
        </h2>
        <p class="login-subtitle">
          Scan the code in your authenticator app to finish setting up 2FA
        </p>

        <Transition enter-active-class="message-enter-active">
          <div
            v-if="errorMessage"
            :key="errorMessage"
            class="login-error-message"
          >
            <span>{{ errorMessage }}</span>
          </div>
        </Transition>
      </div>

      <div class="login-tfa-setup">
        <div class="login-tfa-qr">
          <img
            v-if="qrDataUrl"
            :src="qrDataUrl"
            alt="Scan this QR code with your authenticator app"
            class="login-tfa-qr__image"
          />
          <div
            v-else
            class="login-tfa-qr__placeholder"
          >
            <BaseSpinner size="sm" />
          </div>
        </div>

        <p
          class="login-tfa-secret"
          :style="{ '--tfa-secret-cols': Math.max(secretCharacters.length, 1) }"
        >
          <span
            v-for="(character, index) in secretCharacters"
            :key="`${character}-${index}`"
            class="login-tfa-secret__character"
          >
            {{ character }}
          </span>
        </p>

        <InputText
          v-model="verificationCode"
          type="text"
          inputmode="numeric"
          pattern="[0-9]*"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          :placeholder="`Enter ${codeLength}-digit code`"
          class="login-tfa-input"
          :maxlength="codeLength"
          :invalid="!!errorMessage"
          :disabled="loading"
        />

        <Button
          size="large"
          :label="loading ? undefined : 'Verify'"
          :disabled="loading || verificationCode.length !== codeLength"
          class="login-submit login-tfa-verify"
          @click="handleVerify"
        >
          <BaseSpinner
            v-if="loading"
            size="sm"
            class="login-submit__spinner"
          />
        </Button>

        <Button
          v-if="!required"
          link
          label="Skip for now"
          class="login-back"
          @click="handleSkip"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.login-header {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
    width: 100%;
    text-align: center;
}

.login-title {
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-font-line-height-snug);
    margin: 0;
}

.login-title--setup {
    white-space: nowrap;
}

.login-subtitle {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
    line-height: var(--p-font-line-height-normal);
    margin: 0;
}

.login-error-message {
    border: 1px solid var(--p-red-300);
    background-color: var(--p-red-50);
    color: var(--p-red-700);
    margin-top: var(--p-spacing-2);
    padding: var(--p-spacing-2);
    /* Unified error-message style (matches the global .p-message-error rule). */
    border-radius: var(--p-border-radius-xs);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    line-height: var(--p-font-line-height-snug);
    letter-spacing: var(--p-font-letter-spacing-normal);
    font-feature-settings: 'liga' off, 'clig' off;
}

:deep(.p-button-label) {
    font-weight: var(--p-font-weight-medium);
}

.login-tfa-setup :deep(.login-back.p-button-link) {
    padding-inline: 0;
    font-size: var(--p-font-size-xs);
    width: 100%;
    justify-content: center;
    display: flex;
    align-self: center;
    margin-top: var(--p-spacing-1);
}

.login-tfa-setup :deep(.login-back.p-button-link .p-button-label) {
    flex: 1;
    text-align: center;
}

/* Match the app's standard text-button hover (tideblue tint) and drop the
   default link underline on hover. */
.login-tfa-setup :deep(.login-back.p-button-link:hover) {
    background: var(--p-tideblue-50);
}

.login-tfa-setup :deep(.login-back.p-button-link:hover .p-button-label) {
    text-decoration: none;
}

.login-tfa-mode {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-2);
}

.login-tfa-setup {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-4);
    width: 100%;
}

.login-tfa-qr {
    padding: var(--p-spacing-2);
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
    line-height: 0;
}

.login-tfa-qr__image {
    display: block;
    width: var(--tfa-qr-size);
    aspect-ratio: 1 / 1;
}

.login-tfa-qr__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--tfa-qr-size);
    aspect-ratio: 1 / 1;
}

.login-tfa-secret {
    display: grid;
    grid-template-columns: repeat(var(--tfa-secret-cols, 1), minmax(0, 1fr));
    align-items: center;
    width: var(--tfa-section-width);
    max-width: 100%;
    color: var(--p-gray-500);
    margin: calc(var(--p-spacing-2) * -1) 0 0;
    column-gap: var(--p-spacing-1);
}

.login-tfa-secret__character {
    min-width: 0;
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    line-height: 1;
    text-align: center;
}

.login-tfa-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.login-tfa-verify.p-button) {
    width: 100%;
    margin-top: var(--p-spacing-3);
}

.login-tfa-mode--complete {
    gap: var(--p-spacing-10);
}

.login-tfa-complete__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(var(--p-spacing-12) + 2 * var(--p-spacing-px));
    height: calc(var(--p-spacing-12) + 2 * var(--p-spacing-px));
    font-size: calc(var(--p-spacing-12) + 2 * var(--p-spacing-px));
    line-height: 1;
    color: var(--p-vividgreen-500);
}

.login-tfa-complete__heading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-1);
}

.login-tfa-complete__title {
    margin: 0;
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    line-height: var(--p-spacing-8);
    text-align: center;
}

.login-tfa-complete__message {
    margin: 0;
    color: var(--p-gray-800);
    text-align: center;
    font-family: var(--p-font-family);
    font-size: var(--p-font-size-sm);
    font-style: normal;
    font-weight: var(--p-font-weight-medium);
    line-height: var(--p-spacing-5);
    letter-spacing: 0;
    font-feature-settings: 'liga' off, 'clig' off;
}

</style>
