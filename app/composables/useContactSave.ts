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
  getOriginalPhoneData: () => Record<number, { sort: number | null }>
  hasShortPhone: () => boolean
  // Change detectors for the granular (direct-write) save path. Contact core → the watched
  // contacts collection; junction preferences + primary flag → the business_partners_contacts
  // junction, which the sync flow does NOT watch, so any pref change forces the full nested
  // write. Both absent → false-safe (the nested write is always used).
  hasContactCoreChanged?: () => boolean
  hasJunctionPrefsChanged?: () => boolean
  onClose: () => void
  onSaved: () => void
}

export function useContactSave(options: SaveOptions) {
  const toast = useToast()
  const { updateBusinessPartner, fetchPartnerContacts } = useBusinessPartners()
  const { updatePhoneNumber } = usePhoneNumbers()
  const { fetchContact, updateContact } = useContacts()
  const { handleAssignDefaultContact } = usePartnerDefaults()
  // Junction field grants — status and inactive_note are independent, and an
  // update payload must omit any the caller cannot write: Directus rejects an
  // unwritable key even when its value is unchanged. Creates are untouched
  // (they run under create grants, which these update rights don't describe).
  const { loadStatusFieldRights, getStatusFieldRights } = usePermissions()
  loadStatusFieldRights()

  /**
   * Directus keeps the real reason in `errors[0]` and leaves a generic string on
   * the thrown error itself — so a permission gap or a constraint violation both
   * surfaced as "An unexpected error occurred." Unwrap it, or the toast names
   * nothing the user or we can act on.
   */
  function notifyError(error: unknown) {
    toast.add({
      severity: 'error',
      summary: 'Failed',
      detail: getDirectusErrorMessage(error, 'The contact could not be saved.'),
      life: 5000,
    })
  }

  function notifySuccess(detail: string) {
    toast.add({ severity: 'success', summary: 'Success', detail, life: 3000 })
  }
  async function retryPrimaryContactAssignment(
    partnerId: number,
    junctionId: number,
    roles: { sales: boolean, billing: boolean },
  ) {
    const { applied } = await handleAssignDefaultContact(
      partnerId,
      junctionId,
      roles,
      { retries: 3, retryDelayMs: 5000 },
    )
    if (applied) {
      options.onSaved()
    }
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

  // The contact's default phone is a parent pointer —
  // contacts.default_contacts_phone_numbers_id → its default contacts_phone_numbers
  // junction row (one default per contact). Junction ids for phones created through
  // the nested write aren't returned by Directus, so a just-created default phone is
  // matched back to its saved junction row by its digits — in-form de-duplication
  // guarantees they're unique per contact.
  function findPhoneJunctionIdByDigits(
    phoneJunctions: Record<string, any>[] | null | undefined,
    targetDigits: string,
  ): number | null {
    if (!targetDigits) return null
    const junction = (phoneJunctions ?? []).find(
      (row) => digitsOnly(row?.phone_numbers_id?.number) === targetDigits,
    )
    return junction?.id ?? null
  }

  // Contact mutations are sent as nested create/update/delete on the parent
  // business_partner (not the junction collection directly) so the SAP sync
  // flow — which triggers on business_partners updates — picks them up.

  async function handleCreate() {
    if (options.hasShortPhone()) return

    const phoneCreatePayloads = options.form.phoneNumbers.map((phone, index) => ({
      phone_numbers_sort: index + 1,
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
      notifyError(error)
      return
    }

    // Post-create pointer assignments. The contact was created nested (so SAP
    // sync fires), so neither its junction id nor its phone junction ids are
    // returned; the just-inserted junction is the one with the highest id.
    // Best-effort — the contact already exists, so a failure here doesn't undo
    // the create.
    const defaultPhone = options.form.phoneNumbers.find((phone) => phone.isDefault) ?? null
    if (options.form.isPrimaryContact || defaultPhone) {
      const partnerId = options.businessPartnerId.value!
      const { data: partnerContacts } = await fetchPartnerContacts(partnerId, { limit: -1 })
      const newestJunction = (partnerContacts ?? []).reduce(
        (newest: Record<string, any> | null, junction: Record<string, any>) =>
          (!newest || junction.id > newest.id ? junction : newest),
        null,
      )
      // Point the new contact at its default phone's junction row — the phones
      // were saved with the nested create above, so the row now exists.
      if (defaultPhone && newestJunction?.contacts_id?.id) {
        const defaultPhoneJunctionId = findPhoneJunctionIdByDigits(
          newestJunction.contacts_id.phone_numbers,
          digitsOnly(defaultPhone.rawNumber),
        )
        if (defaultPhoneJunctionId) {
          await updateContact(newestJunction.contacts_id.id, {
            default_contacts_phone_numbers_id: defaultPhoneJunctionId,
          })
        }
      }
      // "Set as primary contact": mirror the create-customer flow — make this
      // new contact the partner's default sales + billing contact.
      if (options.form.isPrimaryContact && newestJunction) {
        const { pendingRoles } = await handleAssignDefaultContact(
          partnerId,
          newestJunction.id,
          { sales: true, billing: true },
        )
        if (pendingRoles.sales || pendingRoles.billing) {
          retryPrimaryContactAssignment(partnerId, newestJunction.id, pendingRoles)
        }
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
    const updateIds = new Set<number>([...options.modifiedPhoneIds.value, ...reorderedIds])

    // The default phone lives on the contact record as a pointer to its junction
    // row (default_contacts_phone_numbers_id) — never in the junction payloads
    // below. A default change is therefore a contacts-collection write.
    const currentDefaultJunctionId = options.contact.value?.defaultPhoneJunctionId ?? null
    const defaultPhone = options.form.phoneNumbers.find((phone) => phone.isDefault) ?? null

    // Granular direct-write fast path. When an edit touches ONLY collections the sync flow
    // watches directly — the contact record (contacts) and/or phone values (phone_numbers) —
    // write each changed collection on its own, instead of re-writing the whole contact through
    // the parent business partner (which touches BP + junction + contact + phone rows and fans
    // out to several sync runs). Each direct write fires one event on its own collection, so a
    // name-only or phone-only edit produces a single sync run.
    //
    // It is used ONLY when the change is fully expressible this way: no junction-preference /
    // primary-flag change (the junction isn't watched, so those must go through the parent), and
    // no structural phone change — add / remove / reorder / shared-record split (those manipulate
    // the phone RELATION on the contact). A default toggle qualifies: the pointer is a contacts
    // field, so it rides the same direct contacts write. Anything else falls through to the
    // full nested write below (unchanged behavior), so a change can never be dropped.
    //
    // Real reorder detection: did the user actually change the phone ORDER, versus the stored
    // sort values simply not being dense 1-based (which `reorderedIds` above wrongly treats as a
    // reorder). Compare the loaded order (ids by original sort) to the current order.
    const originalPhoneOrder = Object.keys(originalPhoneData)
      .map(Number)
      .sort((a, b) => (originalPhoneData[a]?.sort ?? 0) - (originalPhoneData[b]?.sort ?? 0))
    const currentPhoneOrder = options.form.phoneNumbers.filter((p) => !p.isNew).map((p) => p.id)
    const userReorderedPhones
      = currentPhoneOrder.length !== originalPhoneOrder.length
      || currentPhoneOrder.some((id, index) => id !== originalPhoneOrder[index])

    const modifiedPhoneIdList = [...options.modifiedPhoneIds.value]
    const coreChanged = options.hasContactCoreChanged?.() ?? true
    const prefsChanged = options.hasJunctionPrefsChanged?.() ?? true
    const noStructuralPhoneChange
      = options.newPhones.value.length === 0
      && options.deletedJunctionIds.value.size === 0
      && !userReorderedPhones
    // With no adds or deletes pending, the flagged default (if any) is an
    // existing row whose junction id is already known.
    const directDefaultJunctionId = defaultPhone?.junctionId ?? null
    const defaultPointerChanged = directDefaultJunctionId !== currentDefaultJunctionId
    const phonesDirectlyWritable = modifiedPhoneIdList.every((phoneId) => {
      const phone = options.form.phoneNumbers.find((p) => p.id === phoneId)
      return phone != null && phone.phoneRecordId != null && !isSharedPhoneRecord(phone)
    })
    const canDirectWrite
      = !prefsChanged
      && noStructuralPhoneChange
      && phonesDirectlyWritable
      && (coreChanged || modifiedPhoneIdList.length > 0 || defaultPointerChanged)

    if (canDirectWrite) {
      if (coreChanged || defaultPointerChanged) {
        const contactPayload: Record<string, unknown> = coreChanged ? buildContactCorePayload() : {}
        if (defaultPointerChanged) {
          contactPayload.default_contacts_phone_numbers_id = directDefaultJunctionId
        }
        const { error } = await updateContact(options.contact.value!.contactId, contactPayload)
        if (error) {
          notifyError(error)
          return
        }
      }
      for (const phoneId of modifiedPhoneIdList) {
        const phone = options.form.phoneNumbers.find((p) => p.id === phoneId)!
        const { error } = await updatePhoneNumber(phone.phoneRecordId!, options.buildPhonePayload(phone))
        if (error) {
          notifyError(error)
          return
        }
      }
      notifySuccess('Contact updated successfully')
      options.onSaved()
      options.onClose()
      return
    }

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
          phone_numbers_id: options.buildPhonePayload(phone),
        })
        continue
      }
      phoneUpdates.push({
        id: phone.junctionId,
        phone_numbers_sort: sortByPhoneId.get(phone.id) ?? null,
        phone_numbers_id: { id: phone.phoneRecordId, ...options.buildPhonePayload(phone) },
      })
    }

    const phoneCreates = [
      ...options.newPhones.value.map((phone) => ({
        phone_numbers_sort: sortByPhoneId.get(phone.id) ?? null,
        phone_numbers_id: options.buildPhonePayload(phone),
      })),
      ...sharedRecordCreates,
    ]

    const phoneNumbersPayload: Record<string, any> = {}
    if (phoneUpdates.length) phoneNumbersPayload.update = phoneUpdates
    if (phoneCreates.length) phoneNumbersPayload.create = phoneCreates
    const deletedJunctions = [...options.deletedJunctionIds.value, ...sharedRecordDeletes]
    if (deletedJunctions.length) phoneNumbersPayload.delete = deletedJunctions

    // The junction id of a NEW default phone — or one a shared-record split is
    // about to delete + recreate — doesn't exist yet, so its pointer value can
    // only be resolved AFTER the nested save; an existing one is known now.
    const isDefaultPhonePendingCreate = defaultPhone != null
      && (defaultPhone.junctionId == null || sharedRecordDeletes.includes(defaultPhone.junctionId))
    let pointerJunctionId = currentDefaultJunctionId

    // The pointer's DB constraint (NO ACTION / prevent deletion) rejects deleting
    // a junction row it still references, so clear — or replace, when the new
    // default's junction already exists — BEFORE the nested write deletes it.
    if (currentDefaultJunctionId != null && deletedJunctions.includes(currentDefaultJunctionId)) {
      const replacementJunctionId = isDefaultPhonePendingCreate ? null : (defaultPhone?.junctionId ?? null)
      const { error: pointerError } = await updateContact(options.contact.value!.contactId, {
        default_contacts_phone_numbers_id: replacementJunctionId,
      })
      if (pointerError) {
        notifyError(pointerError)
        return
      }
      pointerJunctionId = replacementJunctionId
    }

    const contactEntry: Record<string, any> = {
      id: options.contact.value!.id,
      ...buildJunctionPreferences(),
      contacts_id: {
        id: options.contact.value!.contactId,
        ...buildContactCorePayload(),
        ...(Object.keys(phoneNumbersPayload).length ? { phone_numbers: phoneNumbersPayload } : {}),
      },
    }
    const junctionRights = getStatusFieldRights('business_partners_contacts')
    if (!junctionRights.status) {
      delete contactEntry.status
    }
    if (junctionRights.inactiveNote) {
      contactEntry.inactive_note = options.form.status === 'inactive' ? options.form.inactiveNote.trim() : null
    }

    const { error } = await updateBusinessPartner(options.businessPartnerId.value!, {
      contacts: { update: [contactEntry] },
    })
    if (error) {
      notifyError(error)
      return
    }

    // Phone junctions are saved — assign the default-phone pointer. A pending
    // (just-created) default junction is matched back by its digits from the
    // saved contact record; a known one writes directly. Skipped when the
    // pointer already holds the right row.
    let desiredDefaultJunctionId = isDefaultPhonePendingCreate ? null : (defaultPhone?.junctionId ?? null)
    if (isDefaultPhonePendingCreate) {
      const { data: savedContact } = await fetchContact(options.contact.value!.contactId)
      desiredDefaultJunctionId = findPhoneJunctionIdByDigits(
        (savedContact as Record<string, any> | null)?.phone_numbers,
        digitsOnly(defaultPhone!.rawNumber),
      )
    }
    if (desiredDefaultJunctionId !== pointerJunctionId) {
      const { error: pointerError } = await updateContact(options.contact.value!.contactId, {
        default_contacts_phone_numbers_id: desiredDefaultJunctionId,
      })
      if (pointerError) {
        notifyError(pointerError)
        return
      }
    }

    const partnerId = options.businessPartnerId.value!
    const thisJunctionId = options.contact.value!.id
    const wasSalesDefault = options.defaultSalesContactJunctionId.value === thisJunctionId
    const wasBillingDefault = options.defaultBillingContactJunctionId.value === thisJunctionId

    if (options.form.isPrimaryContact) {
      const { pendingRoles } = await handleAssignDefaultContact(
        partnerId,
        thisJunctionId,
        { sales: !wasSalesDefault, billing: !wasBillingDefault },
      )
      if (pendingRoles.sales || pendingRoles.billing) {
        retryPrimaryContactAssignment(partnerId, thisJunctionId, pendingRoles)
      }
    } else {
      // Clearing has no SAP precondition, so both nulls travel together safely.
      const defaultsPayload: Record<string, unknown> = {}
      if (wasSalesDefault) defaultsPayload.default_sales_business_partners_contacts_id = null
      if (wasBillingDefault) defaultsPayload.default_billing_business_partners_contacts_id = null
      if (Object.keys(defaultsPayload).length) {
        await updateBusinessPartner(partnerId, defaultsPayload)
      }
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
      notifyError(error)
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
