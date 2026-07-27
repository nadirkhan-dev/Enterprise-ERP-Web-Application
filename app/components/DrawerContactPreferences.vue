<script setup lang="ts">
import type { ContactForm } from '~/composables/useContactForm'

interface Props {
  form: ContactForm
  disabled?: boolean
  idPrefix?: string
  showHeading?: boolean
  notesRows?: number
  notesPlaceholder?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  idPrefix: 'contactPrefs',
  showHeading: true,
  notesRows: 5,
  notesPlaceholder: 'Add notes here',
})

defineEmits<{
  'notes-input': []
}>()

// Character-limit counter (CONNECT-536) — renders only if the field has a limit.
const { limitFor } = useCharLimits('business_partners_contacts')

const checkboxes = [
  { key: 'allowTransactionalEmail', label: 'Allow Transactional Email' },
  { key: 'allowMarketingEmail', label: 'Allow Marketing Email' },
  { key: 'allowTransactionalSms', label: 'Allow Transactional SMS' },
  { key: 'allowMarketingSms', label: 'Allow Marketing SMS' },
] as const

function checkboxId(key: string) {
  return `${props.idPrefix}-${key}`
}
</script>

<template>
  <div class="drawer-section">
    <div
      v-if="showHeading"
      class="drawer-section__heading"
    >
      <span class="drawer-section__title">Notes &amp; Preferences</span>
    </div>

    <div class="form-field">
      <span class="form-field__label">Notifications</span>
      <div class="checkbox-grid">
        <div
          v-for="cb in checkboxes"
          :key="cb.key"
          class="checkbox-field"
        >
          <Checkbox
            v-model="form[cb.key]"
            :inputId="checkboxId(cb.key)"
            :disabled="disabled"
            :binary="true"
          />
          <label
            :for="checkboxId(cb.key)"
            class="checkbox-field__label"
          >{{ cb.label }}</label>
        </div>
      </div>
    </div>

    <div class="form-row form-row--full">
      <div class="form-field">
        <div class="form-field__label-row">
          <label class="form-field__label">Notes</label>
          <BaseCharCounter :value="form.notes" :max="limitFor('remarks')" />
        </div>
        <Textarea
          v-model="form.notes"
          v-trim
          :placeholder="notesPlaceholder"
          :rows="notesRows"
          :disabled="disabled"
          fluid
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.form-field {
    gap: var(--p-spacing-1);
    min-width: 0;
}

.checkbox-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-3);
    padding-top: var(--p-spacing-1);

    @media (min-width: 768px) {
        grid-template-columns: 1fr 1fr;
        gap: var(--p-spacing-3) var(--p-spacing-5);
    }
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
