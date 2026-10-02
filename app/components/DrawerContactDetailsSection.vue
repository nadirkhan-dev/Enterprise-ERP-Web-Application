<script setup lang="ts">
import type { ContactErrors, ContactForm } from '~/composables/useContactForm'

interface Props {
  form: ContactForm
  errors: ContactErrors
  submitted: boolean
  isEmailInvalid: boolean
  addressOptions: { label: string; value: number | string }[]
  // Homeowner customers are individuals — Job Title doesn't apply.
  isHomeowner?: boolean
}

defineProps<Props>()

defineEmits<{
  'email-blur': []
  'email-input': []
}>()

// Character-limit counters (CONNECT-536) — Directus soft limits for `contacts`.
const { limitFor } = useCharLimits('contacts')
</script>

<template>
  <div class="drawer-section">
    <div class="form-row">
      <div class="form-field">
        <div class="form-field__label-row">
          <label class="form-field__label form-field__label--required">First Name</label>
          <BaseCharCounter :value="form.firstName" :max="limitFor('first_name')" />
        </div>
        <BaseClearableInput
          v-model="form.firstName"
          v-trim
          v-no-autofill
          autocomplete="off"
          fluid
          :invalid="submitted && !!errors.firstName"
          placeholder="Enter first name"
        />
        <span
          v-if="submitted && errors.firstName"
          class="form-field__error"
        >{{ errors.firstName }}</span>
      </div>
      <div class="form-field">
        <div class="form-field__label-row">
          <label class="form-field__label">Last Name</label>
          <BaseCharCounter :value="form.lastName" :max="limitFor('last_name')" />
        </div>
        <BaseClearableInput
          v-model="form.lastName"
          v-trim
          v-no-autofill
          autocomplete="off"
          fluid
          placeholder="Enter last name"
          :invalid="submitted && !!errors.lastName"
        />
        <span
          v-if="submitted && errors.lastName"
          class="form-field__error"
        >{{ errors.lastName }}</span>
      </div>
    </div>

    <div class="form-row">
      <div class="form-field">
        <div class="form-field__label-row">
          <label class="form-field__label">Job Title</label>
          <BaseCharCounter :value="form.jobTitle" :max="limitFor('job_title')" />
        </div>
        <BaseClearableInput
          v-model="form.jobTitle"
          v-trim
          v-no-autofill
          autocomplete="off"
          :disabled="isHomeowner"
          placeholder="Enter job title"
          fluid
          :invalid="submitted && !!errors.jobTitle"
        />
        <span
          v-if="submitted && errors.jobTitle"
          class="form-field__error"
        >{{ errors.jobTitle }}</span>
      </div>
      <div class="form-field">
        <div class="form-field__label-row">
          <label class="form-field__label form-field__label--required">Email Address</label>
          <BaseCharCounter :value="form.email" :max="limitFor('email_address')" />
        </div>
        <BaseClearableInput
          v-model="form.email"
          v-trim
          v-no-autofill
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          fluid
          placeholder="Enter email address"
          :invalid="isEmailInvalid || (submitted && !!errors.email)"
          :style="isEmailInvalid ? { color: 'var(--p-red-500)', '-webkit-text-fill-color': 'var(--p-red-500)' } : {}"
          @blur="$emit('email-blur')"
          @input="$emit('email-input')"
        />
        <span
          v-if="isEmailInvalid"
          class="form-field__error"
        >Incorrect email address</span>
        <span
          v-else-if="submitted && errors.email"
          class="form-field__error"
        >{{ errors.email }}</span>
      </div>
    </div>

    <div class="form-row form-row--full">
      <div class="form-field">
        <label class="form-field__label">Addresses</label>
        <Select
          v-model="form.address"
          :options="addressOptions"
          option-label="label"
          option-value="value"
          placeholder="Select address"
          show-clear
          fluid
          :filter="addressOptions.length > 10"
          panel-class="address-select-panel"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-row:not(.form-row--full) {
    grid-template-columns: 1fr 1fr;
}

.form-row > .form-field {
    min-width: 0;
}

.form-field {
    gap: var(--p-spacing-1);
    min-width: 0;
}

.form-row--full {
    @media (min-width: 768px) {
        grid-template-columns: 1fr;
    }
}

.form-row--full .form-field {
    @media (min-width: 768px) {
        width: 100%;
    }
}
</style>
