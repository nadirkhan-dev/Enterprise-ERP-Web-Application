import type { Ref } from 'vue'
import type { ContactForm, PhoneRow } from '~/composables/useContactForm'

type SaveOptions = {
  form: ContactForm
  isEditMode: Ref<boolean>
  contact: Ref<Record<string, any> | null | undefined>
  businessPartnerId: Ref<number | null | undefined>
  defaultSalesContactJunctionId: Ref<number | null | undefined>
  defaultBillingContactJunctionId: Ref<number | null | undefined>
  buildPhonePayload: (phone: PhoneRow) => Record<string, unknown>
  modifiedPhoneIds: Ref<Set<number>>
  newPhones: Ref<PhoneRow[]>
  deletedJunctionIds: Ref<Set<number>>
  getOriginalPhoneData: () => Record<number, { sort: number | null, isDefault: boolean }>
  hasShortPhone: () => boolean
  onClose: () => void
  onSaved: () => void
}

export function useContactSave(options: SaveOptions) {
  const toast = useToast()
  const { updateBusinessPartner, fetchPartnerContacts } = useBusinessPartners()

  function notifyError(message: string) {
    toast.add({ severity: 'error', summary: 'Failed', detail: message, life: 5000 })
  }

  function notifySuccess(detail: string) {
    toast.add({ severity: 'success', summary: 'Success', detail, life: 3000 })
  }

  function buildContactCorePayload() {
    const { form } = options
    return {
      first_name: form.firstName.trim(),
      last_name: form.lastName.trim() || null,
      job_title: form.jobTitle.trim() || null,
      email_address: form.email.trim(),
    }
  }

  function buildJunctionPreferences() {
    const { form } = options
    return {
      status: form.status,
      business_partners_addresses_id: form.address || null,
      allow_transactional_email: form.allowTransactionalEmail,
      allow_marketing_email: form.allowMarketingEmail,
      allow_transactional_sms: form.allowTransactionalSms,
      allow_marketing_sms: form.allowMarketingSms,
      remarks: form.notes || null,
    }
  }

  // Contact mutations are sent as nested create/update/delete on the parent
  // business_partner (not the junction collection directly) so the SAP sync
  // flow — which triggers on business_partners updates — picks them up.

  async function handleCreate() {
    if (options.hasShortPhone()) return

    const phoneCreatePayloads = options.form.phoneNumbers.map((phone, index) => ({
      phone_numbers_sort: index + 1,
      phone_numbers_default: phone.isDefault,
      phone_numbers_id: options.buildPhonePayload(phone),
    }))

    const contactEntry: Record<string, any> = {
      ...buildJunctionPreferences(),
      contacts_id: {
        ...buildContactCorePayload(),
        ...(phoneCreatePayloads.length ? { phone_numbers: { create: phoneCreatePayloads } } : {}),
      },
    }
    if (options.form.status === 'inactive') {
      contactEntry.inactive_note = options.form.inactiveNote.trim()
    }

    const { error } = await updateBusinessPartner(options.businessPartnerId.value!, {
      contacts: { create: [contactEntry] },
    })
    if (error) {
      notifyError(error.message)
      return
    }

    // "Set as primary contact": mirror the create-customer flow — make this new
    // contact the partner's default sales + billing contact. The contact was
    // created nested (so SAP sync fires), so its junction id isn't returned;
    // the just-inserted junction is the one with the highest id. Best-effort —
    // the contact already exists, so a failure here doesn't undo the create.
    if (options.form.isPrimaryContact) {
      const partnerId = options.businessPartnerId.value!
      const { data: partnerContacts } = await fetchPartnerContacts(partnerId, { limit: -1 })
      const newestJunctionId = (partnerContacts ?? []).reduce(
        (maxId, contact) => (contact.id > maxId ? contact.id : maxId),
        0,
      )
      if (newestJunctionId) {
        await updateBusinessPartner(partnerId, {
          default_sales_business_partners_contacts_id: newestJunctionId,
          default_billing_business_partners_contacts_id: newestJunctionId,
        })
      }
    }

    notifySuccess('Contact created successfully')
    options.onSaved()
    options.onClose()
  }

  async function handleEdit() {
    if (options.hasShortPhone()) return

    const sortByPhoneId = new Map<number, number>()
    options.form.phoneNumbers.forEach((phone, index) => sortByPhoneId.set(phone.id, index + 1))

    const phoneRecordIdCounts = new Map<number, number>()
    options.form.phoneNumbers.forEach((phone) => {
      if (phone.isNew || phone.phoneRecordId == null) return
      phoneRecordIdCounts.set(phone.phoneRecordId, (phoneRecordIdCounts.get(phone.phoneRecordId) ?? 0) + 1)
    })
    const isSharedPhoneRecord = (phone: PhoneRow) =>
      !phone.isNew && phone.phoneRecordId != null && (phoneRecordIdCounts.get(phone.phoneRecordId) ?? 0) > 1

    const originalPhoneData = options.getOriginalPhoneData()
    const reorderedIds = options.form.phoneNumbers
      .filter((phone) => !phone.isNew && originalPhoneData[phone.id]?.sort !== sortByPhoneId.get(phone.id))
      .map((phone) => phone.id)
    // A changed default flag must persist even if nothing else about the phone
    // changed (and the just-cleared previous default needs updating too).
    const defaultChangedIds = options.form.phoneNumbers
      .filter((phone) => !phone.isNew && originalPhoneData[phone.id]?.isDefault !== phone.isDefault)
      .map((phone) => phone.id)
    const updateIds = new Set<number>([...options.modifiedPhoneIds.value, ...reorderedIds, ...defaultChangedIds])

    const phoneUpdates: Record<string, any>[] = []
    const sharedRecordDeletes: number[] = []
    const sharedRecordCreates: Record<string, any>[] = []

    for (const phoneId of updateIds) {
      const phone = options.form.phoneNumbers.find((p) => p.id === phoneId)
      if (!phone) continue
      if (options.modifiedPhoneIds.value.has(phoneId) && isSharedPhoneRecord(phone) && phone.junctionId != null) {
        sharedRecordDeletes.push(phone.junctionId)
        sharedRecordCreates.push({
          phone_numbers_sort: sortByPhoneId.get(phone.id) ?? null,
          phone_numbers_default: phone.isDefault,
          phone_numbers_id: options.buildPhonePayload(phone),
        })
        continue
      }
      phoneUpdates.push({
        id: phone.junctionId,
        phone_numbers_sort: sortByPhoneId.get(phone.id) ?? null,
        phone_numbers_default: phone.isDefault,
        phone_numbers_id: { id: phone.phoneRecordId, ...options.buildPhonePayload(phone) },
      })
    }

    const phoneCreates = [
      ...options.newPhones.value.map((phone) => ({
        phone_numbers_sort: sortByPhoneId.get(phone.id) ?? null,
        phone_numbers_default: phone.isDefault,
        phone_numbers_id: options.buildPhonePayload(phone),
      })),
      ...sharedRecordCreates,
    ]

    const phoneNumbersPayload: Record<string, any> = {}
    if (phoneUpdates.length) phoneNumbersPayload.update = phoneUpdates
    if (phoneCreates.length) phoneNumbersPayload.create = phoneCreates
    const deletedJunctions = [...options.deletedJunctionIds.value, ...sharedRecordDeletes]
    if (deletedJunctions.length) phoneNumbersPayload.delete = deletedJunctions

    const contactEntry: Record<string, any> = {
      id: options.contact.value!.id,
      ...buildJunctionPreferences(),
      contacts_id: {
        id: options.contact.value!.contactId,
        ...buildContactCorePayload(),
        ...(Object.keys(phoneNumbersPayload).length ? { phone_numbers: phoneNumbersPayload } : {}),
      },
    }
    contactEntry.inactive_note = options.form.status === 'inactive' ? options.form.inactiveNote.trim() : null

    const { error } = await updateBusinessPartner(options.businessPartnerId.value!, {
      contacts: { update: [contactEntry] },
    })
    if (error) {
      notifyError(error.message)
      return
    }
    const thisJunctionId = options.contact.value!.id
    const wasSalesDefault = options.defaultSalesContactJunctionId.value === thisJunctionId
    const wasBillingDefault = options.defaultBillingContactJunctionId.value === thisJunctionId
    const defaultsPayload: Record<string, unknown> = {}
    if (options.form.isPrimaryContact) {
      if (!wasSalesDefault) defaultsPayload.default_sales_business_partners_contacts_id = thisJunctionId
      if (!wasBillingDefault) defaultsPayload.default_billing_business_partners_contacts_id = thisJunctionId
    } else {
      if (wasSalesDefault) defaultsPayload.default_sales_business_partners_contacts_id = null
      if (wasBillingDefault) defaultsPayload.default_billing_business_partners_contacts_id = null
    }
    if (Object.keys(defaultsPayload).length) {
      await updateBusinessPartner(options.businessPartnerId.value!, defaultsPayload)
    }

    notifySuccess('Contact updated successfully')
    options.onSaved()
    options.onClose()
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to remove this contact?')) return false
    const { error } = await updateBusinessPartner(options.businessPartnerId.value!, {
      contacts: { delete: [options.contact.value!.id] },
    })
    if (error) {
      notifyError(error.message)
      return false
    }
    notifySuccess('Contact removed successfully')
    options.onSaved()
    options.onClose()
    return true
  }

  return {
    handleCreate,
    handleEdit,
    handleDelete,
  }
}
