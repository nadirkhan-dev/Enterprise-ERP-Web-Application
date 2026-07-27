<script setup lang="ts">
interface Props {
  form: Record<string, any>
  errors?: Record<string, string>
  submitted?: boolean
  partnerGroupOptions?: Record<string, any>[]
  countryOptions?: Record<string, any>[]
  phoneTypes?: { label: string, value: string }[]
  logoPreviewUrl?: string | null
  canCreate: boolean
  isSaving: boolean
  variant?: 'customer' | 'contact' | 'supplier'
  hideCard?: boolean
  hideNav?: boolean
  groupLabel?: string
  showNationalAccount?: boolean
  createLabel?: string
  shippingErrors?: Record<string, string>
  billingErrors?: Record<string, string>
  shippingHasIntent?: boolean
  billingHasIntent?: boolean
  // Billing-only (suppliers): no shipping section; billing stands alone.
  billingOnly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  errors: () => ({}),
  submitted: false,
  partnerGroupOptions: () => [],
  countryOptions: () => [],
  phoneTypes: () => [],
  logoPreviewUrl: null,
  variant: 'customer',
  hideCard: false,
  hideNav: false,
  groupLabel: 'Customer Group',
  showNationalAccount: true,
  createLabel: 'Create Customer',
  shippingErrors: () => ({}),
  billingErrors: () => ({}),
  shippingHasIntent: false,
  billingHasIntent: false,
  billingOnly: false,
})

// The company/contact summary + identity card apply to both partner kinds
// (customer + supplier); only the contact variant renders the compact form.
const isCustomer = computed(() => props.variant !== 'contact')

// isCustomer covers suppliers too (it only excludes contacts), so the avatar
// placeholder keys off the variant directly — a supplier gets the supplier's icon.
const placeholderCategory = computed(() => (props.variant === 'supplier' ? 'supplier' : 'customer'))

// A homeowner is an individual, not a company — its profile image is a house
// placeholder, here and forever on the customer detail page.
const isHomeowner = computed(
  () => props.partnerGroupOptions.find((group) => group.id === props.form.partnerGroup)?.name?.toLowerCase() === 'homeowner',
)

// Mobile numbers are inherently SMS-capable, so the SMS Capable checkbox is
// locked on (checked + disabled) while mobile is selected — the parent keeps
// `form.smsCapable` in sync with the phone type.
const isMobilePhone = computed(() => props.form.phoneType === 'mobile')

const emit = defineEmits<{
  create: []
  cancel: []
  'back-to-form': []
  'update:verifiedAccurate': [value: boolean]
  'update:form': [field: string, value: any]
}>()

const verifiedAccurate = ref(false)
const editingAccount = ref(false)
const editingContact = ref(false)
const editingShipping = ref(false)
const editingBilling = ref(false)
const accountCollapsed = ref(true)
const contactCollapsed = ref(true)
const shippingCollapsed = ref(true)
const billingCollapsed = ref(true)
const shippingBackup = ref<Record<string, any> | null>(null)
const billingBackup = ref<Record<string, any> | null>(null)

// Dynamic section editing (for contact variant)
const editingSections = reactive<Record<string, boolean>>({})
const accountBackup = ref<Record<string, any> | null>(null)
const contactBackup = ref<Record<string, any> | null>(null)

const isEditing = computed(
  () => editingAccount.value || editingContact.value || editingShipping.value || editingBilling.value,
)

watch(verifiedAccurate, (checked) => {
  emit('update:verifiedAccurate', checked)
})

// Reset verification when user edits
watch(isEditing, (editing) => {
  if (editing) {
    verifiedAccurate.value = false
  }
})

function updateField(field: string, value: any) {
  emit('update:form', field, value)
}

// Paste fires before the pasted text is inserted; defer past the input/
// update:model-value round-trip (a macrotask) so we normalize the real value.
function handleWebsitePaste() {
  setTimeout(() => updateField('website', normalizeWebsite(props.form.website)), 0)
}

function startEditAccount() {
  accountCollapsed.value = false
  accountBackup.value = {
    companyName: props.form.companyName,
    partnerGroup: props.form.partnerGroup,
    website: props.form.website,
    isNationalAccount: props.form.isNationalAccount,
  }
  editingAccount.value = true
}

function applyAccount() {
  accountBackup.value = null
  editingAccount.value = false
}

function cancelAccount() {
  if (accountBackup.value) {
    for (const [field, value] of Object.entries(accountBackup.value)) {
      emit('update:form', field, value)
    }
    accountBackup.value = null
  }
  editingAccount.value = false
}

function startEditContact() {
  contactCollapsed.value = false
  contactBackup.value = {
    firstName: props.form.firstName,
    lastName: props.form.lastName,
    jobTitle: props.form.jobTitle,
    emailAddress: props.form.emailAddress,
    country: props.form.country,
    phoneNumber: props.form.phoneNumber,
    extension: props.form.extension,
    phoneType: props.form.phoneType,
    smsCapable: props.form.smsCapable,
  }
  editingContact.value = true
}

function applyContact() {
  contactBackup.value = null
  editingContact.value = false
}

function cancelContact() {
  if (contactBackup.value) {
    for (const [field, value] of Object.entries(contactBackup.value)) {
      emit('update:form', field, value)
    }
    contactBackup.value = null
  }
  editingContact.value = false
}

// Address slices are mutated in place (same pattern as Step 1), so the backup is
// a plain snapshot restored via Object.assign on cancel.
function snapshotAddress(address: Record<string, any>) {
  return {
    country: address.country,
    street: address.street,
    unitSuite: address.unitSuite,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    latitude: address.latitude,
    longitude: address.longitude,
  }
}

function startEditShipping() {
  shippingCollapsed.value = false
  shippingBackup.value = snapshotAddress(props.form.shipping)
  editingShipping.value = true
}

function applyShipping() {
  shippingBackup.value = null
  editingShipping.value = false
}

function cancelShipping() {
  if (shippingBackup.value) {
    Object.assign(props.form.shipping, shippingBackup.value)
    shippingBackup.value = null
  }
  editingShipping.value = false
}

function startEditBilling() {
  billingCollapsed.value = false
  // Editing billing on Step 3 means the user wants a distinct billing address —
  // decouple it from shipping so the sync stops overwriting their edits and the
  // required-field markers switch on.
  if (props.form.useShippingAsBilling) {
    updateField('useShippingAsBilling', false)
  }
  billingBackup.value = snapshotAddress(props.form.billing)
  editingBilling.value = true
}

function applyBilling() {
  billingBackup.value = null
  editingBilling.value = false
}

function cancelBilling() {
  if (billingBackup.value) {
    Object.assign(props.form.billing, billingBackup.value)
    billingBackup.value = null
  }
  editingBilling.value = false
}

const partnerGroupName = computed(() => {
  return props.partnerGroupOptions.find((g) => g.id === props.form.partnerGroup)?.name || ''
})

const confirmCountryIso = useCountryIsoLookup(computed(() => props.form?.country))

</script>

<template>
  <div :class="isCustomer && !hideCard ? 'create-profile-wrapper' : ''">
    <div
      v-if="isCustomer && !hideCard"
      class="create-profile-avatar confirm-avatar"
    >
      <img
        v-if="logoPreviewUrl"
        :src="logoPreviewUrl"
        alt="Company logo preview"
        class="create-profile-avatar__image"
        width="150"
        height="150"
      >
      <i
        v-else-if="isHomeowner"
        class="pi pi-home confirm-avatar__icon"
      />
      <BasePlaceholderIcon
        v-else
        :category="placeholderCategory"
        class="placeholder-avatar__icon"
      />
    </div>

    <div :class="isCustomer ? (hideCard ? 'confirm-form-stack' : 'create-profile-card') : ''">
      <Tag
        v-if="!hideCard"
        value="Step 3 of 3"
        class="step-card__badge step-card__badge--profile"
      />

      <div
        v-if="!hideCard"
        class="confirm-mobile-header"
      >
        <span class="step-card__title">Your Entry</span>
        <span class="step-card__subtitle">Data you entered — preserved throughout this review</span>
      </div>

      <!-- Customer: Identity preview (desktop only) -->
      <div
        v-if="isCustomer && !hideCard"
        class="create-profile-identity confirm-identity"
      >
        <span class="create-profile-identity__name">
          {{ form.companyName }}
        </span>
        <Tag
          :value="partnerGroupName"
          rounded
          severity="secondary"
        />
      </div>

      <!-- Custom summary slot (for contacts etc.) -->
      <slot
        name="summary"
        :editing-sections="editingSections"
        :toggle-section="(key: string) => { editingSections[key] = !editingSections[key]; verifiedAccurate = false }"
      />

      <div
        v-if="isCustomer"
        class="create-form-section"
      >
        <div class="confirm-section-header">
          <Button
            :icon="accountCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
            text
            size="small"
            severity="secondary"
            class="confirm-collapse-btn"
            @click="accountCollapsed = !accountCollapsed"
          />
          <div class="drawer-section__heading">
            <span class="drawer-section__title">Account Information</span>
          </div>
          <div
            v-if="editingAccount"
            class="confirm-section-header__actions"
          >
            <Button
              icon="pi pi-check"
              label="Apply"
              size="small"
              class="confirm-edit-btn"
              @click="applyAccount"
            />
            <Button
              icon="pi pi-times"
              label="Cancel"
              size="small"
              severity="secondary"
              outlined
              class="confirm-edit-btn"
              @click="cancelAccount"
            />
          </div>
          <Button
            v-else
            icon="pi pi-pencil"
            label="Edit"
            size="small"
            severity="info"
            class="confirm-edit-btn"
            @click="startEditAccount"
          />
        </div>

        <div
          v-show="!accountCollapsed"
          class="create-form-fields create-form-fields--account"
        >
          <div class="create-form-row">
            <div class="form-field">
              <label class="form-field__label">
                Company Name <span class="form-field__required">*</span>
              </label>
              <BaseClearableInput
                :model-value="form.companyName"
                :disabled="!editingAccount"
                :invalid="submitted && errors.companyName !== ''"
                autocomplete="off"
                fluid
                @update:model-value="updateField('companyName', $event)"
              />
              <small
                v-if="submitted && errors.companyName"
                class="form-field__error"
              >{{ errors.companyName }}</small>
            </div>
            <div class="form-field">
              <label class="form-field__label">
                {{ groupLabel }} <span class="form-field__required">*</span>
              </label>
              <Select
                :model-value="form.partnerGroup"
                :options="partnerGroupOptions"
                option-label="name"
                option-value="id"
                :disabled="!editingAccount"
                :invalid="submitted && errors.partnerGroup !== ''"
                :filter="partnerGroupOptions.length > 10"
                fluid
                @update:model-value="updateField('partnerGroup', $event)"
              />
              <small
                v-if="submitted && errors.partnerGroup"
                class="form-field__error"
              >{{ errors.partnerGroup }}</small>
            </div>
          </div>

          <div class="create-form-row create-form-row--full">
            <div class="form-field">
              <label class="form-field__label">Website</label>
              <IconField>
                <InputText
                  :model-value="form.website"
                  :disabled="!editingAccount"
                  :invalid="submitted && errors.website !== ''"
                  autocomplete="off"
                  fluid
                  @update:model-value="updateField('website', $event)"
                  @blur="updateField('website', normalizeWebsite(form.website))"
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
              <div class="checkbox-field">
                <Checkbox
                  :model-value="form.isNationalAccount"
                  :disabled="!editingAccount"
                  binary
                  @update:model-value="updateField('isNationalAccount', $event)"
                  inputId="national_account"
                />
                <label class="checkbox-field__label" for="national_account">
                  This is a national customer account
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Initial Contact (customer only) -->
      <div
        v-if="isCustomer"
        class="create-form-section"
      >
        <div class="confirm-section-header">
          <Button
            :icon="contactCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
            text
            size="small"
            severity="secondary"
            class="confirm-collapse-btn"
            @click="contactCollapsed = !contactCollapsed"
          />
          <div class="drawer-section__heading">
            <span class="drawer-section__title">Initial Contact</span>
          </div>
          <div
            v-if="editingContact"
            class="confirm-section-header__actions"
          >
            <Button
              icon="pi pi-check"
              label="Apply"
              size="small"
              class="confirm-edit-btn"
              @click="applyContact"
            />
            <Button
              icon="pi pi-times"
              label="Cancel"
              size="small"
              severity="secondary"
              outlined
              class="confirm-edit-btn"
              @click="cancelContact"
            />
          </div>
          <Button
            v-else
            icon="pi pi-pencil"
            label="Edit"
            size="small"
            severity="info"
            class="confirm-edit-btn"
            @click="startEditContact"
          />
        </div>

        <div
          v-show="!contactCollapsed"
          class="create-form-fields"
        >
          <div class="create-form-row">
            <div class="form-field">
              <label class="form-field__label">
                First Name <span class="form-field__required">*</span>
              </label>
              <BaseClearableInput
                :model-value="form.firstName"
                :disabled="!editingContact"
                :invalid="submitted && errors.firstName !== ''"
                autocomplete="off"
                fluid
                @update:model-value="updateField('firstName', $event)"
              />
              <small
                v-if="submitted && errors.firstName"
                class="form-field__error"
              >{{ errors.firstName }}</small>
            </div>
            <div class="form-field">
              <label class="form-field__label">
                Last Name <span class="form-field__required">*</span>
              </label>
              <BaseClearableInput
                :model-value="form.lastName"
                :disabled="!editingContact"
                :invalid="submitted && errors.lastName !== ''"
                autocomplete="off"
                fluid
                @update:model-value="updateField('lastName', $event)"
              />
              <small
                v-if="submitted && errors.lastName"
                class="form-field__error"
              >{{ errors.lastName }}</small>
            </div>
          </div>

          <div class="create-form-row create-form-row--desktop">
            <div class="form-field">
              <label class="form-field__label">Job Title</label>
              <BaseClearableInput
                :model-value="form.jobTitle"
                :disabled="!editingContact"
                autocomplete="off"
                fluid
                @update:model-value="updateField('jobTitle', $event)"
              />
            </div>
            <div class="form-field">
              <label class="form-field__label">Email Address</label>
              <BaseClearableInput
                :model-value="form.emailAddress"
                :disabled="!editingContact"
                :invalid="submitted && errors.emailAddress !== ''"
                autocomplete="off"
                fluid
                @update:model-value="updateField('emailAddress', $event)"
              />
              <small
                v-if="submitted && errors.emailAddress"
                class="form-field__error"
              >{{ errors.emailAddress }}</small>
            </div>
          </div>

          <div class="create-form-row create-form-row--desktop">
            <div class="form-field">
              <label class="form-field__label">
                Country <span class="form-field__required">*</span>
              </label>
              <Select
                :model-value="form.country"
                :options="countryOptions"
                :option-label="formatCountryLabel"
                option-value="id"
                :disabled="!editingContact"
                :invalid="submitted && errors.country !== ''"
                :filter="countryOptions.length > 10"
                fluid
                @update:model-value="updateField('country', $event)"
              />
              <small
                v-if="submitted && errors.country"
                class="form-field__error"
              >{{ errors.country }}</small>
            </div>
            <div class="create-phone-row">
              <div class="form-field">
                <label class="form-field__label">
                  Phone Number <span class="form-field__required">*</span>
                </label>
                <PhoneNumberInput
                  :model-value="{ countriesId: form.country, number: form.phoneNumber, extension: form.extension }"
                  :country-iso="confirmCountryIso"
                  :disabled="!editingContact"
                  :invalid="submitted && errors.phoneNumber !== ''"
                  hide-country
                  hide-extension
                  @update:model-value="(v) => { updateField('phoneNumber', v.number); if (v.extension !== undefined) updateField('extension', v.extension ?? '') }"
                />
                <small
                  v-if="submitted && errors.phoneNumber"
                  class="form-field__error"
                >{{ errors.phoneNumber }}</small>
              </div>
              <div class="form-field">
                <label class="form-field__label">Extension</label>
                <BaseClearableInput
                  :model-value="form.extension"
                  :disabled="!editingContact"
                  :invalid="submitted && errors.extension !== ''"
                  :maxlength="MAX_EXTENSION_DIGITS"
                  inputmode="numeric"
                  autocomplete="off"
                  fluid
                  @beforeinput="blockNonDigitBeforeInput"
                  @update:model-value="updateField('extension', sanitizeExtension($event as string))"
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
              <label class="form-field__label">Email Address</label>
              <BaseClearableInput
                :model-value="form.emailAddress"
                :disabled="!editingContact"
                :invalid="submitted && errors.emailAddress !== ''"
                autocomplete="off"
                fluid
                @update:model-value="updateField('emailAddress', $event)"
              />
              <small
                v-if="submitted && errors.emailAddress"
                class="form-field__error"
              >{{ errors.emailAddress }}</small>
            </div>
          </div>

          <div class="create-form-row create-form-row--mobile">
            <div class="form-field">
              <label class="form-field__label">Job Title</label>
              <BaseClearableInput
                :model-value="form.jobTitle"
                :disabled="!editingContact"
                autocomplete="off"
                fluid
                @update:model-value="updateField('jobTitle', $event)"
              />
            </div>
            <div class="form-field">
              <label class="form-field__label">
                Country <span class="form-field__required">*</span>
              </label>
              <Select
                :model-value="form.country"
                :options="countryOptions"
                :option-label="formatCountryLabel"
                option-value="id"
                :disabled="!editingContact"
                :invalid="submitted && errors.country !== ''"
                :filter="countryOptions.length > 10"
                fluid
                @update:model-value="updateField('country', $event)"
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
                <label class="form-field__label">
                  Phone Number <span class="form-field__required">*</span>
                </label>
                <PhoneNumberInput
                  :model-value="{ countriesId: form.country, number: form.phoneNumber, extension: form.extension }"
                  :country-iso="confirmCountryIso"
                  :disabled="!editingContact"
                  :invalid="submitted && errors.phoneNumber !== ''"
                  hide-country
                  hide-extension
                  @update:model-value="(v) => { updateField('phoneNumber', v.number); if (v.extension !== undefined) updateField('extension', v.extension ?? '') }"
                />
                <small
                  v-if="submitted && errors.phoneNumber"
                  class="form-field__error"
                >{{ errors.phoneNumber }}</small>
              </div>
              <div class="form-field">
                <label class="form-field__label">Extension</label>
                <BaseClearableInput
                  :model-value="form.extension"
                  :disabled="!editingContact"
                  :invalid="submitted && errors.extension !== ''"
                  :maxlength="MAX_EXTENSION_DIGITS"
                  inputmode="numeric"
                  autocomplete="off"
                  fluid
                  @beforeinput="blockNonDigitBeforeInput"
                  @update:model-value="updateField('extension', sanitizeExtension($event as string))"
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
                >
                  <RadioButton
                    :model-value="form.phoneType"
                    :inputId="`confirm-${type.value}`"
                    :value="type.value"
                    :disabled="!editingContact"
                    @update:model-value="updateField('phoneType', $event)"
                  />
                  <label
                    :for="`confirm-${type.value}`"
                    class="checkbox-field__label"
                  >{{ type.label }}</label>
                </div>
              </div>
            </div>
            <div class="create-checkbox-align">
              <div
                class="checkbox-field"
                :class="{ 'checkbox-field--disabled': editingContact && isMobilePhone }"
              >
                <Checkbox
                  :model-value="form.smsCapable"
                  :disabled="!editingContact || isMobilePhone"
                  binary
                  inputId="cc-contact-sms-capable"
                  @update:model-value="updateField('smsCapable', $event)"
                />
                <label
                  for="cc-contact-sms-capable"
                  class="checkbox-field__label"
                >
                  SMS Capable
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Shipping Address (customer only, shown once an address was entered) -->
      <div
        v-if="isCustomer && !billingOnly && form.shipping && shippingHasIntent"
        class="create-form-section"
      >
        <div class="confirm-section-header">
          <Button
            :icon="shippingCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
            text
            size="small"
            severity="secondary"
            class="confirm-collapse-btn"
            @click="shippingCollapsed = !shippingCollapsed"
          />
          <div class="drawer-section__heading">
            <span class="drawer-section__title">Shipping Address</span>
          </div>
          <div
            v-if="editingShipping"
            class="confirm-section-header__actions"
          >
            <Button
              icon="pi pi-check"
              label="Apply"
              size="small"
              class="confirm-edit-btn"
              @click="applyShipping"
            />
            <Button
              icon="pi pi-times"
              label="Cancel"
              size="small"
              severity="secondary"
              outlined
              class="confirm-edit-btn"
              @click="cancelShipping"
            />
          </div>
          <Button
            v-else
            icon="pi pi-pencil"
            label="Edit"
            size="small"
            severity="info"
            class="confirm-edit-btn"
            @click="startEditShipping"
          />
        </div>

        <AddressFormFields
          v-show="!shippingCollapsed"
          :address="form.shipping"
          :errors="shippingErrors"
          :submitted="submitted"
          :country-options="countryOptions"
          :required-active="shippingHasIntent"
          :disabled="!editingShipping"
          id-prefix="confirm-shipping"
        />
      </div>

      <!-- Billing Address — billing-only (suppliers) shows it on its own intent;
           the customer flow shows it alongside shipping. -->
      <div
        v-if="isCustomer && form.billing && (billingOnly ? billingHasIntent : shippingHasIntent)"
        class="create-form-section"
      >
        <div class="confirm-section-header">
          <Button
            :icon="billingCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
            text
            size="small"
            severity="secondary"
            class="confirm-collapse-btn"
            @click="billingCollapsed = !billingCollapsed"
          />
          <div class="drawer-section__heading">
            <span class="drawer-section__title">Billing Address</span>
          </div>
          <div
            v-if="editingBilling"
            class="confirm-section-header__actions"
          >
            <Button
              icon="pi pi-check"
              label="Apply"
              size="small"
              class="confirm-edit-btn"
              @click="applyBilling"
            />
            <Button
              icon="pi pi-times"
              label="Cancel"
              size="small"
              severity="secondary"
              outlined
              class="confirm-edit-btn"
              @click="cancelBilling"
            />
          </div>
          <Button
            v-else
            icon="pi pi-pencil"
            label="Edit"
            size="small"
            severity="info"
            class="confirm-edit-btn"
            @click="startEditBilling"
          />
        </div>

        <AddressFormFields
          v-show="!billingCollapsed"
          :address="form.billing"
          :errors="billingErrors"
          :submitted="submitted"
          :country-options="countryOptions"
          :required-active="billingHasIntent"
          :disabled="!editingBilling"
          id-prefix="confirm-billing"
        />
      </div>

      <div
        v-if="!hideNav"
        class="create-form-section"
      >
        <div
          class="confirm-verify"
          :class="{ 'confirm-verify--checked': verifiedAccurate }"
          @click="verifiedAccurate = !verifiedAccurate"
        >
          <Checkbox
            v-model="verifiedAccurate"
            binary
            @click.stop
            inputId="verified"
          />
          <span class="confirm-verify__label" for="verified">
            I've verified the information above is accurate
          </span>
        </div>
        <div class="step-actions step-actions--end">
            <Button
              :disabled="!canCreate || isSaving"
              class="create-btn"
              @click="$emit('create')"
            >
              <BaseSpinner
                v-if="isSaving"
                size="sm"
                class="create-btn__spinner"
              />
              <i
                v-else
                class="pi pi-check"
              />
              {{ createLabel }}
            </Button>
            <Button
              label="Cancel"
              icon="pi pi-times"
              severity="secondary"
              outlined
              class="step-back-btn"
              @click="$emit('cancel')"
            />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Card-less layout (hideCard, in-panel drawer): the profile card normally supplies
   the gap between sections. Without it the sections stack flush, so restore the same
   rhythm — this is what puts space before "Initial Contact" and "Billing Address". */
.confirm-form-stack {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);

    @media (min-width: 768px) {
        gap: var(--p-spacing-6);
    }
}

.confirm-avatar {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

/* 60px house in the supplier/building placeholder colour, so a homeowner's
   house reads like a company's building in the hero avatar. */
.confirm-avatar__icon {
    /* Scale with the avatar (40% of its size), matching the other placeholder icons —
       60px at 150px (desktop), 48px at 120px (mobile) — instead of a fixed 60px that
       looked oversized on mobile. Intermediate var avoids a calc()-inside-var()-
       fallback parse failure (see placeholder-image.css). */
    --home-icon-fallback-size: calc(var(--p-spacing-px) * 150);
    font-size: calc(var(--profile-avatar-size, var(--home-icon-fallback-size)) * 0.4);
    color: var(--p-surface-100);
}

.create-profile-wrapper {
    padding-top: 0;

    @media (min-width: 768px) {
        padding-top: 80px;
    }
}

.create-profile-card {
    padding-top: var(--p-spacing-4);

    @media (min-width: 768px) {
        padding-top: 100px;
    }
}

.confirm-identity {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.confirm-mobile-header {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
    width: 100%;
    padding-right: var(--p-spacing-20);

    @media (min-width: 768px) {
        display: none;
    }
}

.step-card__title {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--app-color-heading);
}

.step-card__subtitle {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
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

.step-card__badge--profile {
    position: absolute;
    top: var(--p-spacing-4);
    right: var(--p-spacing-4);

    @media (min-width: 768px) {
        top: var(--p-spacing-6);
        right: var(--p-spacing-6);
    }
}

:deep(.step-card__badge.p-tag) {
    background: var(--p-surface-50);
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-xs);
    padding: var(--p-spacing-1) var(--p-spacing-3);
    border-radius: var(--p-border-radius-full);

    @media (min-width: 768px) {
        font-size: var(--p-font-size-sm);
        padding: var(--p-spacing-2) var(--p-spacing-4);
    }
}

.confirm-section-header {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    flex-wrap: wrap;
}

.confirm-section-header .drawer-section__heading {
    flex: 1;
    min-width: 0;
}

.confirm-section-header .drawer-section__title {
    color: var(--p-deepblue-900);
}

.confirm-section-header__actions {
    display: flex;
    gap: var(--p-spacing-2);
    flex-shrink: 0;
}

.confirm-section-header__actions :deep(.confirm-edit-btn.p-button) {
    display: flex;
    /* Match the Contact Information drawer's Edit button (p-button-sm padding). */
    padding: var(--button-sm-padding-y, 5.25px) var(--button-sm-padding-x, 8.75px);
    align-items: center;
    gap: var(--button-gap, 7px);
    width: auto;
    height: auto;
    min-width: auto;
}

:deep(.confirm-collapse-btn.p-button) {
    color: var(--p-deepblue-900);
    border-color: var(--p-surface-200);
    padding: 0;
    width: 28px;
    height: 28px;
    min-width: 24px;
    justify-content: center;
    flex-shrink: 0;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.confirm-edit-btn.p-button) {
    display: flex;
    border-color: transparent;
    width: var(--button-icon-only-width, 35px);
    padding: var(--button-padding-y, 7px) 0;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;

    @media (min-width: 768px) {
        width: auto;
        height: auto;
        min-width: auto;
        /* Match the Contact Information drawer's Edit button (p-button-sm padding). */
        padding: var(--button-sm-padding-y, 5.25px) var(--button-sm-padding-x, 8.75px);
        gap: var(--button-gap, 7px);
    }
}

:deep(.confirm-edit-btn.p-button:not(.p-button-outlined)) {
    background: var(--p-primary-500);
    color: var(--p-surface-0);
}

:deep(.confirm-edit-btn.p-button-outlined) {
    border-color: transparent;
    background: var(--p-surface-50);
    color: var(--p-deepblue-900);
}

:deep(.confirm-edit-btn.p-button .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

.create-form-fields--account {
    gap: var(--p-spacing-4);

    @media (min-width: 768px) {
        display: flex !important;
    }
}

.create-form-fields {
    @media (min-width: 768px) {
        display: flex !important;
    }
}

.create-form-row--phone-controls {
    gap: var(--p-spacing-5);
}

/* Locked SMS Capable label (mobile numbers are always SMS capable). */
.checkbox-field--disabled .checkbox-field__label {
    color: var(--p-text-muted-color);
    cursor: not-allowed;
}

:deep(.p-inputicon) {
    color: var(--p-gray-300);
}

.step-actions {
    display: flex;
    gap: var(--p-spacing-3);
    justify-content: center;
    align-items: stretch;
}

.step-actions--end {
    border-top: 1px solid var(--p-surface-200);
    padding-top: var(--p-spacing-6);
}

.step-actions--end > * {
    white-space: nowrap;

    @media (min-width: 768px) {
        flex: none;
    }
}

.step-actions--spread {
    justify-content: space-between;
    align-items: center;
}

.step-actions__right {
    display: flex;
    gap: var(--p-spacing-3);
}

:deep(.create-btn.p-button) {
    display: flex;
    padding: var(--p-button-lg-padding-y, 8.75px) var(--p-button-lg-padding-x, 12.25px);
    align-items: center;
    gap: var(--p-button-gap, 7px);
    white-space: nowrap;
    justify-content: center;

    @media (min-width: 768px) {
        min-width: 170px;
    }
}

/* Label is hidden while loading, so center the spinner. Colors/animation are left to
   BaseSpinner's defaults for consistency with every other loading button. */
.create-btn__spinner {
    margin: 0 auto;
}

:deep(.step-back-btn.p-button-outlined) {
    background: var(--p-surface-50);
    border-color: transparent;
    color: var(--p-deepblue-900);
    padding: var(--p-button-lg-padding-y, 8.75px) var(--p-button-lg-padding-x, 12.25px);
    justify-content: center;

    @media (min-width: 768px) {
        min-width: 120px;
    }
}

.confirm-verify {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    background: var(--p-surface-0);
    border: 1px solid var(--p-surface-200);
    padding: var(--p-spacing-2) var(--p-spacing-3);
    border-radius: var(--p-border-radius-sm);
    margin-bottom: var(--p-spacing-4);
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out),
                border-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out);
}

.confirm-verify--checked {
    background: var(--p-skyblue-50);
    border-color: var(--p-primary-500);
}

.confirm-verify__label {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
    cursor: pointer;
    user-select: none;
}

</style>
