<script setup lang="ts">
import type { ContactErrors, ContactForm } from '~/composables/useContactForm'

interface Props {
  form: ContactForm
  errors: ContactErrors
  submitted: boolean
  displayName: string
  defaultRoleWarning?: string
  isPrimaryLocked?: boolean
  otherContactCount?: number
}

const props = withDefaults(defineProps<Props>(), {
  defaultRoleWarning: '',
  isPrimaryLocked: false,
  otherContactCount: 0,
})

const primaryLockTooltip = computed(() => {
  if (!props.isPrimaryLocked) { return '' }
  return props.otherContactCount === 0
    ? 'The only contact must stay the default. Add another contact first.'
    : 'A default contact cannot be unchecked. To remove it as the default, set another contact as the default first.'
})

// Character-limit counter (CONNECT-536) — Directus soft limit for the junction.
const { limitFor } = useCharLimits('business_partners_contacts')
// Inactive-note suggestions authored on the Directus field (CONNECT-708).
const { presetsFor } = useFieldPresets('business_partners_contacts')

// Status and its note are separate field grants on the junction, and each
// control disables on its own: a status-only user may still flip the status —
// the save then omits the note field they cannot write (see useContactSave).
// False until resolved and on failure, so an unknown answer leaves the
// controls disabled.
const { loadStatusFieldRights, getStatusFieldRights } = usePermissions()
loadStatusFieldRights()

const canEditStatus = computed(() => getStatusFieldRights('business_partners_contacts').status)
const canEditInactiveNote = computed(() => getStatusFieldRights('business_partners_contacts').inactiveNote)
</script>

<template>
  <div class="drawer-section">
    <div class="drawer-section__heading">
      <span class="drawer-section__title">{{ displayName }}</span>
    </div>

    <div
      class="checkbox-field contact-primary-field"
      :class="{ 'checkbox-field--disabled': isPrimaryLocked }"
    >
      <Checkbox
        v-model="form.isPrimaryContact"
        inputId="isPrimaryContactEdit"
        :binary="true"
        :disabled="isPrimaryLocked"
      />
      <label
        for="isPrimaryContactEdit"
        class="checkbox-field__label"
        v-tooltip.top="primaryLockTooltip"
      >Set as primary contact</label>
    </div>

    <Message
      v-if="defaultRoleWarning"
      severity="warn"
      icon="pi pi-info-circle"
      :closable="false"
      class="drawer-warning-banner"
    >
      {{ defaultRoleWarning }}
    </Message>

    <div class="form-row">
      <div class="form-field">
        <span class="form-field__label">Status</span>
        <div class="radio-group">
          <div class="radio-option">
            <RadioButton
              v-model="form.status"
              inputId="contactStatusActive"
              value="active"
              :disabled="!canEditStatus"
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
              :disabled="!canEditStatus"
            />
            <label
              for="contactStatusInactive"
              class="radio-option__label"
            >Inactive</label>
          </div>
        </div>
      </div>

      <div
        class="form-field"
        :class="{ 'form-field--reserved': form.status !== 'inactive' }"
        :aria-hidden="form.status !== 'inactive'"
      >
        <div class="form-field__label-row">
          <label class="form-field__label form-field__label--required">Inactive Notes</label>
          <BaseCharCounter :value="form.inactiveNote" :max="limitFor('inactive_note')" />
        </div>
        <InputText
          v-model="form.inactiveNote"
          v-trim
          placeholder="Enter the reason why it's inactive"
          fluid
          :tabindex="form.status === 'inactive' ? undefined : -1"
          :invalid="submitted && !!errors.inactiveNote"
          :disabled="!canEditInactiveNote"
        />
        <BaseSuggestionChips
          :suggestions="presetsFor('inactive_note')"
          :selected="[form.inactiveNote]"
          :disabled="!canEditInactiveNote"
          @select="form.inactiveNote = $event"
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

/* Locked primary label (the only contact must stay the default). */
.checkbox-field--disabled .checkbox-field__label {
    color: var(--p-text-muted-color);
    cursor: not-allowed;
}

.form-field {
    gap: var(--p-spacing-1);
    min-width: 0;
}
</style>
