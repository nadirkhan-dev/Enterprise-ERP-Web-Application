<script setup lang="ts">
import type { ContactForm, PhoneRow } from '~/composables/useContactForm'

interface Props {
  form: ContactForm
  displayName: string
  detailsCollapsed: boolean
  phonesCollapsed: boolean
  prefsCollapsed: boolean
  isMobile: boolean
  formattedPhone: (phone: PhoneRow) => string
}

defineProps<Props>()

defineEmits<{
  'toggle-details': []
  'toggle-phones': []
  'toggle-prefs': []
}>()

const prefsCheckboxes = [
  { key: 'allowTransactionalEmail', label: 'Allow Transactional Email', id: 'dc-dup-allow-trans-email' },
  { key: 'allowMarketingEmail', label: 'Allow Marketing Email', id: 'dc-dup-allow-mkt-email' },
  { key: 'allowTransactionalSms', label: 'Allow Transactional SMS', id: 'dc-dup-allow-trans-sms' },
  { key: 'allowMarketingSms', label: 'Allow Marketing SMS', id: 'dc-dup-allow-mkt-sms' },
] as const
</script>

<template>
  <div class="drawer-section">
    <DrawerContactSectionHeader
      :title="displayName"
      :collapsed="detailsCollapsed"
      @toggle-collapse="$emit('toggle-details')"
    />
    <div v-show="!detailsCollapsed" class="form-row">
      <div class="form-field">
        <label class="form-field__label">First Name</label>
        <InputText :model-value="form.firstName" disabled fluid />
      </div>
      <div class="form-field">
        <label class="form-field__label">Last Name</label>
        <InputText :model-value="form.lastName" disabled fluid />
      </div>
    </div>
    <div v-show="!detailsCollapsed" class="form-row">
      <div class="form-field">
        <label class="form-field__label">Job Title</label>
        <InputText :model-value="form.jobTitle" disabled fluid />
      </div>
      <div class="form-field">
        <label class="form-field__label">Email Address</label>
        <InputText :model-value="form.email" disabled fluid />
      </div>
    </div>
  </div>

  <div class="drawer-section">
    <DrawerContactSectionHeader
      title="Phone Numbers"
      :collapsed="phonesCollapsed"
      @toggle-collapse="$emit('toggle-phones')"
    />
    <template v-if="!phonesCollapsed">
      <DrawerContactPhoneCard
        v-for="phone in form.phoneNumbers"
        :key="phone.id"
        :phone="phone"
        :formatted-number="formattedPhone(phone)"
        :is-mobile="isMobile"
        variant="summary"
        actions-disabled
      />
    </template>
  </div>

  <div class="drawer-section">
    <DrawerContactSectionHeader
      title="Notes &amp; Preferences"
      :collapsed="prefsCollapsed"
      @toggle-collapse="$emit('toggle-prefs')"
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
            :model-value="form[cb.key]"
            disabled
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
          :model-value="form.notes"
          disabled
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

</style>
