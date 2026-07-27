interface DuplicateRow {
  id: number | string
  sapId: string
  companyName: string
  website: string
  emailAddress: string
  phoneNumber: string
}

interface DuplicateSearchForm {
  companyName: string
  website: string
  emailAddress: string
  phoneNumber: string
}

/**
 * Owns the partner duplicate-search state for the create flow.
 * Builds an OR filter from the entered form fields, queries the business
 * partner collection scoped to `relationshipType`, and projects each match
 * onto a table-friendly row with the contact email/phone most likely to be
 * the duplicate signal.
 *
 * Returns `true` from `searchDuplicates()` when one or more rows were found.
 */
export function useCustomerDuplicateSearch(
  form: DuplicateSearchForm,
  relationshipType: 'customer' | 'supplier' = 'customer',
) {
  const partnerCrud = useDirectusCrud('business_partners')
  const companySettings = useCompanySettingsStore()

  const duplicateList = ref<DuplicateRow[]>([])
  const rowSelections = ref<Record<string, string>>({})

  async function searchDuplicates(): Promise<boolean> {
    // Ensure the generic-provider list is available (idempotent — normally
    // already hydrated at login) before deciding username-vs-domain email matching.
    await companySettings.fetchCompanySettings()
    const genericDomains = companySettings.genericEmailDomainSet

    const normalizedEnteredPhone = digitsOnly(form.phoneNumber)

    const orConditions: Record<string, unknown>[] = []

    if (form.companyName.trim() && form.companyName.trim().length >= 3) {
      orConditions.push({ name: { _icontains: form.companyName.trim() } })
    }

    if (form.website.trim()) {
      const websiteDomain = getWebsiteDomain(form.website)
      if (websiteDomain) {
        orConditions.push({ website: { _icontains: websiteDomain } })
      }
    }

    if (form.emailAddress.trim()) {
      // Corporate domains match the whole domain; generic providers match the
      // username across generic providers only (see buildContactEmailDuplicateFilter).
      const emailFilter = buildContactEmailDuplicateFilter(form.emailAddress, genericDomains)
      if (emailFilter) {
        orConditions.push({ contacts: { contacts_id: emailFilter } })
      }
    }

    if (normalizedEnteredPhone.length >= MIN_PHONE_SEARCH_DIGITS) {
      const rawPhone = form.phoneNumber.trim()
      orConditions.push({ contacts: { contacts_id: { phone_numbers: { phone_numbers_id: { number: { _contains: rawPhone } } } } } })
      if (normalizedEnteredPhone !== rawPhone) {
        orConditions.push({ contacts: { contacts_id: { phone_numbers: { phone_numbers_id: { number: { _contains: normalizedEnteredPhone } } } } } })
      }
    }

    let duplicates: Record<string, any>[] = []

    if (orConditions.length > 0) {
      const { data: filteredPartners, error: filterError } = await partnerCrud.fetchMany({
        fields: [
          'id',
          'account_number',
          'name',
          'website',
          'contacts.contacts_id.email_address',
          'contacts.contacts_id.phone_numbers.phone_numbers_id.number',
          'contacts.contacts_id.phone_numbers.phone_numbers_id.extension',
          'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.phone_code',
          'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.code',
        ],
        filter: {
          _and: [
            { relationship_type: { _eq: relationshipType } },
            { _or: orConditions },
          ],
        },
        sort: ['name'],
        limit: 25,
        deep: { contacts: { _limit: -1 } },
      })

      if (!filterError && filteredPartners?.length) {
        duplicates = filteredPartners as Record<string, any>[]
      }
    }

    const hasEnteredEmail = form.emailAddress.trim().length > 0

    duplicateList.value = duplicates.map((partner) => {
      const contacts = (partner.contacts || []) as Record<string, any>[]
      const emails: string[] = []
      const phoneRecords: Record<string, any>[] = []

      for (const junction of contacts) {
        const contact = junction.contacts_id as Record<string, any> | null
        if (!contact) { continue }
        if (contact.email_address) { emails.push(contact.email_address) }
        const phoneJunctions = (contact.phone_numbers || []) as Record<string, any>[]
        for (const phoneJunction of phoneJunctions) {
          const phoneRecord = phoneJunction.phone_numbers_id as Record<string, any> | null
          if (phoneRecord?.number) { phoneRecords.push(phoneRecord) }
        }
      }

      // Show the contact email that actually matched (so the table highlights
      // the right row), falling back to the first email otherwise.
      const matchingEmail = hasEnteredEmail
        ? emails.find((email) =>
            getEmailMatchSegments(email, form.emailAddress, genericDomains).some((segment) => segment.match),
          ) || emails[0] || ''
        : emails[0] || ''

      const enteredPhoneNorm = digitsOnly(form.phoneNumber)
      const matchingPhoneRecord = (enteredPhoneNorm.length >= MIN_PHONE_SEARCH_DIGITS
        ? phoneRecords.find((phone) => digitsOnly(phone.number) === enteredPhoneNorm)
        : null) || phoneRecords[0] || null

      return {
        id: partner.id,
        sapId: partner.account_number || '',
        companyName: partner.name || '',
        website: partner.website || '',
        emailAddress: matchingEmail,
        phoneNumber: matchingPhoneRecord?.number || '',
        phoneNumberFormatted: matchingPhoneRecord?.number
          ? formatPhoneNumber(
              {
                number: matchingPhoneRecord.number,
                extension: matchingPhoneRecord.extension,
                countries_id: matchingPhoneRecord.countries_id,
              },
              { includeExtension: false },
            )
          : '',
      }
    })

    rowSelections.value = {}
    return duplicateList.value.length > 0
  }

  return { duplicateList, rowSelections, searchDuplicates }
}
