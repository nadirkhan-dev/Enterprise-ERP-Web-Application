<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  disableLoader: true,
})

useHead({
  title: 'Login',
  meta: [
    { name: 'description', content: 'Sign in to Liberty Connect to manage your HVAC and manufacturing operations.' },
  ],
})

import EyeIcon from '@primevue/icons/eye'
import EyeSlashIcon from '@primevue/icons/eyeslash'
import { useAuthStore } from '~/stores/auth'
import { useTfaSetup } from '~/composables/useTfaSetup'
import { useCardSwapTransition } from '~/composables/useCardSwapTransition'
import { DEFAULT_ROUTE } from '~/config/routes'

const authStore = useAuthStore()
const tfaSetup = useTfaSetup()
const route = useRoute()

// TOTP, as every authenticator app emits it. Matches LoginTfaSetup's `codeLength`.
const OTP_LENGTH = 6

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const rememberMe = ref(false)
const errorMsg = ref('')
const successMsg = ref('')
const displayForgotPassword = ref(false)
// After a reset link is sent, the card swaps to the "Check your email" state.
const displayCheckEmail = ref(false)
const resendSuccess = ref(false)
const displayOneTimePasscode = ref(false)
const oneTimePasscode = ref('')
const showOneTimePasscode = ref(false)

const displayTfaSetup = ref(false)
const displayTfaComplete = ref(false)
const isPreparingTfa = ref(false)
const isContinuingAfterTfa = ref(false)

// The server ships this form as plain HTML, but its `@submit.prevent` handler only
// exists once Vue mounts — and Nuxt holds that mount back until the global auth
// middleware finishes, which for a signed-in-but-2FA-pending session means several
// Directus round-trips. Click "Log in" during that window and the browser performs
// its own form submit instead: a GET to `/login?` (the inputs carry no `name`, so
// the query comes out empty) that reloads the page straight back into the same
// window. Gating the submit button on being mounted closes it — a disabled default
// button also suppresses Enter-to-submit — and the spinner says why it's waiting.
const isHydrated = ref(false)
onMounted(() => {
  isHydrated.value = true
})

const isLoginLoading = computed(
  () => !isHydrated.value || authStore.loading || isPreparingTfa.value,
)

// Sent here by the auth middleware because a policy now requires 2FA of this
// account and it hasn't enrolled. Enrolment runs off the password, which only
// sign-in has — so explain the bounce rather than showing a bare login screen.
onMounted(() => {
  if (route.query.tfa === 'required') {
    errorMsg.value = 'Two-factor authentication is required for your account. Sign in to set it up.'
  }
})

// Tell the auth layout to hide its brand panel on mobile while TFA setup or
// complete is shown — those screens take over the full card stage on mobile,
// the "Are you an Enterprise User?" tagline below would just clutter it.
const isAuthBrandHidden = useState('authBrandHidden', () => false)
watch(
  [displayTfaSetup, displayTfaComplete],
  ([setup, complete]) => {
    isAuthBrandHidden.value = setup || complete
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  isAuthBrandHidden.value = false
})

function toggleForgotPassword(show: boolean) {
  displayForgotPassword.value = show
  displayCheckEmail.value = false
  resendSuccess.value = false
  errorMsg.value = ''
  successMsg.value = ''
}

watch(oneTimePasscode, (code) => {
  // Authenticator codes are six digits and nothing else — strip anything that
  // isn't one (pasting "123 456" should still work) and refuse the overflow.
  // Re-assigning runs this watcher again, this time with a clean value.
  const digits = code.replace(/\D/g, '').slice(0, OTP_LENGTH)
  if (digits !== code) {
    oneTimePasscode.value = digits
    return
  }

  // Editing the code hides the error — but a rejected attempt *empties* the field
  // to make room for the next one, and that self-inflicted change must not wipe
  // the "Invalid passcode" message set alongside it, or the failure goes silent.
  if (code && errorMsg.value) {
    errorMsg.value = ''
  }

  if (code.length === OTP_LENGTH && displayOneTimePasscode.value) {
    handleSubmit()
  }
})
watch([email, password], () => {
  if (errorMsg.value) errorMsg.value = ''
})

// Directus-style expand transition: height auto via JS hooks
function handleOtpBeforeEnter(element) {
  element.style.height = '0px'
  element.style.marginTop = '0px'
  element.style.marginBottom = '0px'
  element.style.opacity = '0'
}

function handleOtpEnter(element) {
  const targetHeight = element.scrollHeight
  requestAnimationFrame(() => {
    element.style.height = `${targetHeight}px`
    element.style.marginTop = ''
    element.style.marginBottom = ''
    element.style.opacity = ''
  })
}

function handleOtpAfterEnter(element) {
  element.style.height = ''
}

const swap = useCardSwapTransition()

function handleOtpLeave(element) {
  element.style.height = `${element.scrollHeight}px`
  void element.offsetHeight
  requestAnimationFrame(() => {
    element.style.height = '0px'
    element.style.marginTop = '0px'
    element.style.marginBottom = '0px'
    element.style.opacity = '0'
  })
}

function redirectAfterLogin() {
  const redirectPath = sessionStorage.getItem('auth:redirect') || DEFAULT_ROUTE
  sessionStorage.removeItem('auth:redirect')
  sessionStorage.setItem('auth:fadeIn', '1')
  navigateTo(redirectPath)
}

async function handleSubmit() {
  errorMsg.value = ''
  email.value = email.value.trim()

  // OTP step — user has already entered email/password, now entering the code
  if (displayOneTimePasscode.value) {
    // A short code can only be rejected, and each rejection counts against the
    // account's login attempts — say so here instead of spending one.
    if (oneTimePasscode.value.length !== OTP_LENGTH) {
      errorMsg.value = `Please enter the ${OTP_LENGTH}-digit code from your authenticator app.`
      return
    }

    try {
      await authStore.login(email.value, password.value, rememberMe.value, oneTimePasscode.value)
      redirectAfterLogin()
    } catch {
      errorMsg.value = 'Invalid passcode. Please try again.'
      oneTimePasscode.value = ''
    }
    return
  }

  if (!email.value || !password.value) {
    errorMsg.value = 'Please enter your email and password.'
    return
  }

  try {
    await authStore.login(email.value, password.value, rememberMe.value)

    // Login succeeded — check if user needs TFA setup
    isPreparingTfa.value = true
    const tfaCheck = await tfaSetup.checkAndGenerateSecret(password.value)
    isPreparingTfa.value = false
    password.value = ''

    if (tfaCheck.needsSetup) {
      displayTfaSetup.value = true
    } else {
      redirectAfterLogin()
    }
  } catch (loginError: unknown) {
    isPreparingTfa.value = false
    if (loginError && typeof loginError === 'object' && 'otpRequired' in loginError) {
      // Re-mask the password: the field is disabled on the OTP step, so a
      // toggled-on "show password" would otherwise leave it unmasked.
      showPassword.value = false
      displayOneTimePasscode.value = true
      return
    }
    errorMsg.value = 'Invalid email or password.'
  }
}

async function handleTfaVerify(code: string) {
  if (tfaSetup.isVerifyingAuthenticator.value) return

  errorMsg.value = ''

  const result = await tfaSetup.verifyCode(code)

  if (result.success) {
    displayTfaSetup.value = false
    displayTfaComplete.value = true
  } else {
    errorMsg.value = result.errorMessage || 'Invalid code. Please try again.'
  }
}

function handleTfaSkip() {
  redirectAfterLogin()
}

function handleTfaContinue() {
  if (isContinuingAfterTfa.value) return

  isContinuingAfterTfa.value = true
  redirectAfterLogin()
}

async function handleForgotPassword() {
  errorMsg.value = ''
  successMsg.value = ''
  email.value = email.value.trim()

  if (!email.value) {
    errorMsg.value = 'Please enter your email address.'
    return
  }

  try {
    await authStore.requestPasswordReset(email.value)
    // Swap to the "Check your email" card rather than showing an inline message.
    displayCheckEmail.value = true
  } catch {
    errorMsg.value = 'Unable to send reset link. Please try again later.'
  }
}

// Re-send the reset link from the "Check your email" card; a transient confirmation
// replaces the toast we don't have on the auth screens.
async function handleResendReset() {
  errorMsg.value = ''
  resendSuccess.value = false
  try {
    await authStore.requestPasswordReset(email.value)
    resendSuccess.value = true
    setTimeout(() => { resendSuccess.value = false }, 4000)
  } catch {
    errorMsg.value = 'Unable to resend the reset link. Please try again later.'
  }
}
</script>

<template>
  <div class="login-page">
    <div
      class="login-card auth-card-entrance"
      :class="{ 'login-card--tfa': displayTfaSetup || displayTfaComplete }"
    >
      <Button
        v-if="displayForgotPassword && !displayCheckEmail"
        icon="pi pi-times"
        text
        rounded
        severity="secondary"
        aria-label="Back to login"
        class="login-close"
        @click="toggleForgotPassword(false)"
      />

      <img
        v-if="!displayTfaSetup && !displayTfaComplete && !displayCheckEmail"
        src="/logo.svg"
        alt="Connect"
        class="login-logo"
        width="80"
        height="80"
      />

      <Transition
        name="card-swap"
        mode="out-in"
        @before-enter="swap.onBeforeEnter"
        @enter="swap.onEnter"
        @leave="swap.onLeave"
      >
        <div
          v-if="displayTfaSetup || displayTfaComplete"
          key="tfa"
          class="login-card__content"
        >
          <LoginTfaSetup
            :mode="displayTfaComplete ? 'complete' : 'setup'"
            :secret="tfaSetup.authenticatorSecret.value"
            :otpauth-url="tfaSetup.authenticatorOtpauthUrl.value"
            :loading="displayTfaComplete ? isContinuingAfterTfa : tfaSetup.isVerifyingAuthenticator.value"
            :required="tfaSetup.isTfaRequired.value"
            :error-message="errorMsg"
            @verify="handleTfaVerify"
            @skip="handleTfaSkip"
            @continue="handleTfaContinue"
            @clear-error="errorMsg = ''"
          />
        </div>

        <div
          v-else-if="displayCheckEmail"
          key="check-email"
          class="login-card__content login-check-email"
        >
          <i
            class="pi pi-envelope login-check-email__icon"
            aria-hidden="true"
          />
          <div class="login-check-email__body">
            <h2 class="login-check-email__title">
              Check your email
            </h2>
            <p class="login-check-email__text">
              We sent a password reset link to <strong>{{ email }}</strong>. Click the
              reset button in the email to create a new password.
            </p>
          </div>

          <Transition enter-active-class="message-enter-active">
            <div
              v-if="errorMsg"
              :key="errorMsg"
              class="login-error-message login-check-email__message"
            >
              <span>{{ errorMsg }}</span>
            </div>
          </Transition>
          <Transition enter-active-class="message-enter-active">
            <div
              v-if="resendSuccess"
              key="resend"
              class="login-success-message login-check-email__message"
            >
              <span>Reset link sent again.</span>
            </div>
          </Transition>

          <Button
            size="large"
            fluid
            :label="authStore.loading ? undefined : 'Resend reset link'"
            :disabled="authStore.loading"
            class="login-submit login-check-email__resend"
            @click="handleResendReset"
          >
            <BaseSpinner
              v-if="authStore.loading"
              size="sm"
              class="login-submit__spinner"
            />
          </Button>
        </div>

        <div
          v-else
          key="auth-form"
          class="login-card__content"
          :class="{ 'login-card__content--reset': displayForgotPassword }"
        >
        <div class="login-header">
          <img src="/CONNECT.svg" alt="Company Name" class="login-brand" />
          <p class="login-subtitle">
            {{
              !displayForgotPassword
                ? 'By Liberty Supply'
                : `Enter your email address and we'll send you a link to reset your password.`
            }}
          </p>

          <Transition enter-active-class="message-enter-active">
            <div
              v-if="errorMsg"
              :key="errorMsg"
              class="login-error-message"
            >
              <span>{{ errorMsg }}</span>
            </div>
          </Transition>

          <Transition enter-active-class="message-enter-active">
            <div
              v-if="successMsg"
              :key="successMsg"
              class="login-success-message"
            >
              <span>{{ successMsg }}</span>
            </div>
          </Transition>
        </div>

        <div class="login-form">
          <Transition
            name="card-swap"
            mode="out-in"
            @before-enter="swap.onBeforeEnter"
            @enter="swap.onEnter"
            @leave="swap.onLeave"
          >
          <form
            v-if="!displayForgotPassword"
            key="login-form"
            class="auth-form"
            @submit.prevent="handleSubmit"
          >
            <div class="login-fields">
              <div class="form-field">
                <label
                  for="email"
                  class="form-field__label"
                >
                  Email<span class="form-field__required"> *</span>
                </label>
                <InputText
                  id="email"
                  v-model="email"
                  placeholder="Email address"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                  :disabled="displayOneTimePasscode"
                />
              </div>

              <div class="login-password-section">
                <div class="form-field">
                  <label
                    for="password"
                    class="form-field__label"
                  >
                    Password<span class="form-field__required"> *</span>
                  </label>
                  <IconField icon-position="right">
                    <InputText
                      id="password"
                      v-model="password"
                      placeholder="Password"
                      :type="showPassword ? 'text' : 'password'"
                      :disabled="displayOneTimePasscode"
                    />
                    <InputIcon>
                      <component
                        :is="showPassword ? EyeIcon : EyeSlashIcon"
                        class="password-toggle"
                        @click="showPassword = !showPassword"
                      />
                    </InputIcon>
                  </IconField>
                </div>

                <div class="login-row">
                  <div class="checkbox-field">
                    <Checkbox
                      v-model="rememberMe"
                      binary
                      inputId="remember"
                    />
                    <label
                      for="remember"
                      class="checkbox-field__label"
                    >
                      Remember me
                    </label>
                  </div>
                  <Button
                    link
                    label="Forgot Password?"
                    class="login-forgot"
                    @click="toggleForgotPassword(true)"
                  />
                </div>
              </div>
            </div>

            <Transition
              name="otp-expand"
              @before-enter="handleOtpBeforeEnter"
              @enter="handleOtpEnter"
              @after-enter="handleOtpAfterEnter"
              @leave="handleOtpLeave"
            >
              <div
                v-if="displayOneTimePasscode"
                class="form-field login-otp"
              >
                <label
                  for="one-time-passcode"
                  class="form-field__label"
                >
                  One-Time Passcode<span class="form-field__required"> *</span>
                </label>
                <IconField icon-position="right">
                  <InputText
                    id="one-time-passcode"
                    v-model="oneTimePasscode"
                    :placeholder="`Enter ${OTP_LENGTH}-digit passcode`"
                    type="text"
                    :invalid="!!errorMsg"
                    :class="{ 'login-otp__input--masked': !showOneTimePasscode }"
                    :maxlength="OTP_LENGTH"
                    name="one-time-code"
                    autocomplete="off"
                    inputmode="numeric"
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                  />
                  <InputIcon>
                    <component
                      :is="showOneTimePasscode ? EyeIcon : EyeSlashIcon"
                      class="password-toggle"
                      @click="showOneTimePasscode = !showOneTimePasscode"
                    />
                  </InputIcon>
                </IconField>
              </div>
            </Transition>

            <Button
              size="large"
              fluid
              :label="isLoginLoading ? undefined : 'Log in'"
              :disabled="isLoginLoading"
              type="submit"
              class="login-submit"
            >
              <BaseSpinner
                v-if="isLoginLoading"
                size="sm"
                class="login-submit__spinner"
              />
            </Button>
          </form>

          <form
            v-else
            key="forgot-form"
            class="auth-form"
            @submit.prevent="handleForgotPassword"
          >
            <div class="login-fields">
              <div class="form-field">
                <label
                  for="email"
                  class="form-field__label"
                >
                  Email<span class="form-field__required"> *</span>
                </label>
                <InputText
                  id="email"
                  v-model="email"
                  placeholder="Email"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                />
              </div>
            </div>

            <Button
              size="large"
              fluid
              :label="authStore.loading ? undefined : 'Send Reset Link'"
              :disabled="authStore.loading"
              type="submit"
              class="login-submit"
            >
              <BaseSpinner
                v-if="authStore.loading"
                size="sm"
                class="login-submit__spinner"
              />
            </Button>
          </form>
          </Transition>
        </div>
        </div>
      </Transition>
    </div>

  </div>
</template>

<style scoped>
.login-page {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 100%;
}

/* Card — fluid, rubber-bands with viewport */
.login-card {
    position: relative;
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-sm);
    width: min(100% - var(--p-spacing-8), 438px);
    padding: clamp(var(--p-spacing-3), 5vh, var(--p-spacing-12)) clamp(var(--p-spacing-10), 10vw, var(--p-spacing-20));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(var(--p-spacing-2), 2vh, var(--p-spacing-4));
}

.login-card--tfa {
    --tfa-qr-size: clamp(calc(var(--p-spacing-16) * 1.5), min(38vw, 28vh), calc(var(--p-spacing-20) * 2.75));
    --tfa-section-width: calc(var(--tfa-qr-size) + var(--p-spacing-2) * 2 + 2px);
    gap: clamp(var(--p-spacing-2), 2vh, var(--p-spacing-6));
}

.login-logo {
    width: 80px;
    height: 80px;
}
.login-close.p-button {
    position: absolute !important;
    top: var(--p-spacing-3);
    right: var(--p-spacing-3);
    left: auto;
    box-sizing: border-box;
    width: var(--p-spacing-8);
    height: var(--p-spacing-8);
    min-width: var(--p-spacing-8);
    padding: var(--p-spacing-2);
    color: var(--p-deepblue-900);
    border-radius: var(--p-border-radius-sm);
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.login-close.p-button:hover,
.login-close.p-button:focus-visible,
.login-close.p-button:active {
    background: var(--p-tideblue-50);
    color: var(--p-skyblue-600);
}

.login-brand {
    width: 100%;
    max-width: 50%;
    height: auto;
    margin: 0 auto;
}

.login-card__content {
    width: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-4);
}

/* Reset flow: tighten the description → email-field gap to spacing-8 (32px), down
   from the login view's 40px (card gap 16 + form margin-top 24). */
.login-card__content--reset {
    gap: var(--p-spacing-8);
}

.login-card__content--reset .login-form {
    margin-top: 0;
}

.login-header {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-6);
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

.login-subtitle {
    font-size: var(--p-font-size-md);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
    line-height: var(--p-font-line-height-normal);
    margin: calc((1 - var(--p-font-line-height-normal)) / 2 * 1em) 0 0;
}

.login-form {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-8);
    width: 100%;
    margin-top: var(--p-spacing-6);
}

/* "Check your email" confirmation card (Figma 6665-155110) — envelope, heading,
   the address we sent to, and a resend action, in place of the CONNECT logo.
   spacing-8 rhythm between icon / text block / resend, matching the success card. */
.login-check-email {
    gap: var(--p-spacing-8);
    text-align: center;
}

/* Title + description grouped tight (matching "Password reset successful"), so the
   spacing between the two lines is consistent across both confirmation cards. */
.login-check-email__body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-1-75);
}

.login-check-email__icon {
    /* Figma envelope icon is 50px — 5xl (48px) is the matching token. */
    font-size: var(--p-font-size-5xl);
    color: var(--p-skyblue-600);
    line-height: 1;
}

.login-check-email__title {
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-font-line-height-snug);
    margin: 0;
}

.login-check-email__text {
    max-width: 300px;
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
    line-height: var(--p-font-line-height-normal);
    margin: 0;
}

.login-check-email__text strong {
    color: var(--p-deepblue-900);
    font-weight: var(--p-font-weight-medium);
}

.login-check-email__message {
    width: 100%;
}

.login-check-email__resend {
    width: 100%;
}

.login-fields {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-6);
    margin-bottom: var(--p-spacing-8);
}

.login-fields :deep(.form-field) {
    gap: var(--p-spacing-0);
}

.login-password-section {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}

:deep(.password-toggle.p-button) {
    width: auto;
    height: auto;
    padding: 0;
    color: var(--p-text-muted-color);
}

:deep(.password-toggle) {
    width: var(--p-font-size-sm);
    height: var(--p-font-size-sm);
}

:deep(input[type="password"]::-ms-reveal),
:deep(input[type="password"]::-ms-clear) {
    display: none;
}

/* Row: remember me + forgot password */
.login-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
}

:deep(.login-forgot.p-button-link) {
    padding: var(--p-spacing-1) var(--p-spacing-2);
    border-radius: var(--p-border-radius-xs);
    font-size: var(--p-font-size-xs);
}

/* Match the app's standard text-button hover (tideblue tint) and drop the
   default link underline on hover. */
:deep(.login-forgot.p-button-link:hover) {
    background: var(--p-tideblue-50);
}

:deep(.login-forgot.p-button-link:hover .p-button-label) {
    text-decoration: none;
}

:deep(.p-button-label) {
    font-weight: var(--p-font-weight-medium);
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
}

.login-success-message {
    border: 1px solid var(--p-vividgreen-300);
    background-color: var(--p-vividgreen-50);
    color: var(--p-vividgreen-300);
    margin-top: var(--p-spacing-2);
    padding: var(--p-spacing-2);
    border-radius: var(--p-border-radius-sm);
    font-size: var(--p-font-size-sm);
}

.login-otp {
    margin: var(--p-spacing-8) 0;
    width: 100%;
    gap: var(--p-spacing-1);
}

/* Keep OTP's own 32px margin as the sole top/bottom spacing — neutralize parent gap/margin */
.login-form:has(.login-otp) {
    gap: 0;
}

.login-form:has(.login-otp) .login-fields {
    margin-bottom: 0;
}

.login-otp :deep(.form-field__label) {
    margin: 0;
    padding: 0;
    line-height: 1.2;
}

.login-otp :deep(.p-iconfield),
.login-otp :deep(.p-inputtext) {
    width: 100%;
}

/* OTP field entrance + polish */
.login-otp {
    position: relative;
    padding: 0;
    background: var(--p-surface-0);
}

/* Directus-style expand: JS hooks animate height 0 → scrollHeight → auto */
.otp-expand-enter-active,
.otp-expand-leave-active {
    overflow: hidden;
    transition:
        height 400ms cubic-bezier(0.4, 0, 0.2, 1),
        margin-top 400ms cubic-bezier(0.4, 0, 0.2, 1),
        margin-bottom 400ms cubic-bezier(0.4, 0, 0.2, 1),
        opacity 300ms cubic-bezier(0.4, 0, 0.2, 1);
    will-change: height, margin-top, margin-bottom, opacity;
}

.login-otp :deep(.p-inputtext) {
    transition:
        border-color var(--p-transition-duration, 160ms) var(--p-transition-timing-ease-out, ease-out),
        box-shadow var(--p-transition-duration, 160ms) var(--p-transition-timing-ease-out, ease-out);
}

.login-otp :deep(.p-inputtext.login-otp__input--masked) {
    -webkit-text-security: disc;
    text-security: disc;
}

/* Focus and invalid states are deliberately NOT overridden here: the passcode is
   an input like any other, and every one of them gets its red border, red value +
   placeholder and error pulse from form-field.css. The overrides this replaces
   suppressed the focus ring and hand-rolled the red border, so the one field where
   a wrong value is most likely was also the one that looked least wrong. */

.login-otp :deep(.password-toggle) {
    cursor: pointer;
    transition:
        color var(--p-transition-duration, 160ms) var(--p-transition-timing-ease-out, ease-out),
        opacity var(--p-transition-duration, 160ms) var(--p-transition-timing-ease-out, ease-out);
}

.login-otp :deep(.password-toggle:hover) {
    opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
    .otp-expand-enter-active,
    .otp-expand-leave-active {
        transition: none;
    }

    .login-otp :deep(.p-inputtext),
    .login-otp :deep(.password-toggle) {
        transition: none;
    }
}

/* Login button spinner (also reaches into LoginTfaSetup): only the layout differs —
   the label is hidden while loading, so center the spinner. Colors and animation are
   left to BaseSpinner's defaults to stay consistent with every other loading button. */
:deep(.login-submit__spinner) {
    margin: 0 auto;
}

.login-submit.p-button {
    font-size: var(--p-font-size-base);
}

/* Inactive button — the Figma disabled state (button/primary/disabled): a flat
   grey fill at 70% opacity with muted grey text, consistent with the password
   reset CTA and every other auth button. */
.login-submit.p-button:disabled {
    background: var(--p-gray-100);
    border-color: var(--p-gray-100);
    color: var(--p-gray-500);
    opacity: 0.7;
}
</style>
