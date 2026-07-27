import type { ContactForm } from '~/composables/useContactForm'

type DuplicateRow = {
  id: number | string
  name: string
  emailAddress: string
  /** Raw national digits — used for duplicate matching. */
  phoneNumber: string
  /** Display value formatted like the rest of the app (+code, brackets, ext). */
  phoneNumberFormatted: string
}

type DuplicateSnapshot = {
  firstName: string
  lastName: string
  email: string
  phones: string[]
}

export function useContactDuplicates(form: ContactForm, normalizePhone: (value: string) => string) {
  const contactDuplicateList = ref<DuplicateRow[]>([])
  const contactRowSelections = ref<Record<string, string>>({})
  const isCheckingContactDuplicates = ref(false)
  const contactVerified = ref(false)
  const contactFormEditedOnStep3 = ref(false)
  const step3Snapshot = ref<DuplicateSnapshot | null>(null)
  const originalDuplicateFields = ref<DuplicateSnapshot | null>(null)

  const allContactRowsDismissed = computed(() => {
    if (contactDuplicateList.value.length === 0) return true
    return contactDuplicateList.value.every(
      (row) => contactRowSelections.value[row.id] === 'not-duplicate',
    )
  })

  function buildSnapshot(): DuplicateSnapshot {
    return {
      firstName: form.firstName.trim().toLowerCase(),
      lastName: form.lastName.trim().toLowerCase(),
      email: form.email.trim().toLowerCase(),
      phones: form.phoneNumbers
        .map((p) => normalizePhone(p.rawNumber || p.number || ''))
        .filter((p) => p.length >= MIN_PHONE_SEARCH_DIGITS)
        .sort(),
    }
  }

  function takeStep3Snapshot() {
    step3Snapshot.value = buildSnapshot()
  }

  function hasSnapshotChanged(snap: DuplicateSnapshot | null): boolean {
    if (!snap) return false
    if (form.firstName.trim().toLowerCase() !== snap.firstName) return true
    if (form.lastName.trim().toLowerCase() !== snap.lastName) return true
    if (form.email.trim().toLowerCase() !== snap.email) return true
    const currentPhones = form.phoneNumbers
      .map((p) => normalizePhone(p.rawNumber || p.number || ''))
      .filter((p) => p.length >= MIN_PHONE_SEARCH_DIGITS)
      .sort()
    const snapPhones = [...snap.phones].sort()
    if (currentPhones.length !== snapPhones.length) return true
    return currentPhones.some((p, i) => p !== snapPhones[i])
  }

  function hasDuplicateFieldsChangedOnStep3() {
    return hasSnapshotChanged(step3Snapshot.value)
  }

  function hasDuplicateFieldsChanged() {
    return hasSnapshotChanged(originalDuplicateFields.value)
  }

  function populateOriginalDuplicateFields() {
    originalDuplicateFields.value = {
      firstName: form.firstName.trim().toLowerCase(),
      lastName: form.lastName.trim().toLowerCase(),
      email: form.email.trim().toLowerCase(),
      phones: form.phoneNumbers
        .map((p) => normalizePhone(p.rawNumber || p.number || ''))
        .filter((p) => p.length >= MIN_PHONE_SEARCH_DIGITS),
    }
  }

  async function searchContactDuplicates(
    businessPartnerId: number | null | undefined,
    excludeJunctionId: number | string | null,
  ): Promise<boolean> {
    if (!businessPartnerId) return false

    const contactJunctionCrud = useDirectusCrud('business_partners_contacts')
    const { data: junctions, error } = await contactJunctionCrud.fetchMany({
      fields: [
        'id',
        'contacts_id.first_name',
        'contacts_id.last_name',
        'contacts_id.email_address',
        'contacts_id.phone_numbers.phone_numbers_id.number',
        'contacts_id.phone_numbers.phone_numbers_id.extension',
        'contacts_id.phone_numbers.phone_numbers_id.countries_id.phone_code',
        'contacts_id.phone_numbers.phone_numbers_id.countries_id.code',
      ],
      filter: { business_partners_id: { _eq: businessPartnerId } },
      limit: -1,
      deep: { contacts_id: { phone_numbers: { _limit: -1 } } },
    })

    if (error || !junctions?.length) {
      contactDuplicateList.value = []
      return false
    }

    const enteredEmail = form.email.trim().toLowerCase()
    const enteredFirstName = form.firstName.trim().toLowerCase()
    const enteredLastName = form.lastName.trim().toLowerCase()
    const enteredPhones: string[] = []
    for (const phone of form.phoneNumbers) {
      const normalized = normalizePhone(phone.rawNumber || '')
      if (normalized.length >= MIN_PHONE_SEARCH_DIGITS) enteredPhones.push(normalized)
    }

    const rows: DuplicateRow[] = []
    for (const junction of junctions as Record<string, any>[]) {
      const contact = junction.contacts_id as Record<string, any> | null
      if (!contact) continue

      let isMatch = false
      let matchedPhoneRecord: Record<string, any> | null = null

      if (enteredEmail && contact.email_address) {
        if (contact.email_address.toLowerCase() === enteredEmail) isMatch = true
      }

      if (enteredPhones.length > 0) {
        const contactPhones = (contact.phone_numbers || []) as Record<string, any>[]
        for (const phoneJunction of contactPhones) {
          const phoneRecord = phoneJunction.phone_numbers_id as Record<string, any> | null
          if (phoneRecord?.number) {
            const normalizedExisting = normalizePhone(phoneRecord.number)
            if (enteredPhones.some((ep) => ep === normalizedExisting)) {
              isMatch = true
              matchedPhoneRecord = phoneRecord
              break
            }
          }
        }
      }

      if (!isMatch) {
        const existingFirst = (contact.first_name || '').toLowerCase()
        const existingLast = (contact.last_name || '').toLowerCase()
        const existingTokens = new Set(
          `${existingFirst} ${existingLast}`.split(/\s+/).filter(Boolean),
        )
        const enteredTokens = `${enteredFirstName} ${enteredLastName}`
          .split(/\s+/)
          .filter(Boolean)
        if (
          enteredTokens.length > 0
          && existingTokens.size > 0
          && enteredTokens.every((token) => existingTokens.has(token))
        ) {
          isMatch = true
        }
      }

      if (!isMatch) continue

      const phones = (contact.phone_numbers || []) as Record<string, any>[]
      const displayPhone = matchedPhoneRecord || (phones[0]?.phone_numbers_id as Record<string, any> | null)
      rows.push({
        id: junction.id,
        name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim(),
        emailAddress: contact.email_address || '',
        phoneNumber: displayPhone?.number || '',
        phoneNumberFormatted: displayPhone?.number
          ? formatPhoneNumber(
              {
                number: displayPhone.number,
                extension: displayPhone.extension,
                countries_id: displayPhone.countries_id,
              },
              { includeExtension: false },
            )
          : '',
      })
    }

    const filteredRows = excludeJunctionId
      ? rows.filter((row) => row.id !== excludeJunctionId)
      : rows

    contactDuplicateList.value = filteredRows
    contactRowSelections.value = {}
    return filteredRows.length > 0
  }

  function resetDuplicateState() {
    contactDuplicateList.value = []
    contactRowSelections.value = {}
    contactVerified.value = false
    contactFormEditedOnStep3.value = false
    step3Snapshot.value = null
    originalDuplicateFields.value = null
  }

  return {
    contactDuplicateList,
    contactRowSelections,
    isCheckingContactDuplicates,
    contactVerified,
    contactFormEditedOnStep3,
    step3Snapshot,
    originalDuplicateFields,
    allContactRowsDismissed,
    takeStep3Snapshot,
    hasDuplicateFieldsChangedOnStep3,
    hasDuplicateFieldsChanged,
    populateOriginalDuplicateFields,
    searchContactDuplicates,
    resetDuplicateState,
  }
}
