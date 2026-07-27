/**
 * Render a region as "Name (CODE)" — e.g. "New Jersey (NJ)". Customers
 * often reference states by the 2-letter code, so showing both makes
 * the displayed value match either lookup style.
 */
export function formatRegionLabel(region: { name?: string | null, code?: string | null } | null | undefined): string {
  const name = region?.name?.trim() ?? ''
  const code = region?.code?.trim() ?? ''
  if (name && code) {return `${name} (${code})`}
  return name || code
}

/**
 * Render a mapped address as a single-line label — "STREET, CITY, STATE" —
 * for default-address Selects and read-only panel display. Accepts the
 * table-friendly shape produced by `mapCustomerAddresses`. Empty parts are
 * dropped; an em dash is returned when there's nothing to show.
 */
export function formatAddressLabel(address: Record<string, any> | null | undefined): string {
  if (!address) { return '—' }
  const parts = [address.street, address.city, address.state].filter(Boolean)
  return parts.join(', ') || '—'
}

/**
 * Format an ISO timestamp as a short US-locale date (e.g. 5/19/2026).
 */
function formatActivityDate(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return ''
  }
  const parsed = new Date(isoTimestamp)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleDateString('en-US')
}

/**
 * Map raw Directus activity records to the table/drawer-friendly shape.
 * `activityGroupId` / `contactJunctionId` carry the raw IDs the edit drawer
 * needs to pre-fill its Select inputs. `followUpId` / `followupDate` /
 * `assignedUserId` come from the linked `follow_ups` record (if any) — either
 * the one that generated this activity (`source_follow_ups_id`) or one created
 * from it (`sourced_follow_up`). The drawer edits these and writes them back.
 */
export function mapCustomerActivities(rawActivities: Record<string, any>[] | null) {
  if (!rawActivities?.length) {
    return []
  }
  return rawActivities.map((activity) => {
    const creator = activity.user_created || {}
    const activityGroup = activity.activity_groups_id || {}
    const contactJunction = activity.business_partners_contacts_id || null
    const contactRecord = contactJunction?.contacts_id || {}
    const followUp = activity.source_follow_ups_id || activity.sourced_follow_up || null
    const assignedUser = followUp?.assigned_user_id || null

    return {
      id: activity.id,
      created_on: formatActivityDate(activity.date_created),
      dateCreated: activity.date_created || null,
      created_by: `${creator.first_name || ''} ${creator.last_name || ''}`.trim(),
      contact: `${contactRecord.first_name || ''} ${contactRecord.last_name || ''}`.trim(),
      action: activityGroup.name || '',
      subject: activity.subject || '',
      notes: activity.remarks || '',
      activityGroupId: activityGroup.id || null,
      contactJunctionId: contactJunction?.id || null,
      followUpId: followUp?.id || null,
      followupDate: followUp?.due_date || null,
      assignedUserId: assignedUser?.id || null,
      assignedUserName: `${assignedUser?.first_name || ''} ${assignedUser?.last_name || ''}`.trim(),
    }
  })
}

/**
 * Map raw Directus phone-number junction rows (from either
 * `business_partners_phone_numbers` or a contact's `phone_numbers`) to the
 * phone-editor shape. Both junctions share the same `phone_numbers_id` /
 * `phone_numbers_sort` fields, so a single mapper serves both.
 */
export function mapPhoneNumbers(rawPhoneJunctions: Record<string, any>[] | null | undefined) {
  return (rawPhoneJunctions || []).map((phoneJunction) => {
    const phoneRecord = phoneJunction.phone_numbers_id || {}
    return {
      junctionId: phoneJunction.id,
      id: phoneJunction.id,
      phoneRecordId: phoneRecord.id,
      type: phoneRecord.type || 'general',
      number: formatPhoneNumber(phoneRecord),
      rawNumber: phoneRecord.number || '',
      extension: phoneRecord.extension || '',
      smsCapable: phoneRecord.sms_capable || false,
      countryId: phoneRecord.countries_id?.id || null,
      sort: phoneJunction.phone_numbers_sort ?? null,
      // Default is tracked independently of sort order (contact phones only;
      // partner-phone junctions have no such field, so this is simply false).
      isDefault: phoneJunction.phone_numbers_default ?? false,
    }
  })
}

/**
 * Map raw Directus junction contacts to the table-friendly shape.
 */
export function mapCustomerContacts(rawContacts: Record<string, any>[] | null) {
  if (!rawContacts?.length) {
    return []
  }
  return rawContacts.map((junction) => {
    const contactRecord = junction.contacts_id || {}
    const phoneNumbers = mapPhoneNumbers(contactRecord.phone_numbers)

    return {
      id: junction.id,
      contactId: contactRecord.id,
      sortOrder: junction.contacts_sort ?? null,
      name: `${contactRecord.first_name || ''} ${contactRecord.last_name || ''}`.trim(),
      firstName: contactRecord.first_name || '',
      lastName: contactRecord.last_name || '',
      jobTitle: contactRecord.job_title || '',
      email: contactRecord.email_address || '',
      phone: formatPhoneNumber(getPrimaryPhone(contactRecord)),
      status: junction.status || 'active',
      notes: junction.remarks || '',
      addressJunctionId: junction.business_partners_addresses_id || null,
      allowTransactionalEmail: junction.allow_transactional_email ?? true,
      allowMarketingEmail: junction.allow_marketing_email ?? false,
      allowTransactionalSms: junction.allow_transactional_sms ?? true,
      allowMarketingSms: junction.allow_marketing_sms ?? false,
      inactiveNote: junction.inactive_note || '',
      phoneNumbers,
    }
  })
}

interface MapCustomerAddressesOptions {
  defaultBillingJunctionId?: number | string | null
  defaultShippingJunctionId?: number | string | null
}

/**
 * Map raw Directus junction addresses to the table-friendly shape.
 */
export function mapCustomerAddresses(
  rawAddresses: Record<string, any>[] | null,
  options: MapCustomerAddressesOptions = {},
) {
  if (!rawAddresses?.length) {
    return []
  }
  const { defaultBillingJunctionId = null, defaultShippingJunctionId = null } = options
  return rawAddresses.map((junction) => {
    const addressRecord = junction.addresses_id || {}
    const isBilling = junction.is_billing_address || false
    const isShipping = junction.is_shipping_address || false
    const isDefaultBilling = defaultBillingJunctionId === junction.id
    const isDefaultShipping = defaultShippingJunctionId === junction.id

    return {
      id: junction.id,
      addressId: addressRecord.id,
      sortOrder: junction.addresses_sort ?? null,
      status: junction.status || 'active',
      inactiveNote: junction.inactive_note || '',
      street: addressRecord.street_line_1 || '',
      unitSuite: addressRecord.street_line_2 || '',
      city: addressRecord.city || '',
      state: formatRegionLabel(addressRecord.regions_id),
      postalCode: addressRecord.postal_code || '',
      country: addressRecord.countries_id?.code || '',
      countryId: addressRecord.countries_id?.id || null,
      countryName: addressRecord.countries_id?.name || '',
      regionId: addressRecord.regions_id?.id || null,
      regionName: addressRecord.regions_id?.name || '',
      isBilling,
      isShipping,
      type: isBilling && isShipping ? 'Billing / Shipping' : isShipping ? 'Shipping' : isBilling ? 'Billing' : 'Other',
      tags: junction.tags || [],
      tagsDisplay: Array.isArray(junction.tags) ? junction.tags.join(', ') : '',
      remarks: junction.remarks || '',
      latitude: addressRecord.latitude ?? null,
      longitude: addressRecord.longitude ?? null,
      isDefaultBilling,
      isDefaultShipping,
      isDefaultAny: isDefaultBilling || isDefaultShipping,
    }
  })
}
