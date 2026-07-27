<script setup lang="ts">
useHead({ title: 'Create Customer' })

const FORM_STORAGE_KEY = 'create-customer-state'
const toast = useToast()

const { fetchBusinessPartnerGroups } = useBusinessPartnerGroups()
const { executeCreate } = useCreateBusinessPartner()
const referenceData = useReferenceDataStore()
const { fetchRules, getRules } = useFieldValidation()

const form = reactive({
  companyName: '',
  partnerGroup: null,
  website: '',
  isNationalAccount: false,
  firstName: '',
  lastName: '',
  jobTitle: '',
  emailAddress: '',
  country: null,
  phoneNumber: '',
  extension: '',
  phoneType: 'general',
  smsCapable: false,
  // The initial contact is always the partner's only contact, so it's the
  // default sales + billing contact (locked in the UI), mirroring addresses.
  isPrimaryContact: true,
  logoFileId: null,
  // When true (default) the shipping address doubles as the billing address, so
  // only the shipping fields are collected and the created address carries both
  // flags. Turn it off to enter a distinct billing address.
  useShippingAsBilling: true,
  shipping: {
    country: null,
    street: '',
    unitSuite: '',
    city: '',
    state: null,
    postalCode: '',
    latitude: null,
    longitude: null,
  },
  billing: {
    country: null,
    street: '',
    unitSuite: '',
    city: '',
    state: null,
    postalCode: '',
    latitude: null,
    longitude: null,
  },
})

const submitted = ref(false)
const isSaving = ref(false)
const saveCompleted = ref(false)
const partnerGroupOptions = ref<Record<string, any>[]>([])

// A homeowner's Company Name is auto-derived from First + Last and shown in a
// disabled field, so its standalone "required" error is suppressed below — the
// First/Last required errors guide the user instead. The name is still required
// and sent; it's just never typed directly.
const isHomeowner = computed(
  () => partnerGroupOptions.value.find((g) => g.id === form.partnerGroup)?.name?.toLowerCase() === 'homeowner',
)
const referenceDataError = ref<string | null>(null)

// No logo upload during customer creation — the profile image is the group's
// placeholder (house for a homeowner, building otherwise), so form.logoFileId
// stays null and a company logo is added later on the customer detail page.

const currentStep = ref(1)

const { duplicateList, rowSelections, searchDuplicates } = useCustomerDuplicateSearch(form)
const isCheckingDuplicates = ref(false)
// Address slices and the `useShippingAsBilling` toggle are excluded from the
// fingerprint: address edits don't affect duplicate matching, and their objects
// get mutated in place (lat/long, key order) which would register as phantom
// edits even when the visible values are unchanged.
const STEP3_UNTRACKED_FIELDS = ['useShippingAsBilling', 'shipping', 'billing']
const step3Snapshot = ref<string | null>(null)
function step3InputFingerprint() {
  const inputs = { ...form } as Record<string, unknown>
  for (const field of STEP3_UNTRACKED_FIELDS) { delete inputs[field] }
  return JSON.stringify(inputs)
}
function captureStep3Snapshot() {
  step3Snapshot.value = step3InputFingerprint()
}
function hasStep3InputEdits() {
  return step3Snapshot.value !== null && step3InputFingerprint() !== step3Snapshot.value
}

// Step 3 field edits from the Confirm component — just apply the value; whether
// it counts as an edit is decided by the snapshot comparison above.
function handleStep3FieldUpdate(field: string, value: any) {
  if (form[field] !== value) { form[field] = value }
}
const isAdvancingToReview = ref(false)
const verifiedAccurate = ref(false)

const steps = [
  { number: 1, label: 'Enter Details' },
  { number: 2, label: 'Duplicate Check' },
  { number: 3, label: 'Confirm & Create' },
]

const errors = reactive({
  companyName: '',
  partnerGroup: '',
  firstName: '',
  lastName: '',
  emailAddress: '',
  country: '',
  phoneNumber: '',
  website: '',
  extension: '',
})

const shippingErrors = reactive({
  country: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
})

const billingErrors = reactive({
  country: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
})

// Fax is intentionally omitted — customer creation does not accept fax numbers.
const phoneTypes = [
  { label: 'General', value: 'general' },
  { label: 'Direct', value: 'direct' },
  { label: 'Mobile', value: 'mobile' },
]

// True only while restoring persisted state, so the toggle watcher below never
// clears a restored distinct billing address when `useShippingAsBilling` is
// re-applied as false during restore.
let isRestoringState = false

// Keep the billing slice mirrored to shipping while the toggle is on, so the
// created billing address (and Step 3's billing preview) always reflects the
// latest shipping entry.
function copyShippingToBilling() {
  form.billing.country = form.shipping.country
  form.billing.street = form.shipping.street
  form.billing.unitSuite = form.shipping.unitSuite
  form.billing.city = form.shipping.city
  form.billing.state = form.shipping.state
  form.billing.postalCode = form.shipping.postalCode
  form.billing.latitude = form.shipping.latitude
  form.billing.longitude = form.shipping.longitude
}

// Opting into a distinct billing address starts from a clean slate rather than
// forcing the user to delete the mirrored shipping values by hand. Only the
// country is seeded — matching the shipping country as the sensible default.
function resetBillingForSeparateEntry() {
  form.billing.country = form.shipping.country
  form.billing.street = ''
  form.billing.unitSuite = ''
  form.billing.city = ''
  form.billing.state = null
  form.billing.postalCode = ''
  form.billing.latitude = null
  form.billing.longitude = null
}

// Toggling "use shipping as billing" mirrors shipping when on and clears billing
// for fresh entry when off. Kept separate from the shipping-edit watch so a
// genuine toggle change is distinguishable from an in-place shipping edit.
watch(() => form.useShippingAsBilling, (useAsBilling) => {
  if (isRestoringState) return
  if (useAsBilling) {
    copyShippingToBilling()
  } else {
    resetBillingForSeparateEntry()
  }
})

// While the toggle is on, keep billing synced to every shipping edit.
watch(
  () => form.shipping,
  () => {
    if (form.useShippingAsBilling) copyShippingToBilling()
  },
  { deep: true },
)

// When advancing to step 2 with duplicates found, scroll directly to the duplicate table
watch(currentStep, async (step) => {
  if (typeof window === 'undefined') return
  if (step !== 2 || duplicateList.value.length === 0) return
  await nextTick()
  const target = document.querySelector('.duplicate-warning, .duplicate-table-wrapper') as HTMLElement | null
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

// Step 2: Final Review only enabled when all rows are dismissed
const canProceedToFinalReview = computed(() => {
  if (duplicateList.value.length === 0) return true
  return duplicateList.value.every((row) => rowSelections.value[row.id] === 'not-duplicate')
})

// Step 3: enabled only when verified AND can proceed
const canCreate = computed(() => {
  if (!verifiedAccurate.value) return false
  return canProceedToFinalReview.value
})

// Address entry is optional. "Intent" = the user has begun providing an address
// (any field beyond the always-defaulted country). Intent is what promotes the
// database-required fields to hard requirements and surfaces their asterisks.
function addressHasIntent(address: Record<string, any>) {
  return Boolean(
    address.street.trim()
    || address.unitSuite.trim()
    || address.city.trim()
    || address.postalCode.trim()
    || address.state,
  )
}
const shippingHasIntent = computed(() => addressHasIntent(form.shipping))
// Opting out of "same as shipping" IS the intent to enter a separate billing
// address, so its required fields activate the moment the toggle goes off —
// before any typing. (Shipping intent still waits for the first keystroke.)
const billingHasIntent = computed(() => !form.useShippingAsBilling)

// Withdrawing an address's intent — emptying every field, or switching billing
// back to "same as shipping" — drops its now-moot "required" errors. Otherwise a
// stale "City is required" would linger after the user cleared the address they
// had started, even though nothing is entered to be wrong anymore.
watch(shippingHasIntent, (hasIntent) => {
  if (!hasIntent) { clearAddressErrors(shippingErrors) }
})
watch(billingHasIntent, (hasIntent) => {
  if (!hasIntent) { clearAddressErrors(billingErrors) }
})

const { save: saveFormState, restore: restoreFormState, clear: clearFormState }
  = useFormSessionPersistence(
    FORM_STORAGE_KEY,
    () => ({
      form: { ...form },
      currentStep: currentStep.value,
      duplicateList: duplicateList.value,
      rowSelections: rowSelections.value,
      submitted: submitted.value,
    }),
    (state: any) => {
      // Suspend the shipping/billing toggle watcher for the duration of the
      // restore so re-applying `useShippingAsBilling: false` doesn't clear a
      // restored distinct billing address before it's reassigned below.
      isRestoringState = true
      // Assign the address slices into the EXISTING reactive objects rather than
      // replacing them, so the AddressFormFields children keep the same slice
      // identity they were bound to (a fresh object would re-trigger their
      // country watcher and wipe the restored state).
      const { shipping: restoredShipping, billing: restoredBilling, ...scalars } = state.form || {}
      Object.assign(form, scalars)
      if (restoredShipping) { Object.assign(form.shipping, restoredShipping) }
      if (restoredBilling) { Object.assign(form.billing, restoredBilling) }
      currentStep.value = state.currentStep
      duplicateList.value = state.duplicateList || []
      rowSelections.value = state.rowSelections || {}
      submitted.value = state.submitted || false
      // Re-enable after the watcher flush that this restore triggers.
      nextTick(() => { isRestoringState = false })
    },
  )

const countryOptions = computed(() => referenceData.countryOptions)
const selectedCountryIso = useCountryIsoLookup(computed(() => form.country))
const phoneValidator = usePhoneInput(selectedCountryIso)

onMounted(async () => {
  const restored = restoreFormState()

  // Fetch backend field rules so Step 1's website check uses the same regex Directus validates with on Step 3 create
  fetchRules('business_partners')

  const groupsResult = await fetchBusinessPartnerGroups({ relationshipType: 'customer' })

  if (groupsResult.error) {
    referenceDataError.value = 'Failed to load form options. Please refresh to try again.'
    return
  }

  partnerGroupOptions.value = groupsResult.data || []

  if (!restored) {
    const usCountry = countryOptions.value.find((c) => c.name === 'United States')
    if (usCountry) {
      if (!form.country) { form.country = usCountry.id }
      // Addresses default to the US country (design shows it pre-selected). This
      // isn't treated as address "intent" — only the user-entered fields are.
      if (!form.shipping.country) { form.shipping.country = usCountry.id }
      if (!form.billing.country) { form.billing.country = usCountry.id }
    }
  }
})

function validateForm() {
  errors.companyName = ''
  errors.partnerGroup = ''
  errors.firstName = ''
  errors.lastName = ''
  errors.emailAddress = ''
  errors.country = ''
  errors.phoneNumber = ''
  errors.website = ''
  errors.extension = ''

  // Homeowner's Company Name is derived from First + Last (see isHomeowner), so
  // don't raise its own "required" error on the disabled field — First/Last carry
  // their own required errors, and filling them populates the name.
  if (!form.companyName.trim() && !isHomeowner.value) {errors.companyName = 'Company name is required.'}
  if (!form.partnerGroup) {errors.partnerGroup = 'Customer group is required.'}
  if (!form.firstName.trim()) {errors.firstName = 'First name is required.'}
  if (!form.lastName.trim()) {errors.lastName = 'Last name is required.'}
  if (!form.country) {errors.country = 'Country is required.'}
  if (!form.phoneNumber.trim()) {errors.phoneNumber = 'Phone number is required.'}

  if (!form.emailAddress.trim()) {
    errors.emailAddress = 'Email address is required.'
  } else if (!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(form.emailAddress.trim())) {
    errors.emailAddress = 'Please enter a valid email address.'
  }

  // Website is optional — only validate its format when a value is entered.
  if (form.website.trim()) {
    const websiteValue = form.website.trim()
    if (!(/^https?:\/\//).test(websiteValue)) {
      errors.website = 'Website must start with http:// or https://'
    } else {
      // Apply the same regex Directus enforces on the backend so Step 1 catches what Step 3's create would reject
      const websiteRule = getRules('business_partners').website
      const backendError = validateField(websiteValue, websiteRule || null, form)
      if (backendError) {
        errors.website = websiteRule?.message || 'Please enter a valid website URL.'
      }
    }
  }

  if (form.phoneNumber.trim()) {
    const iso = selectedCountryIso.value
    const valid = iso ? phoneValidator.isValid(form.phoneNumber, iso) : form.phoneNumber.replace(/\D/g, '').length >= 4
    if (!valid) {
      errors.phoneNumber = 'Enter a valid phone number for the selected country.'
    }
  }

  if (form.extension.trim() && !(new RegExp(`^[0-9]{1,${MAX_EXTENSION_DIGITS}}$`)).test(form.extension.trim())) {
    errors.extension = `Extension must be 1-${MAX_EXTENSION_DIGITS} digits.`
  }

  const contactValid = !Object.values(errors).some((message) => message !== '')

  // Addresses are optional: only validate a slice once the user shows intent to
  // provide it. Otherwise clear any stale errors so an abandoned partial entry
  // (later emptied) never blocks submission.
  clearAddressErrors(shippingErrors)
  clearAddressErrors(billingErrors)
  let addressValid = true
  if (shippingHasIntent.value) {
    addressValid = validateAddress(form.shipping, shippingErrors) && addressValid
  }
  if (billingHasIntent.value) {
    addressValid = validateAddress(form.billing, billingErrors) && addressValid
  }

  return contactValid && addressValid
}

function clearAddressErrors(addressErrors: Record<string, string>) {
  addressErrors.country = ''
  addressErrors.street = ''
  addressErrors.city = ''
  addressErrors.state = ''
  addressErrors.postalCode = ''
}

function validateAddress(address: Record<string, any>, addressErrors: Record<string, string>) {
  clearAddressErrors(addressErrors)

  if (!address.country) { addressErrors.country = 'Country is required.' }
  if (!address.street.trim()) { addressErrors.street = 'Street is required.' }
  if (!address.city.trim()) { addressErrors.city = 'City is required.' }
  // State is required only when the country actually has regions to pick from
  // (matches the hidden State field for region-less countries).
  if (referenceData.getRegionsByCountry(address.country).length > 0 && !address.state) {
    addressErrors.state = 'State is required.'
  }
  if (!address.postalCode.trim()) { addressErrors.postalCode = 'Postal code is required.' }

  return !Object.values(addressErrors).some((message) => message !== '')
}

function mapAddressToPayload(address: Record<string, any>) {
  const payload: Record<string, any> = {
    street_line_1: address.street.trim(),
    city: address.city.trim(),
    postal_code: address.postalCode.trim().toUpperCase(),
    countries_id: address.country,
    regions_id: address.state || null,
    latitude: address.latitude,
    longitude: address.longitude,
  }
  const unit = address.unitSuite.trim()
  if (unit) { payload.street_line_2 = unit }
  return payload
}

// Build the nested `addresses.create` junctions from the entered address(es).
// No shipping intent → no address at all (address is optional). "Use shipping as
// billing" collapses to a single junction carrying both flags.
function buildAddressCreatePayloads() {
  if (!shippingHasIntent.value) { return [] }

  const shippingJunction = {
    is_shipping_address: true,
    is_billing_address: form.useShippingAsBilling,
    addresses_id: mapAddressToPayload(form.shipping),
  }
  if (form.useShippingAsBilling || !billingHasIntent.value) {
    return [shippingJunction]
  }
  return [
    shippingJunction,
    {
      is_shipping_address: false,
      is_billing_address: true,
      addresses_id: mapAddressToPayload(form.billing),
    },
  ]
}

// Step 1 → Step 2 or 3: validate, search duplicates, advance
async function handleNextStep() {
  submitted.value = true
  if (!validateForm()) {
    toast.add({
      severity: 'error',
      summary: 'Validation Error',
      detail: errors.website || 'Please fix the highlighted fields before continuing.',
      life: 5000,
    })
    return
  }

  isCheckingDuplicates.value = true
  const hasDuplicates = await searchDuplicates()
  isCheckingDuplicates.value = false
  verifiedAccurate.value = false
  captureStep3Snapshot()

  currentStep.value = hasDuplicates ? 2 : 3
}

// Step 2 → Step 3
async function handleFinalReview() {
  if (!canProceedToFinalReview.value) return
  isAdvancingToReview.value = true
  await nextTick()
  verifiedAccurate.value = false
  captureStep3Snapshot()
  currentStep.value = 3
  isAdvancingToReview.value = false
}

// Step 2 → Step 1
function handleBackToForm() {
  currentStep.value = 1
}

// Step 3 → Step 2
function handleBackToReview() {
  verifiedAccurate.value = false
  currentStep.value = 2
}

async function handleCreateCustomer() {
  if (!canCreate.value) return

  submitted.value = true
  if (!validateForm()) {
    toast.add({
      severity: 'error',
      summary: 'Validation Error',
      detail: 'Please fix the errors before creating the customer.',
      life: 5000,
    })
    return
  }

  isSaving.value = true

  // Only recheck duplicates if the user actually edited an input on Step 3
  if (hasStep3InputEdits()) {
    const hasDuplicates = await searchDuplicates()
    if (hasDuplicates) {
      isSaving.value = false
      currentStep.value = 2
      return
    }
  }

  const { data: result, error } = await executeCreate(form, 'customer', {
    addresses: buildAddressCreatePayloads(),
  })

  isSaving.value = false

  if (error) {
    toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
    return
  }

  saveCompleted.value = true
  clearFormState()
  toast.add({ severity: 'success', summary: 'Success', detail: 'Customer created successfully', life: 3000 })

  // Navigate by the Directus id — it always exists on the freshly-created
  // record, whereas `account_number` is assigned later by the SAP sync flow. The detail
  // page resolves either key.
  const newPartnerId = result.partner?.id
  if (newPartnerId) {
    // Tell the detail page this record was just created, so it shows "syncing"
    // (a sync is genuinely firing) rather than the reopen "not synced" state.
    useJustCreatedPartner().markJustCreated(newPartnerId)
    navigateTo(`/customers/${newPartnerId}`, { replace: true })
  } else {
    navigateTo('/customers', { replace: true })
  }
}

function handleCancel() {
  saveCompleted.value = true
  clearFormState()
  navigateTo('/customers')
}

// Save state only when navigating to a customer detail (duplicate link)
// Clear state for all other navigation (back, cancel, etc.)
onBeforeRouteLeave((to) => {
  const isCustomerDetail = typeof to.path === 'string' && /^\/customers\/[^/]+$/.test(to.path) && to.path !== '/customers/create'
  if (isCustomerDetail && !saveCompleted.value) {
    saveFormState()
  } else {
    clearFormState()
  }
})

useClearErrorsOnEdit(form, errors)
useClearErrorsOnEdit(form.shipping, shippingErrors)
useClearErrorsOnEdit(form.billing, billingErrors)

watch([() => form.phoneNumber, () => form.extension], () => {
  if (form.phoneNumber) {
    const digits = String(form.phoneNumber).replace(/\D/g, '')
    if (digits !== form.phoneNumber) form.phoneNumber = digits
  }
  if (form.extension) {
    const cleaned = sanitizeExtension(form.extension)
    if (cleaned !== form.extension) form.extension = cleaned
  }
})

// Until a richer Twilio integration can verify SMS capability, a mobile number is
// SMS-capable by definition: force the flag on for mobile and clear it when
// switching away, so the UI never asks a question whose answer we already know
// (the SMS Capable control renders checked + disabled while mobile is selected).
watch(() => form.phoneType, (phoneType, previousPhoneType) => {
  if (phoneType === 'mobile') {
    form.smsCapable = true
  } else if (previousPhoneType === 'mobile') {
    form.smsCapable = false
  }
})
</script>

<template>
  <div class="customer-create-page">
    <BaseBackButton
      to="/customers"
      label="Back to Customers"
      class="customer-create-back"
    />

    <StepProgress
      :steps="steps"
      :current-step="currentStep"
    >
      <!-- STEP 1 — ENTER DETAILS -->
      <CreateCustomerStep1
        v-if="currentStep === 1"
        :form="form"
        :errors="errors"
        :submitted="submitted"
        :partner-group-options="partnerGroupOptions"
        :country-options="countryOptions"
        :phone-types="phoneTypes"
        :require-website="false"
        :is-checking-duplicates="isCheckingDuplicates"
        :reference-data-error="referenceDataError"
        :selected-country-iso="selectedCountryIso"
        :shipping-errors="shippingErrors"
        :billing-errors="billingErrors"
        :shipping-has-intent="shippingHasIntent"
        :billing-has-intent="billingHasIntent"
        @next-step="handleNextStep"
      />

      <!-- STEP 2 — DUPLICATE CHECK -->
    <DuplicateCheck
      v-if="currentStep === 2"
      :form="form"
      :partner-group-options="partnerGroupOptions"
      :country-options="countryOptions"
      :phone-types="phoneTypes"
      :duplicate-list="duplicateList"
      :row-selections="rowSelections"
      :can-proceed-to-final-review="canProceedToFinalReview"
      :is-advancing-to-review="isAdvancingToReview"
      @back="handleBackToForm"
      @final-review="handleFinalReview"
      @update:row-selections="rowSelections = $event"
    />

    <!-- STEP 3 — CONFIRM & CREATE -->
    <ConfirmCreate
      v-if="currentStep === 3"
      :form="form"
      :errors="errors"
      :submitted="submitted"
      :partner-group-options="partnerGroupOptions"
      :country-options="countryOptions"
      :phone-types="phoneTypes"
      :can-create="canCreate"
      :is-saving="isSaving"
      :shipping-errors="shippingErrors"
      :billing-errors="billingErrors"
      :shipping-has-intent="shippingHasIntent"
      :billing-has-intent="billingHasIntent"
      @create="handleCreateCustomer"
      @cancel="handleCancel"
      @back-to-form="handleBackToForm"
      @update:verified-accurate="verifiedAccurate = $event"
      @update:form="handleStep3FieldUpdate"
    />

    </StepProgress>
  </div>
</template>

<style scoped>
.customer-create-page {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: 0;
    padding-bottom: var(--p-spacing-4);
    margin-bottom: calc(-1 * var(--p-spacing-4));
}
</style>
