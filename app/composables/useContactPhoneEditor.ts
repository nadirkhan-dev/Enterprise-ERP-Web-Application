import type { ComputedRef, Ref } from 'vue'
import type { FieldRulesMap } from '~/utils/validationRules'
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

type OriginalPhoneSnapshot = {
  type: string
  rawNumber: string
  extension: string
  smsCapable: boolean
  countryId: number | null
  sort: number | null
  isDefault: boolean
}

type Options = {
  form: ContactForm
  errors: ContactErrors
  countryOptions: ComputedRef<CountryOption[]>
  submitted: Ref<boolean>
  normalizePhone: (value: string) => string
  getPhoneRules: () => FieldRulesMap
}

export function useContactPhoneEditor({ form, errors, countryOptions, submitted, normalizePhone, getPhoneRules }: Options) {
  const { isMobile } = useIsMobile()
  const dragHandle = computed(() =>
    isMobile.value ? '.phone-card' : '.phone-card__sort-handle',
  )

  const editingPhoneId = ref<number | null>(null)
  // Whether validation has been attempted for the CURRENT phone edit. Resets
  // every time an edit opens, so adding a fresh phone never shows an error
  // until the user actually tries to save/commit it (the global `submitted`
  // flag stays true across the form and can't gate per-edit display).
  const phoneEditAttempted = ref(false)
  const phoneEditForm = reactive<PhoneEditForm>({
    type: 'general',
    country: null,
    phoneNumber: '',
    extension: '',
    smsCapable: false,
    isDefault: false,
  })

  const modifiedPhoneIds = ref(new Set<number>())
  const newPhones = ref<PhoneRow[]>([])
  const deletedJunctionIds = ref(new Set<number>())
  let nextTempId = -1
  let originalPhoneData: Record<number, OriginalPhoneSnapshot> = {}
  // Suppresses the phone-type → SMS sync while an existing phone is loaded into
  // the editor, so opening a saved record never auto-flips its SMS flag or marks
  // it edited. The sync only reacts to the user changing the type.
  let isLoadingPhoneEdit = false

  const editingPhoneCountryIso = useCountryIsoLookup(computed(() => phoneEditForm.country))
  const editingPhoneValidator = usePhoneInput(editingPhoneCountryIso)

  const editingPhoneCountryCode = computed(() => {
    const country = countryOptions.value.find((c) => c.id === phoneEditForm.country)
    const code = country?.phone_code
    return code ? `+${code}` : null
  })

  // True when the phone number currently being edited is empty, too short, or
  // fails format validation for the selected country. Duplicates are excluded —
  // they carry their own inline message, not the "enter a valid number" prompt.
  const isEditingPhoneNumberInvalid = computed(() => {
    if (editingPhoneId.value === null) return false
    const trimmed = phoneEditForm.phoneNumber?.trim()
    if (!trimmed) return true
    if (normalizePhone(phoneEditForm.phoneNumber).length < MIN_PHONE_DEDUP_DIGITS) return true
    return !editingPhoneValidator.isValid(phoneEditForm.phoneNumber)
  })

  // Drives the drawer-level error banner: only after a save/commit attempt on
  // THIS edit, and only while the open edit's number is empty or invalid.
  const showPhoneErrorBanner = computed(
    () => phoneEditAttempted.value && isEditingPhoneNumberInvalid.value,
  )

  // Disables Save while editing: only once the user has entered something that
  // isn't yet a valid number. An empty field keeps Save enabled — the required
  // check only fires on an actual save attempt.
  const isEditingPhoneEntryInvalid = computed(() => {
    if (editingPhoneId.value === null) return false
    if (!phoneEditForm.phoneNumber?.trim()) return false
    return isEditingPhoneNumberInvalid.value
  })

  function clearPhoneFieldErrors() {
    errors.phoneCountry = ''
    errors.phoneNumber = ''
    errors.phoneExtension = ''
  }

  function buildPhoneRecord(countryId: number | null, number: string, extension: string | null = null) {
    const country = countryOptions.value.find((c) => c.id === countryId) || null
    return {
      number,
      extension,
      countries_id: country ? { phone_code: country.phone_code, code: country.code } : null,
    }
  }

  function getFormattedPhone(phone: PhoneRow) {
    return formatPhoneNumber(buildPhoneRecord(phone.countryId, phone.rawNumber, phone.extension))
  }

  function buildPhonePayload(phone: PhoneRow) {
    const payload: Record<string, unknown> = {
      number: digitsOnly(phone.rawNumber),
      type: phone.type,
      sms_capable: phone.smsCapable,
      countries_id: phone.countryId,
    }
    const cleanedExtension = digitsOnly(phone.extension)
    if (cleanedExtension) {
      payload.extension = cleanedExtension
    }
    return payload
  }

  function updatePhoneEditFromInput(value: { countriesId: number | null; number: string; extension?: string | null }) {
    if (value.countriesId != null && value.countriesId !== phoneEditForm.country) {
      phoneEditForm.country = value.countriesId
    }
    phoneEditForm.phoneNumber = value.number || ''
    if (value.extension !== undefined && value.extension !== null) {
      phoneEditForm.extension = value.extension
    }
    phoneEditAttempted.value = false
    clearPhoneFieldErrors()
  }

  function editPhoneNumber(phone: PhoneRow) {
    if (editingPhoneId.value !== null && editingPhoneId.value !== phone.id) {
      closePhoneEdit()
      if (editingPhoneId.value !== null) return
    }
    isLoadingPhoneEdit = true
    editingPhoneId.value = phone.id
    phoneEditForm.type = phone.type || 'general'
    phoneEditForm.country = phone.countryId || null
    phoneEditForm.phoneNumber = phone.rawNumber || ''
    phoneEditForm.extension = phone.extension || ''
    phoneEditForm.smsCapable = phone.smsCapable || false
    // Default is stored per-phone (independent of sort order), so reflect this
    // phone's own flag rather than its position.
    phoneEditForm.isDefault = phone.isDefault
    phoneEditAttempted.value = false
    clearPhoneFieldErrors()
    // Re-enable after the watcher flush this load triggers.
    nextTick(() => { isLoadingPhoneEdit = false })
  }

  function discardPhoneEdit() {
    const phoneId = editingPhoneId.value
    if (phoneId === null) return
    const phone = form.phoneNumbers.find((p) => p.id === phoneId)
    editingPhoneId.value = null
    clearPhoneFieldErrors()
    if (!phone) return
    const prevDigits = normalizePhone(phone.rawNumber || '')
    if (phone.isNew && prevDigits.length < MIN_PHONE_DEDUP_DIGITS) {
      removePhoneNumber(phone)
    }
  }

  function closePhoneEdit() {
    const phoneId = editingPhoneId.value
    if (phoneId === null) return

    const phone = form.phoneNumbers.find((p) => p.id === phoneId)
    if (!phone) {
      editingPhoneId.value = null
      return
    }

    const editDigits = normalizePhone(phoneEditForm.phoneNumber || '')
    const prevDigits = normalizePhone(phone.rawNumber || '')
    const isEmpty = editDigits.length === 0
    const isTooShort = editDigits.length > 0 && editDigits.length < MIN_PHONE_DEDUP_DIGITS
    const hadPreviousValid = prevDigits.length >= MIN_PHONE_DEDUP_DIGITS

    if (isEmpty && phone.isNew && !hadPreviousValid) {
      editingPhoneId.value = null
      removePhoneNumber(phone)
      return
    }
    if (isEmpty) {
      editingPhoneId.value = null
      return
    }
    if (isTooShort) {
      submitted.value = true
      validatePhoneFields()
      return
    }
    // Long enough but not a valid number for the country — keep the editor open
    // and surface the banner instead of committing an invalid card.
    if (!editingPhoneValidator.isValid(phoneEditForm.phoneNumber)) {
      submitted.value = true
      validatePhoneFields()
      return
    }
    if (isDuplicateEditingNumber()) {
      submitted.value = true
      validatePhoneFields()
      return
    }

    phone.type = phoneEditForm.type
    phone.countryId = phoneEditForm.country
    phone.rawNumber = phoneEditForm.phoneNumber
    phone.extension = phoneEditForm.extension
    phone.smsCapable = phoneEditForm.smsCapable

    // Set the default flag WITHOUT reordering — position is owned by drag-sort.
    // At most one phone is the default, so checking this one clears the others.
    if (phoneEditForm.isDefault) {
      form.phoneNumbers.forEach((p) => { p.isDefault = p.id === phoneId })
    } else {
      phone.isDefault = false
    }

    if (phoneId > 0 && originalPhoneData[phoneId]) {
      const orig = originalPhoneData[phoneId]
      const isChanged
        = orig.type !== phone.type
        || orig.rawNumber !== phone.rawNumber
        || orig.extension !== phone.extension
        || orig.smsCapable !== phone.smsCapable
        || orig.countryId !== phone.countryId
      if (isChanged) modifiedPhoneIds.value.add(phoneId)
      else modifiedPhoneIds.value.delete(phoneId)
    }

    editingPhoneId.value = null
  }

  function addPhoneNumber() {
    if (editingPhoneId.value !== null) {
      closePhoneEdit()
      if (editingPhoneId.value !== null) return
    }
    const usCountry = countryOptions.value.find((c) => c.name === 'United States')
    const tempPhone: PhoneRow = {
      id: nextTempId--,
      type: '',
      rawNumber: '',
      extension: '',
      smsCapable: false,
      countryId: usCountry?.id || null,
      number: '',
      isDefault: false,
      isNew: true,
    }
    form.phoneNumbers.push(tempPhone)
    newPhones.value.push(tempPhone)
    editPhoneNumber(tempPhone)
  }

  function removePhoneNumber(phone: PhoneRow) {
    if (editingPhoneId.value === phone.id) {
      editingPhoneId.value = null
      clearPhoneFieldErrors()
    }

    const formIndex = form.phoneNumbers.findIndex((p) => p.id === phone.id)
    if (formIndex !== -1) form.phoneNumbers.splice(formIndex, 1)

    if (phone.isNew) {
      const newIndex = newPhones.value.findIndex((p) => p.id === phone.id)
      if (newIndex !== -1) newPhones.value.splice(newIndex, 1)
    } else if (phone.junctionId) {
      deletedJunctionIds.value.add(phone.junctionId)
    }
    modifiedPhoneIds.value.delete(phone.id)
  }

  function isDuplicateEditingNumber() {
    const editingDigits = normalizePhone(phoneEditForm.phoneNumber || '')
    if (editingDigits.length < MIN_PHONE_DEDUP_DIGITS) return false
    return form.phoneNumbers.some((other) => {
      if (other.id === editingPhoneId.value) return false
      return normalizePhone(other.rawNumber || '') === editingDigits
    })
  }

  function validatePhoneFields() {
    // Any call to validate is an explicit attempt — from here on, this edit's
    // errors/banner may show (the live watcher only runs once this is set).
    phoneEditAttempted.value = true
    const phoneRules = getPhoneRules()
    errors.phoneCountry = validateField(phoneEditForm.country, phoneRules.countries_id)
    errors.phoneExtension = validateField(phoneEditForm.extension, phoneRules.extension)
    const requiredError = validateField(phoneEditForm.phoneNumber, {
      ...phoneRules.number,
      required: true,
      requiredMessage: 'Phone number is required.',
    })
    if (requiredError) {
      errors.phoneNumber = requiredError
    } else if (phoneEditForm.phoneNumber?.trim()) {
      if (!editingPhoneValidator.isValid(phoneEditForm.phoneNumber)) {
        errors.phoneNumber = 'Enter a valid phone number.'
      } else if (isDuplicateEditingNumber()) {
        errors.phoneNumber = 'This phone number has already been added.'
      } else {
        errors.phoneNumber = ''
      }
    } else {
      errors.phoneNumber = ''
    }
    return !errors.phoneCountry && !errors.phoneNumber && !errors.phoneExtension
  }

  function snapshotOriginalPhones(phones: PhoneRow[]) {
    originalPhoneData = {}
    phones.forEach((phone) => {
      originalPhoneData[phone.id] = {
        type: phone.type,
        rawNumber: phone.rawNumber,
        extension: phone.extension,
        smsCapable: phone.smsCapable,
        countryId: phone.countryId,
        sort: phone.sort ?? null,
        isDefault: phone.isDefault,
      }
    })
  }

  function getOriginalPhoneData() {
    return originalPhoneData
  }

  function resetPhoneState() {
    editingPhoneId.value = null
    modifiedPhoneIds.value = new Set()
    newPhones.value = []
    deletedJunctionIds.value = new Set()
    nextTempId = -1
    originalPhoneData = {}
  }

  watch(() => phoneEditForm.phoneNumber, (newVal) => {
    if (!newVal) return
    const cleaned = String(newVal).replace(/\D/g, '')
    if (cleaned !== newVal) phoneEditForm.phoneNumber = cleaned
  })

  watch(() => phoneEditForm.extension, (newVal) => {
    if (!newVal) return
    const cleaned = sanitizeExtension(newVal)
    if (cleaned !== newVal) phoneEditForm.extension = cleaned
  })

  // Once a save/next has been attempted, re-validate the open edit live so the
  // inline field highlight and the error banner clear automatically the moment
  // the number becomes valid (acceptance: "Banner disappears after the phone
  // number becomes valid").
  watch(
    () => [phoneEditForm.phoneNumber, phoneEditForm.extension],
    () => {
      if (phoneEditAttempted.value && editingPhoneId.value !== null) validatePhoneFields()
    },
  )

  // Changing the country clears any existing phone error and does NOT re-run
  // validation — the number is only re-checked on the next save attempt.
  // Resetting the attempted flag also pauses the live watcher above until then.
  watch(() => phoneEditForm.country, () => {
    if (editingPhoneId.value === null) return
    clearPhoneFieldErrors()
    phoneEditAttempted.value = false
  })

  // Until a richer Twilio integration can verify SMS capability, a mobile number
  // is SMS-capable by definition: force the flag on for mobile and clear it when
  // switching away, so the UI never asks a question whose answer we already know
  // (SMS Capable renders checked + disabled while mobile is selected). Skipped
  // during load so an existing phone's saved flag isn't disturbed on open.
  watch(() => phoneEditForm.type, (type, previousType) => {
    if (isLoadingPhoneEdit) return
    if (type === 'mobile') {
      phoneEditForm.smsCapable = true
    } else if (previousType === 'mobile') {
      phoneEditForm.smsCapable = false
    }
  })

  return {
    isMobile,
    dragHandle,
    editingPhoneId,
    phoneEditForm,
    modifiedPhoneIds,
    newPhones,
    deletedJunctionIds,
    editingPhoneCountryIso,
    editingPhoneCountryCode,
    showPhoneErrorBanner,
    isEditingPhoneNumberInvalid,
    isEditingPhoneEntryInvalid,
    editPhoneNumber,
    addPhoneNumber,
    removePhoneNumber,
    closePhoneEdit,
    discardPhoneEdit,
    updatePhoneEditFromInput,
    validatePhoneFields,
    getFormattedPhone,
    buildPhonePayload,
    snapshotOriginalPhones,
    getOriginalPhoneData,
    resetPhoneState,
  }
}
