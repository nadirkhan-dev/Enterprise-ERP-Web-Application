<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  disableLoader: true,
})

useHead({
  title: 'Create New Password',
  meta: [
    { name: 'description', content: 'Create a new password for your Liberty Connect account.' },
  ],
})

import { useAuthStore } from '~/stores/auth'
import { useCardSwapTransition } from '~/composables/useCardSwapTransition'

const route = useRoute()
const authStore = useAuthStore()
// Height + fade swap between the form and the success card, matching the login.
const swap = useCardSwapTransition()

const newPassword = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const isComplete = ref(false)

const token = computed(() => String(route.query.token || ''))

// Visible checklist rules — mirror the client's target password policy (see the
// Directus AUTH_PASSWORD_POLICY regex). Kept in sync so the checklist never lies:
// a password that ticks every box also passes the server.
const CHECKLIST_RULES = [
  { label: 'At least 8 characters', isMet: (value: string) => value.length >= 8 },
  { label: 'One uppercase letter', isMet: (value: string) => /[A-Z]/.test(value) },
  { label: 'One lowercase letter', isMet: (value: string) => /[a-z]/.test(value) },
  { label: 'One number', isMet: (value: string) => /\d/.test(value) },
  { label: 'One special character', isMet: (value: string) => /[^A-Za-z0-9]/.test(value) },
]

const ruleStates = computed(() => {
  const rules = CHECKLIST_RULES.map((rule) => ({
    label: rule.label,
    isMet: rule.isMet(newPassword.value),
  }))
  // "Passwords match" is the last checklist item — met only once both fields are
  // filled and equal.
  rules.push({
    label: 'Passwords match',
    isMet: newPassword.value.length > 0 && newPassword.value === confirmPassword.value,
  })
  return rules
})

const areVisibleRulesMet = computed(() => ruleStates.value.every((rule) => rule.isMet))

// Silent rules — enforced but not listed in the checklist (per design). Surfaced
// through `hiddenRuleHint` only once the visible rules all pass, so the disabled
// button is never a mystery.
const hasTripleRepeat = computed(() => /(.)\1\1/.test(newPassword.value))
const hasEdgeWhitespace = computed(() => /^\s|\s$/.test(newPassword.value))

const hiddenRuleHint = computed(() => {
  if (!areVisibleRulesMet.value) { return '' }
  if (hasTripleRepeat.value) { return 'Avoid repeating a character 3 or more times in a row.' }
  if (hasEdgeWhitespace.value) { return 'Remove the leading or trailing space.' }
  return ''
})

const isPasswordValid = computed(
  () => areVisibleRulesMet.value && !hasTripleRepeat.value && !hasEdgeWhitespace.value,
)

watch([newPassword, confirmPassword], () => {
  if (errorMsg.value) { errorMsg.value = '' }
})

/**
 * Directus's rejection reason, in plain English. Deliberately never surfaces
 * `extensions.invalid` — that field echoes back the password the user just typed.
 */
function getResetErrorMessage(error: unknown): string {
  const firstError = (error as { errors?: Array<{ extensions?: { code?: string, field?: string } }> })?.errors?.[0]
  const code = firstError?.extensions?.code

  if (code === 'FAILED_VALIDATION' && firstError?.extensions?.field === 'password') {
    return 'That password does not meet the requirements listed above.'
  }
  if (code === 'INVALID_PAYLOAD' || code === 'INVALID_CREDENTIALS' || code === 'FORBIDDEN') {
    return 'This reset link is invalid or has expired. Please request a new one.'
  }
  return 'Something went wrong. Please try again.'
}

async function handleResetPassword() {
  errorMsg.value = ''

  if (!token.value) {
    errorMsg.value = 'This reset link is invalid or has expired. Please request a new one.'
    return
  }
  if (!isPasswordValid.value) { return }

  try {
    await authStore.resetPassword(token.value, newPassword.value)
    // Swap to the success card; the user taps "Log in" to continue (no auto-redirect).
    isComplete.value = true
  } catch (resetError: unknown) {
    errorMsg.value = getResetErrorMessage(resetError)
  }
}
</script>

<template>
  <div class="reset-page">
    <div class="reset-card auth-card-entrance">
      <Transition
        name="card-swap"
        mode="out-in"
        @before-enter="swap.onBeforeEnter"
        @enter="swap.onEnter"
        @leave="swap.onLeave"
      >
        <!-- Success card (Figma 6624-121936) — replaces the whole form once the
             reset lands: green check, confirmation, and a manual Log in action. -->
        <div
          v-if="isComplete"
          key="success"
          class="reset-success"
        >
        <i
          class="pi pi-check-circle reset-success__icon"
          aria-hidden="true"
        />
        <div class="reset-success__body">
          <h2 class="reset-success__title">
            Password reset successful
          </h2>
          <p class="reset-success__text">
            Your password has been updated. You can now log in using your new password.
          </p>
        </div>
        <Button
          size="large"
          fluid
          label="Log in"
          icon="pi pi-arrow-right"
          icon-pos="right"
          class="reset-success__login"
          @click="navigateTo('/login')"
        />
      </div>

        <div
          v-else
          key="form"
          class="reset-form-wrap"
        >
          <i
            class="pi pi-key reset-icon"
            aria-hidden="true"
          />

          <h2 class="reset-title">
            Create new password
          </h2>

          <div class="reset-body">
          <form
            class="auth-form reset-form"
            @submit.prevent="handleResetPassword"
          >
          <div class="reset-rules">
            <p class="reset-rules__heading">
              Passwords must meet the following requirements:
            </p>
            <ul class="reset-rules__list">
              <li
                v-for="rule in ruleStates"
                :key="rule.label"
                :class="['reset-rules__item', { 'reset-rules__item--met': rule.isMet }]"
              >
                <i :class="rule.isMet ? 'pi pi-check' : 'pi pi-circle-fill'" />
                <span>{{ rule.label }}</span>
              </li>
            </ul>
          </div>

          <Transition enter-active-class="message-enter-active">
            <div
              v-if="errorMsg"
              :key="errorMsg"
              class="reset-error"
            >
              <i
                class="pi pi-exclamation-circle"
                aria-hidden="true"
              />
              <span>{{ errorMsg }}</span>
            </div>
          </Transition>

          <div class="reset-fields">
            <div class="form-field">
              <label
                for="new-password"
                class="form-field__label"
              >
                New Password<span class="form-field__required"> *</span>
              </label>
              <Password
                id="new-password"
                v-model="newPassword"
                placeholder="Enter new password"
                toggle-mask
                :feedback="false"
                fluid
              />
            </div>

            <div class="form-field">
              <label
                for="confirm-password"
                class="form-field__label"
              >
                Confirm Password<span class="form-field__required"> *</span>
              </label>
              <Password
                id="confirm-password"
                v-model="confirmPassword"
                placeholder="Confirm new password"
                toggle-mask
                :feedback="false"
                fluid
              />
              <small
                v-if="hiddenRuleHint"
                class="form-field__error"
              >
                {{ hiddenRuleHint }}
              </small>
            </div>
          </div>

          <Button
            size="large"
            fluid
            :label="authStore.loading ? undefined : 'Reset password'"
            type="submit"
            :disabled="!isPasswordValid || authStore.loading"
            class="reset-submit"
          >
            <BaseSpinner
              v-if="authStore.loading"
              size="sm"
              class="reset-submit__spinner"
            />
          </Button>
        </form>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.reset-card {
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-sm);
    width: min(100% - var(--p-spacing-8), 438px);
    padding: var(--p-spacing-12) var(--p-spacing-20);
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Consistent structural rhythm across all auth cards (CONNECT — Asana UI fixes). */
    gap: var(--p-spacing-8);
}

/* Form state wrapper — a single transition child, so it carries the column
   layout the card gives its direct children. */
.reset-form-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-8);
    width: 100%;
}

.reset-icon {
    /* Figma key icon is 50px — 5xl (48px) is the matching token. */
    font-size: var(--p-font-size-5xl);
    color: var(--p-skyblue-600);
    line-height: 1;
}

.reset-title {
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-font-line-height-snug);
    margin: 0;
    text-align: center;
}

.reset-body {
    width: 278px;
}

.reset-form {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-8);
}

/* Password policy checklist — muted dot until a rule is satisfied, then a green
   check. Mirrors the Figma "Create new password" requirements list. */
.reset-rules {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.reset-rules__heading {
    margin: 0;
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-semibold);
    color: var(--p-deepblue-900);
    line-height: 1;
}

.reset-rules__list {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.reset-rules__item {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    color: var(--p-gray-800);
    font-size: var(--p-font-size-xs);
    line-height: 1;
}

.reset-rules__item .pi {
    font-size: var(--p-font-size-xxxs);
}

.reset-rules__item .pi-circle-fill {
    color: var(--p-gray-100);
}

.reset-rules__item--met {
    color: var(--p-vividgreen-500);
}

.reset-rules__item--met .pi {
    color: var(--p-vividgreen-500);
}

/* Server error — red message banner (Figma message/error). */
.reset-error {
    display: flex;
    align-items: flex-start;
    gap: var(--p-spacing-1-75);
    padding: var(--p-spacing-1-75) var(--p-spacing-2-625);
    background: var(--p-red-50);
    border-radius: var(--p-border-radius-xs);
    color: var(--p-red-700);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-semibold);
    line-height: var(--p-spacing-5);
}

.reset-error .pi {
    flex-shrink: 0;
    font-size: var(--p-font-size-sm);
    /* Match the text line-height so the icon sits on the first line, not centred
       against the whole (possibly wrapped) message. */
    line-height: var(--p-spacing-5);
}

.reset-fields {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-5);
}

/* Match the login submit button: hide the label and centre a BaseSpinner
   while the reset is in flight. */
:deep(.reset-submit__spinner) {
    margin: 0 auto;
}
.reset-submit.p-button,
.reset-success__login.p-button {
    font-size: var(--p-font-size-base);
}

/* Inactive button — the Figma disabled state (button/primary/disabled): a flat
   grey fill at 70% opacity with muted grey text. Shared with the login submit
   buttons so every auth CTA reads the same when disabled. */
.reset-submit.p-button:disabled {
    background: var(--p-gray-100);
    border-color: var(--p-gray-100);
    color: var(--p-gray-500);
    opacity: 0.7;
}

/* Success card (Figma 6624-121936) — check-circle, confirmation, Log in action.
   Consistent spacing-8 rhythm between the icon, the text block, and the button. */
.reset-success {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-8);
    width: 278px;
    text-align: center;
}

.reset-success__icon {
    /* Figma check-circle is 50px — 5xl (48px) is the matching token. */
    font-size: var(--p-font-size-5xl);
    color: var(--p-vividgreen-500);
    line-height: 1;
}

.reset-success__body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-1-75);
}

.reset-success__title {
    margin: 0;
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: var(--p-font-line-height-snug);
    /* Figma keeps the heading on one line; it overflows the 278px text column and
       centres within the wider card. */
    white-space: nowrap;
}

.reset-success__text {
    margin: 0;
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
    line-height: var(--p-spacing-5);
}

.reset-success__login {
    width: 100%;
}
</style>
