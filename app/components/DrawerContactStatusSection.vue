<script setup lang="ts">
import type { ContactErrors, ContactForm } from '~/composables/useContactForm'

interface Props {
  form: ContactForm
  errors: ContactErrors
  submitted: boolean
  displayName: string
}

defineProps<Props>()

// Character-limit counter (CONNECT-536) — Directus soft limit for the junction.
const { limitFor } = useCharLimits('business_partners_contacts')
</script>

<template>
  <div class="drawer-section">
    <div class="drawer-section__heading">
      <span class="drawer-section__title">{{ displayName }}</span>
    </div>

    <div class="checkbox-field contact-primary-field">
      <Checkbox
        v-model="form.isPrimaryContact"
        inputId="isPrimaryContactEdit"
        :binary="true"
      />
      <label
        for="isPrimaryContactEdit"
        class="checkbox-field__label"
      >Set as primary contact</label>
    </div>

    <div class="form-row form-row--full">
      <div class="form-field">
        <span class="form-field__label">Status</span>
        <div class="radio-group">
          <div class="radio-option">
            <RadioButton
              v-model="form.status"
              inputId="contactStatusActive"
              value="active"
            />
            <label
              for="contactStatusActive"
              class="radio-option__label"
            >Active</label>
          </div>
          <div class="radio-option">
            <RadioButton
              v-model="form.status"
              inputId="contactStatusInactive"
              value="inactive"
            />
            <label
              for="contactStatusInactive"
              class="radio-option__label"
            >Inactive</label>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="form.status === 'inactive'"
      class="form-row form-row--full"
    >
      <div class="form-field">
        <div class="form-field__label-row">
          <label class="form-field__label form-field__label--required">Inactive Note</label>
          <BaseCharCounter :value="form.inactiveNote" :max="limitFor('inactive_note')" />
        </div>
        <Textarea
          v-model="form.inactiveNote"
          v-trim
          placeholder="Reason for marking inactive"
          :rows="3"
          fluid
          :invalid="submitted && !!errors.inactiveNote"
        />
        <span
          v-if="submitted && errors.inactiveNote"
          class="form-field__error"
        >{{ errors.inactiveNote }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.contact-primary-field {
    margin-top: var(--p-spacing-1);
    margin-bottom: var(--p-spacing-1);
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

:deep(.form-row--full .p-inputtextarea),
:deep(.form-row--full textarea.p-inputtextarea),
:deep(.form-row--full .p-textarea),
:deep(.form-row--full textarea) {
    @media (min-width: 768px) {
        width: 100% !important;
        min-width: 100%;
        display: block;
    }
}
</style>
