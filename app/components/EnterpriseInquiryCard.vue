<script setup lang="ts">
import { useCardSwapTransition } from '~/composables/useCardSwapTransition'

const emit = defineEmits<{
  close: []
}>()

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const formState = reactive({
  companyName: '',
  yourName: '',
  // PhoneNumberInput value shape — same component/formatting as the contact
  // phone drawer (AsYouType, defaults to US). `number` is digits-only national.
  phoneNumber: { countriesId: null as number | null, number: '', extension: null as string | null },
  emailAddress: '',
})

const config = useRuntimeConfig()
const toast = useToast()
const isTurnstileEnabled = computed(() => Boolean(config.public.turnstileSiteKey))

const isSubmitted = ref(false)
const isSubmitting = ref(false)
const wasSubmitAttempted = ref(false)
const isEmailTouched = ref(false)
const submitError = ref('')
const turnstileToken = ref<string | null>(null)
const turnstileRef = ref<{ reset: () => void } | null>(null)

// Block submission while submitting, or until the bot challenge is passed.
const isSubmitDisabled = computed(
  () => isSubmitting.value || (isTurnstileEnabled.value && !turnstileToken.value),
)

const isEmailValid = computed(() => EMAIL_PATTERN.test(formState.emailAddress.trim()))

const companyError = computed(() =>
  wasSubmitAttempted.value && !formState.companyName.trim()
    ? 'Company name is required.'
    : '',
)
const nameError = computed(() =>
  wasSubmitAttempted.value && !formState.yourName.trim()
    ? 'Your name is required.'
    : '',
)
const phoneError = computed(() =>
  wasSubmitAttempted.value && !formState.phoneNumber.number.trim()
    ? 'Phone number is required.'
    : '',
)
const emailError = computed(() => {
  if (!isEmailTouched.value && !wasSubmitAttempted.value) return ''
  if (!formState.emailAddress.trim()) return 'Email address is required.'
  if (!isEmailValid.value) return 'Please enter a valid email address.'
  return ''
})

function handleEmailBlur() {
  isEmailTouched.value = true
}

function handlePhoneUpdate(value: { countriesId: number | null, number: string, extension?: string | null }) {
  formState.phoneNumber = {
    countriesId: value.countriesId,
    number: value.number,
    extension: value.extension ?? null,
  }
}

function handleTurnstileVerified(token: string) {
  turnstileToken.value = token
}

function handleTurnstileReset() {
  turnstileToken.value = null
}

async function handleSubmit() {
  wasSubmitAttempted.value = true
  isEmailTouched.value = true
  submitError.value = ''
  if (
    !formState.companyName.trim()
    || !formState.yourName.trim()
    || !formState.phoneNumber.number.trim()
    || !isEmailValid.value
  ) {
    return
  }
  if (isTurnstileEnabled.value && !turnstileToken.value) {
    submitError.value = 'Please complete the verification challenge.'
    return
  }

  isSubmitting.value = true
  const { error } = await tryCatch(
    $fetch('/api/enterprise-inquiry', {
      method: 'POST',
      body: {
        companyName: formState.companyName.trim(),
        yourName: formState.yourName.trim(),
        phoneNumber: formState.phoneNumber.number.trim(),
        emailAddress: formState.emailAddress.trim(),
        turnstileToken: turnstileToken.value,
      },
    }),
  )
  isSubmitting.value = false

  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Submission failed',
      detail: 'Could not send your inquiry. Please try again.',
      life: 4000,
    })
    // The token is single-use — reset the widget so the user can retry.
    turnstileToken.value = null
    turnstileRef.value?.reset()
    return
  }

  isSubmitted.value = true
}

function handleBackToLogin() {
  emit('close')
}

function handleOpenWebsite() {
  if (typeof window !== 'undefined') {
    window.open('https://libertysupply.com', '_blank', 'noopener,noreferrer')
  }
}

const swap = useCardSwapTransition()
</script>

<template>
  <div
    class="enterprise-inquiry"
    :class="{ 'enterprise-inquiry--success': isSubmitted }"
  >
    <Transition
      name="card-swap"
      mode="out-in"
      @before-enter="swap.onBeforeEnter"
      @enter="swap.onEnter"
      @leave="swap.onLeave"
    >
      <div
        v-if="!isSubmitted"
        key="form-mode"
        class="enterprise-inquiry__mode"
      >
        <span class="enterprise-inquiry__close-slot">
          <Button
            icon="pi pi-times"
            text
            rounded
            aria-label="Close"
            @click="emit('close')"
          />
        </span>

        <div class="enterprise-inquiry__header">
          <img
            src="/logo.svg"
            alt="Connect"
            class="enterprise-inquiry__logo"
            width="80"
            height="80"
          />
          <img
            src="/CONNECT.svg"
            alt="Connect"
            class="enterprise-inquiry__wordmark"
          />
          <p class="enterprise-inquiry__subtitle">By Liberty Supply</p>
        </div>

        <form
          class="enterprise-inquiry__form"
          novalidate
          @submit.prevent="handleSubmit"
        >
      <div class="form-field">
        <label
          for="enterprise-company"
          class="form-field__label"
        >
          Company Name<span class="form-field__required"> *</span>
        </label>
        <BaseClearableInput
          id="enterprise-company"
          v-model="formState.companyName"
          v-trim
          placeholder="Enter company name"
          :invalid="!!companyError"
          fluid
        />
        <span
          v-if="companyError"
          class="form-field__error"
        >{{ companyError }}</span>
      </div>

      <div class="form-field">
        <label
          for="enterprise-name"
          class="form-field__label"
        >
          Your Name<span class="form-field__required"> *</span>
        </label>
        <BaseClearableInput
          id="enterprise-name"
          v-model="formState.yourName"
          v-trim
          placeholder="Enter your full name"
          :invalid="!!nameError"
          fluid
        />
        <span
          v-if="nameError"
          class="form-field__error"
        >{{ nameError }}</span>
      </div>

      <div class="form-field">
        <label
          for="enterprise-phone"
          class="form-field__label"
        >
          Phone Number<span class="form-field__required"> *</span>
        </label>
        <PhoneNumberInput
          input-id="enterprise-phone"
          :model-value="formState.phoneNumber"
          hide-country
          hide-extension
          default-country="US"
          placeholder="(555) 555-5555"
          :invalid="!!phoneError"
          @update:model-value="handlePhoneUpdate"
        />
        <span
          v-if="phoneError"
          class="form-field__error"
        >{{ phoneError }}</span>
      </div>

      <div class="form-field">
        <label
          for="enterprise-email"
          class="form-field__label"
        >
          Email Address<span class="form-field__required"> *</span>
        </label>
        <BaseClearableInput
          id="enterprise-email"
          v-model="formState.emailAddress"
          v-trim
          type="email"
          placeholder="you@domain.com"
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          :invalid="!!emailError"
          fluid
          @blur="handleEmailBlur"
        />
        <span
          v-if="emailError"
          class="form-field__error"
        >{{ emailError }}</span>
      </div>

      <TurnstileWidget
        v-if="isTurnstileEnabled"
        ref="turnstileRef"
        class="enterprise-inquiry__turnstile"
        @verified="handleTurnstileVerified"
        @expired="handleTurnstileReset"
        @error="handleTurnstileReset"
      />

      <span
        v-if="submitError"
        class="enterprise-inquiry__submit-error"
      >{{ submitError }}</span>

      <Button
        type="submit"
        size="large"
        fluid
        :label="isSubmitting ? undefined : 'Submit'"
        :disabled="isSubmitDisabled"
        class="enterprise-inquiry__submit"
      >
        <BaseSpinner
          v-if="isSubmitting"
          size="sm"
          class="enterprise-inquiry__submit-spinner"
        />
      </Button>
    </form>
      </div>

      <div
        v-else
        key="success-mode"
        class="enterprise-inquiry__success enterprise-inquiry__mode"
      >
        <i
          class="pi pi-check-circle enterprise-inquiry__success-icon"
          aria-hidden="true"
        />
        <h3 class="enterprise-inquiry__success-title">Got it. We'll be in touch!</h3>
        <div class="enterprise-inquiry__success-actions">
          <Button
            severity="secondary"
            icon="pi pi-arrow-left"
            label="Back to Login"
            class="enterprise-inquiry__success-back"
            @click="handleBackToLogin"
          />
          <Button
            label="LibertySupply.com"
            icon="pi pi-arrow-right"
            icon-pos="right"
            class="enterprise-inquiry__success-website"
            @click="handleOpenWebsite"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.enterprise-inquiry {
    position: relative;
    width: min(100% - var(--p-spacing-8), 438px);
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-sm);
    padding: clamp(var(--p-spacing-3), 5vh, var(--p-spacing-12)) clamp(var(--p-spacing-10), 8vw, var(--p-spacing-20));
    display: flex;
    flex-direction: column;
    align-items: center;
}

.enterprise-inquiry__mode {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(var(--p-spacing-3), 3vh, var(--p-spacing-10));
}

.enterprise-inquiry--success {
    width: min(100% - var(--p-spacing-8), calc(var(--p-spacing-20) * 7));
}

.enterprise-inquiry__close-slot {
    position: absolute;
    top: var(--p-spacing-3);
    right: var(--p-spacing-3);
    z-index: 1;
}

.enterprise-inquiry__close-slot :deep(.p-button) {
    display: flex;
    width: var(--p-spacing-9);
    height: var(--p-spacing-9);
    padding: var(--p-spacing-1.75) 0;
    justify-content: center;
    align-items: center;
    border-radius: var(--p-border-radius-sm);
    background: var(--p-surface-0);
    color: var(--p-deepblue-900);
}

.enterprise-inquiry__close-slot :deep(.p-button:hover) {
    background: var(--p-tideblue-50);
}

.enterprise-inquiry__header {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    text-align: center;
    gap: var(--p-spacing-4);
}

.enterprise-inquiry__logo {
    width: var(--p-spacing-20);
    height: var(--p-spacing-20);
}

.enterprise-inquiry__wordmark {
    width: 100%;
    max-width: 50%;
    height: auto;
    margin: 0 auto;
}

.enterprise-inquiry__subtitle {
    margin: 0;
    color: var(--p-gray-800);
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-normal);
}

.enterprise-inquiry__form {
    display: flex;
    flex-direction: column;
    width: 100%;
    gap: clamp(var(--p-spacing-3), 2.5vh, var(--p-spacing-6));
}

.enterprise-inquiry__form :deep(.form-field) {
    gap: var(--p-spacing-0);
}

.enterprise-inquiry__form :deep(.form-field__error) {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: var(--p-spacing-1);
    line-height: 1;
}

.enterprise-inquiry__form :deep(.p-inputtext) {
    width: 100%;
}

.enterprise-inquiry__turnstile {
    margin-top: var(--p-spacing-2);
}

.enterprise-inquiry__submit-error {
    color: var(--p-red-700);
    font-size: var(--p-font-size-sm);
    line-height: var(--p-font-line-height-normal);
    text-align: center;
}

:deep(.enterprise-inquiry__submit.p-button) {
    margin-top: var(--p-spacing-2);
}

/* Loading state — centered spinner with white dots on the primary button,
   matching the login submit button. */
/* Label is hidden while loading, so center the spinner. Colors are left to
   BaseSpinner's defaults for consistency with every other loading button. */
:deep(.enterprise-inquiry__submit-spinner) {
    margin: 0 auto;
}

.enterprise-inquiry__success {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-5);
    text-align: center;
}

.enterprise-inquiry__success-icon {
    width: var(--p-spacing-12);
    height: var(--p-spacing-12);
    font-size: var(--p-spacing-12);
    line-height: 1;
    color: var(--p-vividgreen-500);
}

.enterprise-inquiry__success-title {
    margin: 0;
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

.enterprise-inquiry__success-actions {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--p-spacing-3);
    width: 100%;

    @media (min-width: 480px) {
        flex-direction: row;
    }
}

.enterprise-inquiry__success-actions :deep(.p-button) {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--p-spacing-1.75);
    padding: var(--p-spacing-2.25) var(--p-spacing-3);
}

:deep(.enterprise-inquiry__success-back.p-button) {
    background: var(--p-gray-100);
    border-color: var(--p-gray-100);
    color: var(--p-deepblue-900);
}

:deep(.enterprise-inquiry__success-back.p-button:hover) {
    background: var(--p-tideblue-50);
    border-color: var(--p-tideblue-50);
    color: var(--p-deepblue-900);
}
</style>