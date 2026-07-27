interface CreateResult {
  data: { partner: any } | null
  error: Error | null
}

interface CreateOptions {
  /**
   * Nested `addresses.create` junctions (shipping/billing). Optional — a partner
   * can be created with no address. Each junction is `{ is_shipping_address,
   * is_billing_address, addresses_id: { …address fields } }`.
   */
  addresses?: Record<string, any>[]
}

interface UseCreateBusinessPartnerReturn {
  executeCreate: (
    formData: Record<string, any>,
    relationshipType?: string,
    options?: CreateOptions,
  ) => Promise<CreateResult>
}

/**
 * Orchestration composable for creating a business partner with an initial contact.
 *
 * Creates the partner and its first partner-contact junction (with nested
 * contact + phone number) in a single atomic request. Sending both in one
 * payload means downstream Directus flows fire with the contact present, so
 * the partner and its first contact sync to SAP together.
 *
 * Reusable for both Customer and Supplier create pages.
 */
export function useCreateBusinessPartner(): UseCreateBusinessPartnerReturn {
  const { createBusinessPartner, fetchPartnerContacts, fetchPartnerAddresses, updateBusinessPartner } = useBusinessPartners()
  const authStore = useAuthStore()
  const { loadAccountManagerCapabilities, getCreateAccountManagerDefault } = usePermissions()

  async function executeCreate(
    formData: Record<string, any>,
    relationshipType: string = 'customer',
    options: CreateOptions = {},
  ): Promise<CreateResult> {
    // Omit extension when empty — Directus regex validation rejects null.
    // Payload is digits-only (no "+", spaces, parens, or country code).
    const phonePayload: Record<string, unknown> = {
      number: digitsOnly(formData.phoneNumber),
      type: formData.phoneType,
      sms_capable: formData.smsCapable,
      countries_id: formData.country,
    }
    const cleanedExtension = digitsOnly(formData.extension)
    if (cleanedExtension) {
      phonePayload.extension = cleanedExtension
    }

    // The partner-contact junction is nested under the M2M `contacts` field so
    // the whole graph is created in one request to /items/business_partners.
    // The `{ create: [...] }` shape (rather than a bare array) is required: the
    // SAP sync flow's reshape handler reads `contacts.create` to build the
    // ContactEmployees payload, and a bare array would sync as empty.
    // Addresses (when provided) are nested in the same create so the SAP sync
    // flow — which triggers on business_partners create — fires with them
    // present, mirroring how the initial contact is nested below.
    const addressPayloads = options.addresses ?? []

    // Directus keeps no server-side preset for account_manager_id, and each tier
    // is capped differently (Operations must send null; the Sales tiers own the
    // customer they create), so the default is resolved from the caller's create
    // field-permissions rather than hard-coded to the creator — which would 403
    // an Operations customer-create. 'self' pre-fills the creator; 'null' leaves
    // it empty. Falls back to null (accepted by every tier) until resolved.
    await loadAccountManagerCapabilities()
    const accountManagerId
      = getCreateAccountManagerDefault(relationshipType as 'customer' | 'supplier') === 'self'
        ? authStore.user?.id || null
        : null

    const { data: partner, error } = await createBusinessPartner({
      name: formData.companyName.toUpperCase(),
      relationship_type: relationshipType,
      status: 'active',
      account_manager_id: accountManagerId,
      business_partner_groups_id: formData.partnerGroup,
      website: formData.website || null,
      is_national_account: formData.isNationalAccount ?? false,
      logo_id: formData.logoFileId || null,
      ...(addressPayloads.length ? { addresses: { create: addressPayloads } } : {}),
      contacts: {
        create: [
          {
            status: 'active',
            contacts_id: {
              first_name: formData.firstName,
              last_name: formData.lastName || null,
              job_title: formData.jobTitle || null,
              email_address: formData.emailAddress || null,
              phone_numbers: {
                create: [{
                  phone_numbers_id: phonePayload,
                }],
              },
            },
          },
        ],
      },
    })

    if (error) {
      return { data: null, error }
    }
    // Resolve the freshly-created junctions into their default pointers in one
    // follow-up update: the lone contact is always the default sales + billing
    // contact, and the created address(es) become the default shipping/billing
    // address (a lone address is its own default, mirroring the Address drawer).
    if (partner?.id) {
      const defaultsPayload: Record<string, unknown> = {}

      const { data: partnerContacts } = await fetchPartnerContacts(partner.id, { limit: 1 })
      const contactJunctionId = partnerContacts?.[0]?.id ?? null
      if (contactJunctionId) {
        defaultsPayload.default_sales_business_partners_contacts_id = contactJunctionId
        defaultsPayload.default_billing_business_partners_contacts_id = contactJunctionId
      }

      if (addressPayloads.length) {
        const { data: partnerAddresses } = await fetchPartnerAddresses(partner.id, { limit: -1 })
        const junctions = partnerAddresses ?? []
        const shippingJunction = junctions.find((junction: any) => junction.is_shipping_address)
        const billingJunction = junctions.find((junction: any) => junction.is_billing_address)
        if (shippingJunction) {
          defaultsPayload.default_shipping_business_partners_addresses_id = shippingJunction.id
        }
        if (billingJunction) {
          defaultsPayload.default_billing_business_partners_addresses_id = billingJunction.id
        }
      }

      if (Object.keys(defaultsPayload).length) {
        await updateBusinessPartner(partner.id, defaultsPayload)
      }
    }

    return { data: { partner }, error: null }
  }

  return { executeCreate }
}
