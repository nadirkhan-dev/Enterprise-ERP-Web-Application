/**
 * The supplier CREATE flow, minus its host chrome.
 *
 * Extracted from Suppliers/Create.vue so the very same flow can run in two places:
 * the full-page create screen, and the in-panel drawer opened from a manufacturer's
 * "Add New Supplier" (CONNECT — create-permitted users create in place rather than
 * requesting via ops). Everything host-specific — session persistence, navigation,
 * and what happens on success — stays with the caller; this composable owns the
 * form, its validation, the duplicate gate, and the create call itself.
 *
 * The three step components (CreateCustomerStep1 → DuplicateCheck → ConfirmCreate)
 * are driven entirely off the state returned here, so both hosts render an identical
 * flow.
 */
export function useSupplierCreateForm() {
  const toast = useToast()
  const { fetchBusinessPartnerGroups } = useBusinessPartnerGroups()
  const { executeCreate } = useCreateBusinessPartner()
  const referenceData = useReferenceDataStore()

  const form = reactive({
    companyName: '',
    partnerGroup: null as number | null,
    website: '',
    isNationalAccount: false,
    firstName: '',
    lastName: '',
    jobTitle: '',
    emailAddress: '',
    country: null as number | null,
    phoneNumber: '',
    extension: '',
    phoneType: 'direct',
    smsCapable: false,
    // The initial contact is always the partner's only contact, so it's the
    // default sales + billing contact (locked in the UI), mirroring addresses.
    isPrimaryContact: true,
    logoFileId: null,
    // Suppliers collect a single billing address (no shipping). Optional — a
    // partner can be created with no address.
    billing: {
      country: null as number | null,
      street: '',
      unitSuite: '',
      city: '',
      state: null as number | null,
      postalCode: '',
      latitude: null,
      longitude: null,
    },
  })

  const submitted = ref(false)
  const isSaving = ref(false)
  const saveCompleted = ref(false)
  const supplierGroupOptions = ref<Record<string, any>[]>([])
  const referenceDataError = ref<string | null>(null)

  const {
    logoPreviewUrl,
    handleFileSelect,
  } = useCustomerCreateLogo(form, saveCompleted)

  const currentStep = ref(1)

  const { duplicateList, rowSelections, searchDuplicates } = useCustomerDuplicateSearch(form, 'supplier')
  const isCheckingDuplicates = ref(false)

  // Track whether the user actually changed an input on Step 3 (so Create knows to
  // re-check duplicates). We snapshot the entered values on entering Step 3 and
  // compare on Create — this counts real edits to the identity fields (name,
  // website, group, contact, …) but NOT button clicks or internal state. Address
  // slices and the `useShippingAsBilling` toggle are excluded: address edits don't
  // affect duplicate matching, and their objects get mutated in place (lat/long,
  // key order) which would register as phantom edits.
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

  const billingErrors = reactive({
    country: '',
    street: '',
    city: '',
    state: '',
    postalCode: '',
  })

  // The billing address is optional. "Intent" = the user has begun entering it
  // (any field beyond the always-defaulted country) — which promotes the
  // database-required fields to hard requirements.
  function addressHasIntent(address: Record<string, any>) {
    return Boolean(
      address.street.trim()
      || address.unitSuite.trim()
      || address.city.trim()
      || address.postalCode.trim()
      || address.state,
    )
  }
  const billingHasIntent = computed(() => addressHasIntent(form.billing))

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

  // Shape the billing slice into the Directus addresses payload (mirrors the
  // Address drawer create mapping — proper-case lines, region/coords, optional
  // unit as street_line_2). Addresses store proper-case (CONNECT-602); the postal
  // code stays uppercase (conventionally case-insensitive).
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

  // A supplier's lone billing address junction (no shipping). Empty when the user
  // entered no address.
  function buildAddressCreatePayloads() {
    if (!billingHasIntent.value) { return [] }
    return [{
      is_shipping_address: false,
      is_billing_address: true,
      addresses_id: mapAddressToPayload(form.billing),
    }]
  }

  // Fax is intentionally omitted — matches customer creation (see Customers/Create),
  // and keeps the four-control Phone Type row from overflowing so SMS Capable sits
  // in Fax's former inline slot beside the radios.
  const phoneTypes = [
    { label: 'General', value: 'general' },
    { label: 'Direct', value: 'direct' },
    { label: 'Mobile', value: 'mobile' },
  ]

  const canProceedToFinalReview = computed(() => {
    if (duplicateList.value.length === 0) return true
    return duplicateList.value.every((row) => rowSelections.value[row.id] === 'not-duplicate')
  })

  const canCreate = computed(() => {
    if (!verifiedAccurate.value) return false
    return canProceedToFinalReview.value
  })

  const countryOptions = computed(() => referenceData.countryOptions)
  const selectedCountryIso = useCountryIsoLookup(computed(() => form.country))
  const phoneValidator = usePhoneInput(selectedCountryIso)

  /**
   * Load the supplier group options and default the country to the US. `skipDefaults`
   * lets the page suppress the US default when a persisted draft was restored.
   */
  async function loadGroupsAndDefaults({ skipDefaults = false } = {}) {
    const groupsResult = await fetchBusinessPartnerGroups({ relationshipType: 'supplier' })

    if (groupsResult.error) {
      referenceDataError.value = 'Failed to load form options. Please refresh to try again.'
      return
    }

    supplierGroupOptions.value = groupsResult.data || []

    if (!skipDefaults) {
      const usCountry = countryOptions.value.find((c) => c.name === 'United States')
      if (usCountry) {
        if (!form.country) { form.country = usCountry.id }
        // Billing address defaults to the US country (pre-selected), matching the
        // customer flow. Not treated as address "intent" — only user-entered
        // fields count toward that.
        if (!form.billing.country) { form.billing.country = usCountry.id }
      }
    }
  }

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

    if (!form.companyName.trim()) {errors.companyName = 'Company name is required.'}
    if (!form.partnerGroup) {errors.partnerGroup = 'Supplier group is required.'}
    if (!form.firstName.trim()) {errors.firstName = 'First name is required.'}
    if (!form.lastName.trim()) {errors.lastName = 'Last name is required.'}
    if (!form.country) {errors.country = 'Country is required.'}
    if (!form.phoneNumber.trim()) {errors.phoneNumber = 'Phone number is required.'}

    if (form.emailAddress.trim() && !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(form.emailAddress.trim())) {
      errors.emailAddress = 'Please enter a valid email address.'
    }

    if (form.website.trim() && !(/^https?:\/\//).test(form.website.trim())) {
      errors.website = 'Website must start with http:// or https://'
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

    // Billing address is optional — only validate it once the user shows intent.
    clearAddressErrors(billingErrors)
    const addressValid = billingHasIntent.value ? validateAddress(form.billing, billingErrors) : true

    return contactValid && addressValid
  }

  async function handleNextStep() {
    submitted.value = true
    if (!validateForm()) {
      toast.add({
        severity: 'error',
        summary: 'Validation Error',
        detail: 'Please fix the highlighted fields before continuing.',
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

  async function handleFinalReview() {
    if (!canProceedToFinalReview.value) return
    isAdvancingToReview.value = true
    await nextTick()
    verifiedAccurate.value = false
    captureStep3Snapshot()
    currentStep.value = 3
    isAdvancingToReview.value = false
  }

  function handleBackToForm() {
    currentStep.value = 1
  }

  /**
   * Run final validation, re-check duplicates if Step 3 was edited, and create the
   * supplier. Returns the new partner id on success, or null on any failure — with
   * the validation / duplicate / error handling done here so both hosts behave the
   * same. The SUCCESS action (navigate vs associate-and-close) is the caller's.
   */
  async function createSupplier(): Promise<string | number | null> {
    if (!canCreate.value) return null

    submitted.value = true
    if (!validateForm()) {
      toast.add({
        severity: 'error',
        summary: 'Validation Error',
        detail: 'Please fix the errors before creating the supplier.',
        life: 5000,
      })
      return null
    }

    isSaving.value = true

    // Only recheck duplicates if the user actually edited an input on Step 3
    if (hasStep3InputEdits()) {
      const hasDuplicates = await searchDuplicates()
      if (hasDuplicates) {
        isSaving.value = false
        currentStep.value = 2
        return null
      }
    }

    const { data: result, error } = await executeCreate(form, 'supplier', {
      addresses: buildAddressCreatePayloads(),
    })

    isSaving.value = false

    if (error) {
      toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
      return null
    }

    saveCompleted.value = true
    return result?.partner?.id ?? null
  }

  /**
   * Return every field to its create-time default. The page gets a fresh composable
   * per navigation, but the drawer is mounted once and reused, so it calls this on
   * each open to clear the previous draft. Re-applying the US country default is the
   * caller's job (via loadGroupsAndDefaults) — it needs the country list loaded.
   */
  function resetForm() {
    Object.assign(form, {
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
      phoneType: 'direct',
      smsCapable: false,
      isPrimaryContact: true,
      logoFileId: null,
    })
    Object.assign(form.billing, {
      country: null,
      street: '',
      unitSuite: '',
      city: '',
      state: null,
      postalCode: '',
      latitude: null,
      longitude: null,
    })
    clearAddressErrors(billingErrors)
    Object.keys(errors).forEach((key) => { errors[key as keyof typeof errors] = '' })
    submitted.value = false
    isSaving.value = false
    saveCompleted.value = false
    currentStep.value = 1
    verifiedAccurate.value = false
    isAdvancingToReview.value = false
    duplicateList.value = []
    rowSelections.value = {}
    step3Snapshot.value = null
  }

  useClearErrorsOnEdit(form, errors)
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

  return {
    // state
    form,
    errors,
    billingErrors,
    submitted,
    isSaving,
    saveCompleted,
    isCheckingDuplicates,
    currentStep,
    verifiedAccurate,
    isAdvancingToReview,
    supplierGroupOptions,
    referenceDataError,
    logoPreviewUrl,
    duplicateList,
    rowSelections,
    // derived
    steps,
    phoneTypes,
    countryOptions,
    selectedCountryIso,
    billingHasIntent,
    canProceedToFinalReview,
    canCreate,
    // actions
    handleFileSelect,
    loadGroupsAndDefaults,
    validateForm,
    handleNextStep,
    handleFinalReview,
    handleBackToForm,
    handleStep3FieldUpdate,
    createSupplier,
    captureStep3Snapshot,
    resetForm,
  }
}
