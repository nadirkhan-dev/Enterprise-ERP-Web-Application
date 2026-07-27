import type { ComputedRef } from 'vue'
import type { FieldRulesMap } from '~/utils/validationRules'

type AddressInput = Record<string, any>

type CountryOption = {
  id: number
  name: string
  code: string
  phone_code?: string | null
}

type ContactInput = {
  status?: string | null
  firstName?: string | null
  lastName?: string | null
  jobTitle?: string | null
  email?: string | null
  addressJunctionId?: number | string | null
  allowTransactionalEmail?: boolean | null
  allowMarketingEmail?: boolean | null
  allowTransactionalSms?: boolean | null
  allowMarketingSms?: boolean | null
  notes?: string | null
  inactiveNote?: string | null
  phoneNumbers?: PhoneNumberInput[]
  [key: string]: unknown
}

export type PhoneNumberInput = {
  id: number
  junctionId?: number | null
  phoneRecordId?: number | null
  type?: string | null
  number?: string | null
  rawNumber?: string | null
  extension?: string | null
  smsCapable?: boolean | null
  countryId?: number | null
  sort?: number | null
  isDefault?: boolean | null
  isNew?: boolean
}

export type PhoneRow = {
  id: number
  junctionId?: number | null
  phoneRecordId?: number | null
  type: string
  number: string
  rawNumber: string
  extension: string
  smsCapable: boolean
  countryId: number | null
  sort?: number | null
  // The contact's default phone, stored on the junction (phone_numbers_default),
  // independent of sort order. At most one phone per contact is the default.
  isDefault: boolean
  isNew: boolean
}

export type ContactForm = {
  status: string
  firstName: string
  lastName: string
  jobTitle: string
  email: string
  address: number | string | null
  phoneNumbers: PhoneRow[]
  allowTransactionalEmail: boolean
  allowMarketingEmail: boolean
  allowTransactionalSms: boolean
  allowMarketingSms: boolean
  notes: string
  inactiveNote: string
  isPrimaryContact: boolean
}

export type ContactErrors = {
  firstName: string
  lastName: string
  jobTitle: string
  email: string
  inactiveNote: string
  phoneNumbers: string
  phoneCountry: string
  phoneNumber: string
  phoneExtension: string
}

const EMPTY_ERRORS: ContactErrors = {
  firstName: '',
  lastName: '',
  jobTitle: '',
  email: '',
  inactiveNote: '',
  phoneNumbers: '',
  phoneCountry: '',
  phoneNumber: '',
  phoneExtension: '',
}

const EMPTY_FORM: ContactForm = {
  status: 'active',
  firstName: '',
  lastName: '',
  jobTitle: '',
  email: '',
  address: null,
  phoneNumbers: [],
  allowTransactionalEmail: false,
  allowMarketingEmail: false,
  allowTransactionalSms: false,
  allowMarketingSms: false,
  notes: '',
  inactiveNote: '',
  isPrimaryContact: false,
}

export function useContactForm(addresses: ComputedRef<AddressInput[]>) {
  const form = reactive<ContactForm>({ ...EMPTY_FORM, phoneNumbers: [] })
  const errors = reactive<ContactErrors>({ ...EMPTY_ERRORS })
  useClearErrorsOnEdit(form as Record<string, any>, errors as Record<string, string>)

  const emailTouched = ref(false)

  const isEmailFormatInvalid = computed(
    () => form.email.length > 0 && !(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(form.email.trim()),
  )
  const isEmailInvalid = computed(() => emailTouched.value && isEmailFormatInvalid.value)

  function handleEmailBlur() {
    if (isEmailFormatInvalid.value) emailTouched.value = true
  }

  function handleEmailInput() {
    emailTouched.value = false
  }

  const contactDisplayName = computed(() => {
    if (form.firstName || form.lastName) {
      return `${form.firstName} ${form.lastName}`.trim()
    }
    return 'New Contact'
  })

  const addressSelectOptions = computed(() => addresses.value.map((addr) => ({
    label: [addr.street, addr.city, addr.state].filter(Boolean).join(', '),
    value: addr.id,
  })))

  function clearAllErrors() {
    Object.assign(errors, EMPTY_ERRORS)
  }

  function resetForm() {
    Object.assign(form, EMPTY_FORM)
    form.phoneNumbers = []
    emailTouched.value = false
  }

  function populateFromContact(contact: ContactInput) {
    form.status = contact.status || 'active'
    form.firstName = contact.firstName || ''
    form.lastName = contact.lastName || ''
    form.jobTitle = contact.jobTitle || ''
    form.email = contact.email || ''
    form.address = contact.addressJunctionId || null
    form.allowTransactionalEmail = contact.allowTransactionalEmail ?? false
    form.allowMarketingEmail = contact.allowMarketingEmail ?? false
    form.allowTransactionalSms = contact.allowTransactionalSms ?? false
    form.allowMarketingSms = contact.allowMarketingSms ?? false
    form.notes = contact.notes || ''
    form.inactiveNote = contact.inactiveNote || ''

    const phones: PhoneRow[] = (contact.phoneNumbers || []).map((phone) => ({
      id: phone.id,
      junctionId: phone.junctionId ?? null,
      phoneRecordId: phone.phoneRecordId ?? null,
      type: phone.type || '',
      number: phone.number || '',
      rawNumber: phone.rawNumber || '',
      extension: phone.extension || '',
      smsCapable: phone.smsCapable || false,
      countryId: phone.countryId || null,
      sort: phone.sort ?? null,
      isDefault: phone.isDefault ?? false,
      isNew: false,
    }))
    phones.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    form.phoneNumbers = phones
    return phones
  }

  function validateContactFields(getRules: (collection: string) => FieldRulesMap) {
    const contactFieldRules = getRules('contacts')
    const junctionRules = getRules('business_partners_contacts')

    errors.firstName = validateField(form.firstName, contactFieldRules.first_name)
    errors.lastName = validateField(form.lastName, contactFieldRules.last_name)
    errors.jobTitle = validateField(form.jobTitle, contactFieldRules.job_title)
    errors.email = validateField(form.email, { required: true, ...contactFieldRules.email_address })
    errors.inactiveNote = validateField(form.inactiveNote, junctionRules.inactive_note, form)

    return !(errors.firstName || errors.lastName || errors.jobTitle || errors.email || errors.inactiveNote)
  }

  /**
   * Validate phone rows, but ONLY the ones the user added or edited this
   * session — a row is "touched" when `isNew` or its id is in `modifiedPhoneIds`.
   * Pre-existing, untouched numbers (some saved before validation existed, and
   * possibly invalid) are left alone so a bad legacy number can't block saving a
   * new/edited one. Untouched numbers still seed the duplicate set so a new
   * number can't collide with an existing one.
   */
  function validatePhoneRows(
    getRules: (collection: string) => FieldRulesMap,
    countryOptions: CountryOption[],
    modifiedPhoneIds: Set<number> = new Set(),
  ) {
    const phoneRules = getRules('phone_numbers')
    const isTouched = (phone: PhoneRow) => phone.isNew || modifiedPhoneIds.has(phone.id)

    const seenDigits = new Set<string>()
    // Seed with untouched rows for collision detection (they are NOT re-validated).
    for (const phone of form.phoneNumbers) {
      if (isTouched(phone)) continue
      const digits = digitsOnly(phone.rawNumber || '')
      if (digits.length >= MIN_PHONE_DEDUP_DIGITS) seenDigits.add(digits)
    }

    for (const phone of form.phoneNumbers) {
      if (!isTouched(phone)) continue
      const rowIso = countryOptions.find((c) => c.id === phone.countryId)?.code ?? null
      const rowValidator = usePhoneInput(ref(rowIso))
      const requiredError = validateField(phone.rawNumber, {
        ...phoneRules.number,
        required: true,
        requiredMessage: 'Phone number is required.',
      })
      const countryError = validateField(phone.countryId, phoneRules.countries_id)
      const extensionError = validateField(phone.extension, phoneRules.extension)
      const formatError = !requiredError && phone.rawNumber?.trim() && !rowValidator.isValid(phone.rawNumber)
        ? 'Invalid phone number.'
        : ''

      if (requiredError || formatError || countryError || extensionError) {
        errors.phoneNumbers = errors.phoneNumbers || 'One or more phone numbers have validation errors'
        return false
      }

      const digits = digitsOnly(phone.rawNumber || '')
      if (digits.length >= MIN_PHONE_DEDUP_DIGITS) {
        if (seenDigits.has(digits)) {
          errors.phoneNumbers = 'Duplicate phone numbers are not allowed.'
          return false
        }
        seenDigits.add(digits)
      }
    }
    return true
  }

  /**
   * True when a NEW or EDITED phone row is too short. Untouched legacy rows are
   * ignored so they can't block saving a freshly added number.
   */
  function hasShortPhone(
    normalizePhone: (value: string) => string,
    modifiedPhoneIds: Set<number> = new Set(),
  ) {
    return form.phoneNumbers.some((phone) => {
      if (!(phone.isNew || modifiedPhoneIds.has(phone.id))) return false
      const source = phone.rawNumber || phone.number || ''
      return normalizePhone(source).length < MIN_PHONE_DEDUP_DIGITS
    })
  }

  return {
    form,
    errors,
    emailTouched,
    isEmailFormatInvalid,
    isEmailInvalid,
    handleEmailBlur,
    handleEmailInput,
    contactDisplayName,
    addressSelectOptions,
    clearAllErrors,
    resetForm,
    populateFromContact,
    validateContactFields,
    validatePhoneRows,
    hasShortPhone,
  }
}
