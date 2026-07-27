<script setup lang="ts">
const props = withDefaults(defineProps<{
  form: Record<string, any>
  errors: Record<string, string>
  submitted: boolean
  partnerGroupOptions: Record<string, any>[]
  countryOptions: Record<string, any>[]
  phoneTypes: { label: string, value: string }[]
  isCheckingDuplicates: boolean
  referenceDataError: string | null
  selectedCountryIso: any
  logoPreviewUrl?: string | null
  // Customers can't set an image while creating (the placeholder is decided by
  // the Customer Group); suppliers still upload their logo here.
  allowLogoUpload?: boolean
  shippingErrors?: Record<string, string>
  billingErrors?: Record<string, string>
  shippingHasIntent?: boolean
  billingHasIntent?: boolean
  groupLabel?: string
  showNationalAccount?: boolean
  requireWebsite?: boolean
  requireEmail?: boolean
  // Billing-only (suppliers): hide the Shipping Address section + "use shipping
  // as billing" toggle, and always show the Billing Address form on its own.
  billingOnly?: boolean
  // Which partner this form is creating. Only drives the avatar placeholder today —
  // a supplier being created gets the supplier's own icon, not the customer's.
  variant?: 'customer' | 'supplier'
  // Hide the inline "Next Step" button — the in-panel drawer renders it in the
  // drawer footer instead (mirroring the contact-creation drawer).
  hideNav?: boolean
  // Drop the profile card + avatar/identity chrome, so the form starts flush at the
  // "Account Information" heading. The in-panel drawer is already a card, so the
  // page's card-on-card + hero avatar would be redundant there.
  hideCard?: boolean
}>(), {
  logoPreviewUrl: null,
  allowLogoUpload: false,
  shippingErrors: () => ({}),
  billingErrors: () => ({}),
  shippingHasIntent: false,
  billingHasIntent: false,
  groupLabel: 'Customer Group',
  showNationalAccount: true,
  requireWebsite: true,
  requireEmail: true,
  billingOnly: false,
  variant: 'customer',
  hideNav: false,
  hideCard: false,
})

const placeholderCategory = computed(() => (props.variant === 'supplier' ? 'supplier' : 'customer'))

// Billing shows when it's the only address (suppliers) or when the shipping
// flow has "use shipping as billing" switched off (customers).
const showBilling = computed(
  () => props.billingOnly || (props.form.shipping && !props.form.useShippingAsBilling),
)

// Mobile numbers are inherently SMS-capable, so the SMS Capable checkbox is
// locked on (checked + disabled) rather than left as a free choice. The parent
// keeps `form.smsCapable` in sync with the phone type.
const isMobilePhone = computed(() => props.form.phoneType === 'mobile')

// A homeowner customer is an individual, not a company, so company-level fields
// (website, national account, job title, extension) and a "direct" office line
// don't apply. Detect by the selected group's name.
const isHomeowner = computed(
  () => props.partnerGroupOptions.find((g) => g.id === props.form.partnerGroup)?.name?.toLowerCase() === 'homeowner',
)

const firstNameRef = ref<{ focus: () => void } | null>(null)

// Split a typed full name into first / last: the final token is the last name,
// everything before it is the first name ("Dr. Joe Dirt" → "Dr. Joe" / "Dirt").
// A single token is treated as the first name.
function splitFullName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) { return { firstName: '', lastName: '' } }
  if (parts.length === 1) { return { firstName: parts[0], lastName: '' } }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

// On becoming a homeowner: blank the fields that don't apply, drop the Direct
// phone type, seed the person's name from whatever was typed as the company
// name, and move the cursor into First Name.
watch(isHomeowner, (homeowner, wasHomeowner) => {
  if (!homeowner || wasHomeowner) { return }
  props.form.website = ''
  props.form.isNationalAccount = false
  props.form.jobTitle = ''
  props.form.extension = ''
  if (props.form.phoneType === 'direct') { props.form.phoneType = 'general' }
  if (props.form.companyName.trim() && !props.form.firstName.trim() && !props.form.lastName.trim()) {
    const { firstName, lastName } = splitFullName(props.form.companyName)
    props.form.firstName = firstName
    props.form.lastName = lastName
  }
  nextTick(() => { firstNameRef.value?.focus?.() })
})

// While a homeowner, the (disabled) Company Name mirrors First + Last so the
// identity under the avatar tracks any edits to the name.
watch([() => props.form.firstName, () => props.form.lastName, isHomeowner], () => {
  if (isHomeowner.value) {
    props.form.companyName = `${props.form.firstName} ${props.form.lastName}`.trim()
  }
})

const emit = defineEmits<{
  'logo-select': [event: Event]
  'next-step': []
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)

function triggerFileInput() {
  if (!props.allowLogoUpload) { return }
  fileInputRef.value?.click()
}

// Character-limit counters (CONNECT-536) — Directus soft limits.
const { limitFor: partnerLimit } = useCharLimits('business_partners')
const { limitFor: contactLimit } = useCharLimits('contacts')

function updateFromPhoneInput(value: { countriesId: number | null, number: string, extension?: string | null }) {
  if (value.countriesId != null && value.countriesId !== props.form.country) {
    props.form.country = value.countriesId
  }
  props.form.phoneNumber = value.number || ''
  props.form.extension = value.extension ?? ''
}

// Paste fires before the pasted text is inserted, so defer past the input/
// v-model update (a macrotask, not nextTick's microtask) to normalize the
// freshly-pasted value rather than the stale one.
function handleWebsitePaste() {
  setTimeout(() => { props.form.website = normalizeWebsite(props.form.website) }, 0)
}

// Directus-style expand transition for the Billing Address section — the same
// height-auto reveal the Login card uses for its one-time-passcode field. JS
// hooks animate height 0 → scrollHeight → auto (+ margin/opacity) so the section
// slides open when "use shipping as billing" is switched off.
function handleBillingBeforeEnter(element: Element) {
  const el = element as HTMLElement
  el.style.height = '0px'
  el.style.marginTop = '0px'
  el.style.opacity = '0'
}

function handleBillingEnter(element: Element) {
  const el = element as HTMLElement
  const targetHeight = el.scrollHeight
  requestAnimationFrame(() => {
    el.style.height = `${targetHeight}px`
    el.style.marginTop = ''
    el.style.opacity = ''
  })
}

function handleBillingAfterEnter(element: Element) {
  const el = element as HTMLElement
  el.style.height = ''
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function handleBillingLeave(element: Element) {
  const el = element as HTMLElement
  el.style.height = `${el.scrollHeight}px`
  void el.offsetHeight
  requestAnimationFrame(() => {
    el.style.height = '0px'
    el.style.marginTop = '0px'
    el.style.opacity = '0'
  })
}
</script>

<template>
  <Message
    v-if="referenceDataError"
    severity="error"
    :closable="false"
  >
    {{ referenceDataError }}
  </Message>

  <!-- Hidden file input for logo — suppliers only (allowLogoUpload). -->
  <input
    v-if="allowLogoUpload"
    ref="fileInputRef"
    type="file"
    accept="image/*"
    class="visually-hidden"
    @change="emit('logo-select', $event)"
  >

  <div :class="hideCard ? 'create-form-stack' : 'create-profile-wrapper'">
    <div
      v-if="!hideCard"
      class="create-profile-avatar"
      :class="{ 'create-profile-avatar--clickable': allowLogoUpload }"
      @click="triggerFileInput"
    >
      <img
        v-if="logoPreviewUrl"
        :src="logoPreviewUrl"
        alt="Company logo preview"
        class="create-profile-avatar__image"
        width="150"
        height="150"
      >
      <!-- Placeholder: a house for a homeowner (an individual); everything else
           gets its own partner icon — the customer's for a customer, the supplier's
           for a supplier. Customers can't replace it during creation. -->
      <i
        v-else-if="isHomeowner"
        class="pi pi-home create-profile-avatar__icon"
      />
      <BasePlaceholderIcon
        v-else
        :category="placeholderCategory"
        class="placeholder-avatar__icon"
      />
    </div>

    <div :class="hideCard ? 'create-form-stack' : 'create-profile-card'">
      <Tag
        v-if="!hideCard"
        value="Step 1 of 3"
        class="step-card__badge step-card__badge--profile"
      />

      <div
        v-if="!hideCard"
        class="create-profile-identity"
      >
        <span class="create-profile-identity__name">
          {{ form.companyName || '[Enter company name]' }}
        </span>
        <Tag
          :value="partnerGroupOptions.find(g => g.id === form.partnerGroup)?.name || '[Select group]'"
          rounded
          severity="secondary"
        />
      </div>

      <div class="create-form-section">
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Account Information</span>
        </div>

        <div class="create-form-fields create-form-fields--account">
          <div class="create-form-row-2">
            <div class="form-field">
              <div class="form-field__label-row">
                <label
                  for="companyName"
                  class="form-field__label"
                >
                  Company Name <span class="form-field__required">*</span>
                </label>
                <BaseCharCounter :value="form.companyName" :max="partnerLimit('name')" />
              </div>
              <BaseClearableInput
                id="companyName"
                v-model="form.companyName"
                v-trim
                v-no-autofill
                autocomplete="off"
                :disabled="isHomeowner"
                :invalid="submitted && errors.companyName !== ''"
                placeholder="Enter company name"
                fluid
              />
              <small
                v-if="submitted && errors.companyName"
                class="form-field__error"
              >{{ errors.companyName }}</small>
            </div>
            <div class="form-field">
              <label
                for="partnerGroup"
                class="form-field__label"
              >
                {{ groupLabel }} <span class="form-field__required">*</span>
              </label>
              <Select
                id="partnerGroup"
                v-model="form.partnerGroup"
                :invalid="submitted && errors.partnerGroup !== ''"
                :options="partnerGroupOptions"
                option-label="name"
                option-value="id"
                placeholder="Select group or industry"
                :filter="partnerGroupOptions.length > 10"
                fluid
                panel-class="address-select-panel"
              />
              <small
                v-if="submitted && errors.partnerGroup"
                class="form-field__error"
              >{{ errors.partnerGroup }}</small>
            </div>
          </div>

          <div class="create-form-row create-form-row--full">
            <div class="form-field">
              <div class="form-field__label-row">
                <label
                  for="website"
                  class="form-field__label"
                >
                  Website <span
                    v-if="requireWebsite"
                    class="form-field__required"
                  >*</span>
                </label>
                <BaseCharCounter :value="form.website" :max="partnerLimit('website')" />
              </div>
              <IconField>
                <InputText
                  id="website"
                  v-model="form.website"
                  v-no-autofill
                  :disabled="isHomeowner"
                  :invalid="submitted && errors.website !== ''"
                  placeholder="Enter website URL"
                  autocomplete="off"
                  autocapitalize="none"
                  autocorrect="off"
                  spellcheck="false"
                  fluid
                  @blur="form.website = normalizeWebsite(form.website)"
                  @paste="handleWebsitePaste"
                />
                <InputIcon class="pi pi-globe" />
              </IconField>
              <small
                v-if="submitted && errors.website"
                class="form-field__error"
              >{{ errors.website }}</small>
            </div>
            <div
              v-if="showNationalAccount"
              class="create-checkbox-align"
            >
              <div
                class="checkbox-field"
                :class="{ 'checkbox-field--disabled': isHomeowner }"
              >
                <Checkbox
                  inputId="nationalAccount"
                  v-model="form.isNationalAccount"
                  binary
                  :disabled="isHomeowner"
                />
                <label
                  for="nationalAccount"
                  class="checkbox-field__label"
                >
                  This is a national customer account
                </label>
              </div>
            </div>
            <!-- No checkbox (e.g. supplier): keep an empty half so the website
                 field stays half-width instead of stretching full. -->
            <div
              v-else
              aria-hidden="true"
            />
          </div>
        </div>
      </div>

      <div class="create-form-section">
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Initial Contact</span>
        </div>

        <div class="create-form-fields">
          <div class="create-form-row-2">
            <div class="form-field">
              <div class="form-field__label-row">
                <label
                  for="firstName"
                  class="form-field__label"
                >
                  First Name <span class="form-field__required">*</span>
                </label>
                <BaseCharCounter :value="form.firstName" :max="contactLimit('first_name')" />
              </div>
              <BaseClearableInput
                ref="firstNameRef"
                id="firstName"
                v-model="form.firstName"
                v-trim
                v-no-autofill
                autocomplete="off"
                :invalid="submitted && errors.firstName !== ''"
                placeholder="Enter first name"
                fluid
              />
              <small
                v-if="submitted && errors.firstName"
                class="form-field__error"
              >{{ errors.firstName }}</small>
            </div>
            <div class="form-field">
              <div class="form-field__label-row">
                <label
                  for="lastName"
                  class="form-field__label"
                >
                  Last Name <span class="form-field__required">*</span>
                </label>
                <BaseCharCounter :value="form.lastName" :max="contactLimit('last_name')" />
              </div>
              <BaseClearableInput
                id="lastName"
                v-model="form.lastName"
                v-trim
                v-no-autofill
                autocomplete="off"
                :invalid="submitted && errors.lastName !== ''"
                placeholder="Enter last name"
                fluid
              />
              <small
                v-if="submitted && errors.lastName"
                class="form-field__error"
              >{{ errors.lastName }}</small>
            </div>
          </div>

          <div class="create-form-row create-form-row--desktop">
            <div class="form-field">
              <div class="form-field__label-row">
                <label
                  for="jobTitle"
                  class="form-field__label"
                >Job Title</label>
                <BaseCharCounter :value="form.jobTitle" :max="contactLimit('job_title')" />
              </div>
              <BaseClearableInput
                id="jobTitle"
                v-model="form.jobTitle"
                v-trim
                v-no-autofill
                autocomplete="off"
                :disabled="isHomeowner"
                placeholder="Enter job title"
                fluid
              />
            </div>
            <div class="form-field">
              <div class="form-field__label-row">
                <label
                  for="emailAddress"
                  class="form-field__label"
                >
                  Email Address <span
                    v-if="requireEmail"
                    class="form-field__required"
                  >*</span>
                </label>
                <BaseCharCounter :value="form.emailAddress" :max="contactLimit('email_address')" />
              </div>
              <BaseClearableInput
                id="emailAddress"
                v-model="form.emailAddress"
                v-trim
                v-no-autofill
                autocomplete="off"
                :invalid="submitted && errors.emailAddress !== ''"
                placeholder="example@mail.com"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                fluid
              />
              <small
                v-if="submitted && errors.emailAddress"
                class="form-field__error"
              >{{ errors.emailAddress }}</small>
            </div>
          </div>

          <div class="create-form-row create-form-row--desktop">
            <div class="form-field">
              <label
                for="country"
                class="form-field__label"
              >
                Country <span class="form-field__required">*</span>
              </label>
              <Select
                id="country"
                v-model="form.country"
                :invalid="submitted && errors.country !== ''"
                :options="countryOptions"
                :option-label="formatCountryLabel"
                option-value="id"
                placeholder="United States +1"
                filter
                fluid
                panel-class="address-select-panel"
              />
              <small
                v-if="submitted && errors.country"
                class="form-field__error"
              >{{ errors.country }}</small>
            </div>
            <div class="create-phone-row">
              <div class="form-field">
                <label
                  for="phoneNumber"
                  class="form-field__label"
                >
                  Phone Number <span class="form-field__required">*</span>
                </label>
                <PhoneNumberInput
                  input-id="phoneNumber"
                  :model-value="{ countriesId: form.country, number: form.phoneNumber, extension: form.extension }"
                  :country-iso="selectedCountryIso"
                  :invalid="submitted && errors.phoneNumber !== ''"
                  hide-country
                  hide-extension
                  @update:model-value="updateFromPhoneInput"
                />
                <small
                  v-if="submitted && errors.phoneNumber"
                  class="form-field__error"
                >{{ errors.phoneNumber }}</small>
              </div>
              <div class="form-field">
                <label
                  for="extension"
                  class="form-field__label"
                >Extension</label>
                <BaseClearableInput
                  id="extension"
                  v-model="form.extension"
                  v-no-autofill
                  :disabled="isHomeowner"
                  :invalid="submitted && errors.extension !== ''"
                  :maxlength="MAX_EXTENSION_DIGITS"
                  inputmode="numeric"
                  placeholder="00000"
                  autocomplete="off"
                  fluid
                  @beforeinput="blockNonDigitBeforeInput"
                />
                <small
                  v-if="submitted && errors.extension"
                  class="form-field__error"
                >{{ errors.extension }}</small>
              </div>
            </div>
          </div>

          <div class="create-form-row create-form-row--full create-form-row--mobile">
            <div class="form-field">
              <div class="form-field__label-row">
                <label
                  for="emailAddressMobile"
                  class="form-field__label"
                >
                  Email Address <span
                    v-if="requireEmail"
                    class="form-field__required"
                  >*</span>
                </label>
                <BaseCharCounter :value="form.emailAddress" :max="contactLimit('email_address')" />
              </div>
              <BaseClearableInput
                id="emailAddressMobile"
                v-model="form.emailAddress"
                v-trim
                v-no-autofill
                autocomplete="off"
                :invalid="submitted && errors.emailAddress !== ''"
                placeholder="example@mail.com"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                fluid
              />
              <small
                v-if="submitted && errors.emailAddress"
                class="form-field__error"
              >{{ errors.emailAddress }}</small>
            </div>
          </div>

          <div class="create-form-row-2 create-form-row--mobile">
            <div class="form-field">
              <div class="form-field__label-row">
                <label
                  for="jobTitleMobile"
                  class="form-field__label"
                >Job Title</label>
                <BaseCharCounter :value="form.jobTitle" :max="contactLimit('job_title')" />
              </div>
              <BaseClearableInput
                id="jobTitleMobile"
                v-model="form.jobTitle"
                v-trim
                v-no-autofill
                autocomplete="off"
                :disabled="isHomeowner"
                placeholder="Enter job title"
                fluid
              />
            </div>
            <div class="form-field">
              <label
                for="countryMobile"
                class="form-field__label"
              >
                Country <span class="form-field__required">*</span>
              </label>
              <Select
                id="countryMobile"
                v-model="form.country"
                :invalid="submitted && errors.country !== ''"
                :options="countryOptions"
                :option-label="formatCountryLabel"
                option-value="id"
                placeholder="United States +1"
                filter
                fluid
                panel-class="address-select-panel"
              />
              <small
                v-if="submitted && errors.country"
                class="form-field__error"
              >{{ errors.country }}</small>
            </div>
          </div>

          <div class="create-form-row create-form-row--full create-form-row--mobile">
            <div class="create-phone-row">
              <div class="form-field">
                <label
                  for="phoneNumberMobile"
                  class="form-field__label"
                >
                  Phone Number <span class="form-field__required">*</span>
                </label>
                <PhoneNumberInput
                  input-id="phoneNumberMobile"
                  :model-value="{ countriesId: form.country, number: form.phoneNumber, extension: form.extension }"
                  :country-iso="selectedCountryIso"
                  :invalid="submitted && errors.phoneNumber !== ''"
                  hide-country
                  hide-extension
                  @update:model-value="updateFromPhoneInput"
                />
                <small
                  v-if="submitted && errors.phoneNumber"
                  class="form-field__error"
                >{{ errors.phoneNumber }}</small>
              </div>
              <div class="form-field">
                <label
                  for="extensionMobile"
                  class="form-field__label"
                >Extension</label>
                <BaseClearableInput
                  id="extensionMobile"
                  v-model="form.extension"
                  v-no-autofill
                  :disabled="isHomeowner"
                  :invalid="submitted && errors.extension !== ''"
                  :maxlength="MAX_EXTENSION_DIGITS"
                  inputmode="numeric"
                  placeholder="00000"
                  autocomplete="off"
                  fluid
                  @beforeinput="blockNonDigitBeforeInput"
                />
                <small
                  v-if="submitted && errors.extension"
                  class="form-field__error"
                >{{ errors.extension }}</small>
              </div>
            </div>
          </div>

          <div class="create-form-row create-form-row--phone-controls">
            <div class="form-field">
              <label class="form-field__label">Phone Type</label>
              <div class="create-radio-group">
                <div
                  v-for="type in phoneTypes"
                  :key="type.value"
                  class="checkbox-field"
                  :class="{ 'checkbox-field--disabled': isHomeowner && type.value === 'direct' }"
                >
                  <RadioButton
                    v-model="form.phoneType"
                    :inputId="type.value"
                    :value="type.value"
                    :disabled="isHomeowner && type.value === 'direct'"
                  />
                  <label
                    :for="type.value"
                    class="checkbox-field__label"
                  >{{ type.label }}</label>
                </div>
              </div>
            </div>
            <div class="create-checkbox-align">
              <div
                class="checkbox-field"
                :class="{ 'checkbox-field--disabled': isMobilePhone }"
              >
                <Checkbox
                  inputId="smsCapable"
                  v-model="form.smsCapable"
                  binary
                  :disabled="isMobilePhone"
                />
                <label
                  for="smsCapable"
                  class="checkbox-field__label"
                >
                  SMS Capable
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="form.shipping && !billingOnly"
        class="create-form-section"
      >
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Shipping Address</span>
        </div>

        <AddressFormFields
          :address="form.shipping"
          :errors="shippingErrors"
          :submitted="submitted"
          :country-options="countryOptions"
          :required-active="shippingHasIntent"
          id-prefix="shipping"
        />

        <div class="shipping-billing-toggle">
          <label
            for="useShippingAsBilling"
            class="checkbox-field__label"
          >
            Use shipping address as billing address
          </label>
          <InputSwitch
            v-model="form.useShippingAsBilling"
            inputId="useShippingAsBilling"
            :disabled="!shippingHasIntent"
          />
        </div>
      </div>

      <Transition
        name="billing-expand"
        @before-enter="handleBillingBeforeEnter"
        @enter="handleBillingEnter"
        @after-enter="handleBillingAfterEnter"
        @leave="handleBillingLeave"
      >
        <div
          v-if="showBilling"
          class="create-form-section"
        >
          <div class="drawer-section__heading">
            <span class="drawer-section__title">Billing Address</span>
          </div>

          <AddressFormFields
            :address="form.billing"
            :errors="billingErrors"
            :submitted="submitted"
            :country-options="countryOptions"
            :required-active="billingHasIntent"
            id-prefix="billing"
          />
        </div>
      </Transition>

      <div
        v-if="!hideNav"
        class="create-form-section step-actions-wrapper"
      >
        <div class="step-actions step-actions--center">
          <Button
            :disabled="isCheckingDuplicates || !!referenceDataError"
            @click="emit('next-step')"
          >
            Next Step
            <span class="step-next-icon">
              <BaseSpinner
                v-if="isCheckingDuplicates"
                size="sm"
              />
              <i
                v-else
                class="pi pi-arrow-right"
              />
            </span>
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Card-less layout (hideCard, used in the in-panel drawer): just a spaced column of
   form sections — no card surface, no avatar, no hero identity. Gap matches the card
   so the section rhythm is unchanged. */
.create-form-stack {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    width: 100%;

    @media (min-width: 768px) {
        gap: var(--p-spacing-6);
    }
}

.create-profile-avatar--clickable {
    cursor: pointer;
}

/* 60px house in the supplier/building placeholder colour, so a homeowner's
   house reads like a company's building in the hero avatar. */
.create-profile-avatar__icon {
    /* Scale with the avatar (40% of its size), matching the other placeholder icons —
       60px at 150px (desktop), 48px at 120px (mobile) — instead of a fixed 60px that
       looked oversized on mobile. Intermediate var avoids a calc()-inside-var()-
       fallback parse failure (see placeholder-image.css). */
    --home-icon-fallback-size: calc(var(--p-spacing-px) * 150);
    font-size: calc(var(--profile-avatar-size, var(--home-icon-fallback-size)) * 0.4);
    color: var(--p-surface-100);
}

.create-profile-avatar__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
}

.create-profile-card {
    position: relative;
}

.create-form-fields--account {
    gap: var(--p-spacing-4);
}

@media (max-width: 767px) {
    .create-form-section + .create-form-section {
        margin-top: var(--p-spacing-4);
    }
}

.create-form-row--phone-controls {
    gap: var(--p-spacing-3);
}

/* Locked SMS Capable label (mobile numbers are always SMS capable). */
.checkbox-field--disabled .checkbox-field__label {
    color: var(--p-text-muted-color);
    cursor: not-allowed;
}

/* Billing Address reveal — Directus-style expand, mirroring the Login card's
   one-time-passcode transition (JS hooks animate height 0 → scrollHeight → auto). */
.billing-expand-enter-active,
.billing-expand-leave-active {
    overflow: hidden;
    transition:
        height 400ms cubic-bezier(0.4, 0, 0.2, 1),
        margin-top 400ms cubic-bezier(0.4, 0, 0.2, 1),
        opacity 300ms cubic-bezier(0.4, 0, 0.2, 1);
    will-change: height, margin-top, opacity;
}

@media (prefers-reduced-motion: reduce) {
    .billing-expand-enter-active,
    .billing-expand-leave-active {
        transition: none;
    }
}

/* "Use shipping address as billing address" — centered toggle row beneath the
   shipping fields (design places it centered under the grid). */
.shipping-billing-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-3);
    min-height: calc(var(--p-spacing-8) + var(--p-spacing-px));
}

.step-card__badge {
    position: absolute;
    top: var(--p-spacing-4);
    right: var(--p-spacing-4);
    z-index: 1;
}

.step-card__badge--profile {
    position: absolute;
    top: var(--p-spacing-4);
    right: var(--p-spacing-4);

    @media (min-width: 768px) {
        top: var(--p-spacing-6);
        right: var(--p-spacing-6);
    }
}

.step-card__badge.p-tag {
    background: var(--p-surface-50);
    color: var(--p-deepblue-800);
    font-size: var(--p-font-size-xs);
    padding: var(--p-spacing-1) var(--p-spacing-3);
    border-radius: var(--p-border-radius-full);

    @media (min-width: 768px) {
        font-size: var(--p-font-size-sm);
        padding: var(--p-spacing-2) var(--p-spacing-4);
    }
}

.step-actions {
    display: flex;
    gap: var(--p-spacing-3);
}

.step-actions--center {
    justify-content: center;
}

.step-actions--center :deep(.p-button) {
    padding: var(--p-spacing-2) var(--p-spacing-3);
}

.step-next-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: var(--p-spacing-0-5);
    height: var(--p-spacing-5);
}

.step-actions-wrapper {
    border-top: 1px solid var(--p-surface-200);
    padding-top: var(--p-spacing-4);
}

:deep(.p-inputicon) {
    color: var(--p-gray-300);
}
</style>
