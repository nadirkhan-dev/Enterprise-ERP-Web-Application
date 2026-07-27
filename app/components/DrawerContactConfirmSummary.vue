<script setup lang="ts">
import type { ContactErrors, ContactForm, PhoneRow } from '~/composables/useContactForm'

type CountryOption = {
  id: number
  name: string
  code: string
  phone_code?: string | null
}

type PhoneEditForm = {
  type: string
  country: number | null
  phoneNumber: string
  extension: string
  smsCapable: boolean
  isDefault: boolean
}

interface Props {
  form: ContactForm
  errors: ContactErrors
  submitted: boolean
  isMobile: boolean
  editingSections: { details: boolean; phones: boolean; prefs: boolean }
  toggleSection: (key: string) => void
  detailsCollapsed: boolean
  phonesCollapsed: boolean
  prefsCollapsed: boolean
  displayName: string
  addressOptions: { label: string; value: number | string }[]
  editingPhoneId: number | null
  phoneEditForm: PhoneEditForm
  countryOptions: CountryOption[]
  editingCountryCode: string | null
  editingCountryIso: string | null
  formattedPhone: (phone: PhoneRow) => string
  showPhoneErrorBanner: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'toggle-collapse': [key: 'details' | 'phones' | 'prefs']
  'apply-details': []
  'apply-phones': []
  'cancel-phones': []
  'edit-phone': [phone: PhoneRow]
  'remove-phone': [phone: PhoneRow]
  'close-phone-edit': []
  'save-phone-edit': []
  'update:phone-input': [value: { countriesId: number | null; number: string; extension?: string | null }]
  'form-edited': []
}>()

function enterEdit(key: 'details' | 'phones' | 'prefs') {
  emit('toggle-collapse', key)
  props.toggleSection(key)
}

const prefsCheckboxes = [
  { key: 'allowTransactionalEmail', label: 'Allow Transactional Email', id: 'dc-allow-trans-email' },
  { key: 'allowMarketingEmail', label: 'Allow Marketing Email', id: 'dc-allow-mkt-email' },
  { key: 'allowTransactionalSms', label: 'Allow Transactional SMS', id: 'dc-allow-trans-sms' },
  { key: 'allowMarketingSms', label: 'Allow Marketing SMS', id: 'dc-allow-mkt-sms' },
] as const
</script>

<template>
  <div class="drawer-section">
    <DrawerContactSectionHeader
      :title="displayName"
      :collapsed="detailsCollapsed"
      :editing="editingSections.details"
      show-edit-controls
      @toggle-collapse="$emit('toggle-collapse', 'details')"
      @apply="$emit('apply-details')"
      @cancel="toggleSection('details')"
      @enter-edit="enterEdit('details')"
    />
    <div v-show="!detailsCollapsed" class="form-row">
      <div class="form-field">
        <label class="form-field__label form-field__label--required">First Name</label>
        <BaseClearableInput
          v-model="form.firstName"
          v-trim
          :disabled="!editingSections.details"
          fluid
          @input="$emit('form-edited')"
        />
      </div>
      <div class="form-field">
        <label class="form-field__label">Last Name</label>
        <BaseClearableInput
          v-model="form.lastName"
          v-trim
          :disabled="!editingSections.details"
          fluid
          @input="$emit('form-edited')"
        />
      </div>
    </div>
    <div v-show="!detailsCollapsed" class="form-row">
      <div class="form-field">
        <label class="form-field__label">Job Title</label>
        <BaseClearableInput
          v-model="form.jobTitle"
          v-trim
          :disabled="!editingSections.details"
          fluid
          @input="$emit('form-edited')"
        />
      </div>
      <div class="form-field">
        <label class="form-field__label form-field__label--required">Email Address</label>
        <BaseClearableInput
          v-model="form.email"
          v-trim
          :disabled="!editingSections.details"
          fluid
          @input="$emit('form-edited')"
        />
      </div>
    </div>
    <div v-show="!detailsCollapsed" class="form-row form-row--full">
      <div class="form-field">
        <label class="form-field__label">Address</label>
        <Select
          v-model="form.address"
          :options="addressOptions"
          option-label="label"
          option-value="value"
          :disabled="!editingSections.details"
          placeholder="Select address"
          show-clear
          fluid
          :filter="addressOptions.length > 10"
          panel-class="address-select-panel"
        />
      </div>
    </div>
  </div>

  <div class="drawer-section">
    <DrawerContactSectionHeader
      title="Phone Numbers"
      :collapsed="phonesCollapsed"
      :editing="editingSections.phones"
      show-edit-controls
      @toggle-collapse="$emit('toggle-collapse', 'phones')"
      @apply="$emit('apply-phones')"
      @cancel="$emit('cancel-phones')"
      @enter-edit="enterEdit('phones')"
    />
    <template v-for="(phone, phoneIdx) in form.phoneNumbers" :key="phone.id">
      <Message
        v-if="editingSections.phones && editingPhoneId === phone.id && showPhoneErrorBanner"
        v-show="!phonesCollapsed"
        severity="error"
        icon="pi pi-exclamation-circle"
        :closable="false"
        class="phone-error-banner"
      >
        Phone number is required. Enter a valid phone number to continue.
      </Message>
      <div
        v-if="editingSections.phones && editingPhoneId === phone.id"
        v-show="!phonesCollapsed"
        class="phone-card phone-card--editing"
      >
        <DrawerContactPhoneEdit
          :phone-id="phone.id"
          :phone-edit-form="phoneEditForm"
          :country-options="countryOptions"
          :editing-country-code="editingCountryCode"
          :editing-country-iso="editingCountryIso"
          :submitted="submitted"
          :errors="{
            phoneCountry: errors.phoneCountry,
            phoneNumber: errors.phoneNumber,
            phoneExtension: errors.phoneExtension,
          }"
          :show-phone-error-banner="showPhoneErrorBanner"
          id-prefix="s3Phone"
          @close="$emit('close-phone-edit')"
          @save="$emit('save-phone-edit')"
          @update:phone-input="$emit('update:phone-input', $event)"
        />
      </div>
      <DrawerContactPhoneCard
        v-else
        v-show="!phonesCollapsed"
        :phone="phone"
        :formatted-number="formattedPhone(phone)"
        :is-mobile="isMobile"
        variant="summary"
        :actions-disabled="!editingSections.phones"
        :editing-class="editingSections.phones"
        @edit="$emit('edit-phone', $event)"
        @remove="$emit('remove-phone', $event)"
      />
    </template>
    <div
      v-show="!phonesCollapsed && form.phoneNumbers.length === 0"
      class="phone-card__empty"
    >
      <i class="pi pi-phone" />
      <span>No phone numbers added</span>
    </div>
  </div>

  <div class="drawer-section">
    <DrawerContactSectionHeader
      title="Notes &amp; Preferences"
      :collapsed="prefsCollapsed"
      :editing="editingSections.prefs"
      show-edit-controls
      @toggle-collapse="$emit('toggle-collapse', 'prefs')"
      @apply="toggleSection('prefs')"
      @cancel="toggleSection('prefs')"
      @enter-edit="enterEdit('prefs')"
    />
    <div v-show="!prefsCollapsed" class="form-field">
      <span class="form-field__label">Notifications</span>
      <div class="checkbox-grid">
        <div
          v-for="cb in prefsCheckboxes"
          :key="cb.key"
          class="checkbox-field"
        >
          <Checkbox
            v-model="form[cb.key]"
            :disabled="!editingSections.prefs"
            binary
            :inputId="cb.id"
          />
          <label
            :for="cb.id"
            class="checkbox-field__label"
          >{{ cb.label }}</label>
        </div>
      </div>
    </div>
    <div v-show="!prefsCollapsed" class="form-row form-row--full">
      <div class="form-field">
        <label class="form-field__label">Notes</label>
        <Textarea
          v-model="form.notes"
          v-trim
          :disabled="!editingSections.prefs"
          placeholder="Add your notes here"
          :rows="3"
          fluid
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

.phone-card {
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    overflow: hidden;
    margin-bottom: var(--p-spacing-3);
    background: var(--p-inputtext-disabled-background, var(--p-form-field-disabled-background));
}

.phone-card--editing {
    background: var(--p-surface-0);
}

.phone-card__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-2);
    padding: var(--p-spacing-4);
    color: var(--p-gray-400);
    font-size: var(--p-font-size-sm);
    border: 1px dashed var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
}
</style>
