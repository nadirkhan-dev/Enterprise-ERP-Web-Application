<script setup lang="ts">
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
  phoneId: number
  phoneEditForm: PhoneEditForm
  countryOptions: CountryOption[]
  editingCountryCode: string | null
  editingCountryIso: string | null
  submitted: boolean
  errors: { phoneCountry: string; phoneNumber: string; phoneExtension: string }
  idPrefix?: string
  /** When the section-level banner is shown, suppress the redundant inline
   *  "Phone number is required." message under the field. */
  showPhoneErrorBanner?: boolean
  /** Hide the "Set as default phone number" checkbox (the Account Information
   *  drawer manages defaults elsewhere). */
  hideDefault?: boolean
  /** Homeowner customers: disable Extension and every phone type except
   *  General/Mobile (a homeowner's number is general or mobile, no extension). */
  isHomeowner?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  idPrefix: 'phoneType',
  showPhoneErrorBanner: false,
  hideDefault: false,
  isHomeowner: false,
})

// Homeowners can only pick General or Mobile — Direct and Fax are disabled.
function isTypeDisabled(value: string) {
  return props.isHomeowner && value !== 'general' && value !== 'mobile'
}

defineEmits<{
  close: []
  save: []
  'update:phone-input': [value: { countriesId: number | null; number: string; extension?: string | null }]
}>()

// Disable Save while the number field is empty — there's nothing to commit. An
// entered-but-invalid number stays clickable so Save can surface the error.
const hasPhoneNumber = computed(() => /\d/.test(props.phoneEditForm.phoneNumber ?? ''))

// Mobile numbers are inherently SMS-capable, so the SMS Capable checkbox is
// locked on (checked + disabled) while mobile is selected — the editor keeps
// `phoneEditForm.smsCapable` in sync with the type.
const isMobilePhone = computed(() => props.phoneEditForm.type === 'mobile')

const phoneTypeOptions = [
  { value: 'general', label: 'General' },
  { value: 'direct', label: 'Direct' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'fax', label: 'Fax' },
]

function radioId(value: string) {
  return `${props.idPrefix}-${value}-${props.phoneId}`
}

function formatPhoneCode(code: string | null | undefined): string {
  if (!code) return ''
  return code.startsWith('+') ? code : `+${code}`
}

function formatCountryLabel(country: CountryOption | null | undefined): string {
  if (!country) return ''
  const code = formatPhoneCode(country.phone_code)
  return code ? `${country.name} (${code})` : country.name
}

function findCountry(id: number | null | undefined): CountryOption | null {
  if (id === null || id === undefined) return null
  return props.countryOptions.find((country) => country.id === id) ?? null
}
</script>

<template>
  <div class="phone-edit">
    <div class="phone-edit__close">
      <BaseIconButton
        icon="pi pi-times"
        label="Close"
        @click="$emit('close')"
      />
    </div>

    <div class="form-field-phone-type">
      <span class="form-field__label">Type</span>
      <div class="radio-group">
        <div
          v-for="option in phoneTypeOptions"
          :key="option.value"
          class="radio-option"
          :class="{ 'radio-option--disabled': isTypeDisabled(option.value) }"
        >
          <RadioButton
            v-model="phoneEditForm.type"
            :inputId="radioId(option.value)"
            :value="option.value"
            :disabled="isTypeDisabled(option.value)"
          />
          <label
            :for="radioId(option.value)"
            class="radio-option__label"
          >{{ option.label }}</label>
        </div>
      </div>
    </div>

    <div class="phone-edit__row">
      <div class="form-field phone-edit__country">
        <label class="form-field__label form-field__label--required">Country</label>
        <Select
          v-model="phoneEditForm.country"
          :options="countryOptions"
          :option-label="(country) => formatCountryLabel(country)"
          option-value="id"
          placeholder="Select a country"
          filter
          fluid
          :invalid="submitted && !!errors.phoneCountry"
          panel-class="address-select-panel"
        />
        <span
          v-if="submitted && errors.phoneCountry"
          class="form-field__error"
        >{{ errors.phoneCountry }}</span>
      </div>
      <div class="form-field">
        <label class="form-field__label form-field__label--required">Phone Number</label>
        <PhoneNumberInput
          :model-value="{ countriesId: phoneEditForm.country, number: phoneEditForm.phoneNumber, extension: phoneEditForm.extension }"
          :country-iso="editingCountryIso"
          :invalid="submitted && !!errors.phoneNumber"
          hide-country
          hide-extension
          fluid
          @update:model-value="$emit('update:phone-input', $event)"
        />
        <span
          v-if="submitted && errors.phoneNumber && !showPhoneErrorBanner"
          class="form-field__error"
        >{{ errors.phoneNumber }}</span>
      </div>
      <div class="form-field phone-edit__extension">
        <label class="form-field__label">Extension</label>
        <BaseClearableInput
          v-model="phoneEditForm.extension"
          v-no-autofill
          autocomplete="off"
          :disabled="isHomeowner"
          :maxlength="MAX_EXTENSION_DIGITS"
          inputmode="numeric"
          fluid
          :invalid="submitted && !!errors.phoneExtension"
          @beforeinput="blockNonDigitBeforeInput"
        />
        <span
          v-if="submitted && errors.phoneExtension"
          class="form-field__error"
        >{{ errors.phoneExtension }}</span>
      </div>
    </div>

    <div class="phone-edit__checkboxes">
      <div
        class="checkbox-field"
        :class="{ 'checkbox-field--disabled': isMobilePhone }"
      >
        <Checkbox
          v-model="phoneEditForm.smsCapable"
          :inputId="`${idPrefix}-sms-${phoneId}`"
          :binary="true"
          :disabled="isMobilePhone"
        />
        <label
          :for="`${idPrefix}-sms-${phoneId}`"
          class="checkbox-field__label"
        >SMS Capable</label>
      </div>
      <div
        v-if="!hideDefault"
        class="checkbox-field"
      >
        <Checkbox
          v-model="phoneEditForm.isDefault"
          :inputId="`${idPrefix}-default-${phoneId}`"
          :binary="true"
        />
        <label
          :for="`${idPrefix}-default-${phoneId}`"
          class="checkbox-field__label"
        >Set as default phone number</label>
      </div>
    </div>

    <div class="phone-edit__actions">
      <Button
        label="Save"
        size="small"
        icon="pi pi-check"
        :disabled="!hasPhoneNumber"
        @click="$emit('save')"
      />
    </div>
  </div>
</template>

<style scoped>
/* Country | Phone Number | Extension. Country and Phone are equal width (1fr
   each); Extension stays narrow (room for ~5 digits). On mobile, Country spans
   the full row and Phone + Extension share the row below. */
.phone-edit__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--p-spacing-20);
    gap: var(--p-spacing-3);

    @media (min-width: 768px) {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) var(--p-spacing-20);
        gap: var(--p-spacing-4);
    }
}

.phone-edit__actions {
    display: flex;
    justify-content: flex-start;
}

.phone-edit__country {
    grid-column: 1 / -1;

    @media (min-width: 768px) {
        grid-column: auto;
    }
}

.form-field {
    gap: var(--p-spacing-1);
    min-width: 0;
}

.phone-edit {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: var(--p-spacing-4);
    background: var(--p-surface-0);
    position: relative;
}

.phone-edit__close {
    position: absolute;
    top: var(--p-spacing-4);
    right: var(--p-spacing-4);
}

/* Close cross uses deep blue instead of the primary blue. */
.phone-edit__close :deep(.base-icon-button:not(.base-icon-button--disabled)) {
    color: var(--p-deepblue-900);
}

.phone-edit__extension :deep(.p-inputtext) {
    width: 100%;
}

.phone-edit .radio-group {
    flex-wrap: wrap;
}

.phone-edit__checkboxes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--p-spacing-4);
}

.phone-edit__checkboxes .checkbox-field {
    align-items: center;
}

.phone-edit__checkboxes .checkbox-field__label {
    white-space: nowrap;
}

/* Locked SMS Capable label (mobile numbers are always SMS capable). */
.checkbox-field--disabled .checkbox-field__label {
    color: var(--p-text-muted-color);
    cursor: not-allowed;
}

/* Homeowner: phone types other than General/Mobile are disabled. */
.radio-option--disabled .radio-option__label {
    color: var(--p-text-muted-color);
    cursor: not-allowed;
}
</style>
