/**
 * Keeps a business partner's default contact / address pointers populated.
 *
 * A partner should never sit with an empty default while it has exactly one
 * candidate: a lone contact is the default sales AND billing contact, and a lone
 * shipping/billing address is the default for that role.
 *
 * Every pointer goes out in its OWN request. The Directus eligibility flows are
 * `filter` triggers that reject the whole payload, and the contact one gates the
 * *sales* pointer on the junction having received its `sap_id`:
 *
 *   "Default Sales Contact junction N has not received its SAP Contact ID yet."
 *
 * That id is stamped asynchronously by the Service Master sync — roughly ten
 * seconds after the partner is created, and after the partner-level sync-success
 * event. Bundled with the billing pointer it would reject that too; bundled with
 * the address pointers it took those down as well, which is how partners ended
 * up with all four null. Split, each pointer lands as soon as it legally can and
 * the still-blocked sales pointer is simply retried.
 *
 * Only fills EMPTY pointers. A default the user has already chosen is never
 * reassigned, and a role with more than one candidate is left for them to pick.
 */

interface PartnerDefaultIds {
  salesContactJunctionId: number | null
  billingContactJunctionId: number | null
  shippingAddressJunctionId: number | null
  billingAddressJunctionId: number | null
}

interface BackfillOptions {
  /**
   * The partner's current pointers, when the caller already has them (the detail
   * pages load all four with the record). Saves a read, so calling the backfill
   * on every page load costs nothing when the pointers are already complete.
   */
  knownDefaults?: PartnerDefaultIds | null
  /**
   * Extra attempts for pointers still refused after the first pass — for the
   * sales contact, whose `sap_id` lands seconds after the partner's own sync
   * reports success. 0 (the default) means a single pass.
   */
  retries?: number
  /** Spacing between those attempts. */
  retryDelayMs?: number
}

interface BackfillOutcome {
  /** True when at least one pointer was written — the caller should re-read. */
  changed: boolean
}

interface ContactRoles {
  sales: boolean
  billing: boolean
}

interface AssignContactOutcome {
  /** At least one requested pointer was written. */
  applied: boolean
  pendingRoles: ContactRoles
}

interface UsePartnerDefaultsReturn {
  handleBackfillPartnerDefaults: (
    partnerId: number | string | null,
    options?: BackfillOptions,
  ) => Promise<BackfillOutcome>
  handleAssignDefaultContact: (
    partnerId: number | string | null,
    junctionId: number | null,
    roles: ContactRoles,
    options?: { retries?: number, retryDelayMs?: number },
  ) => Promise<AssignContactOutcome>
}

/** Directus returns a pointer as a raw id or an expanded object, depending on depth. */
function getJunctionId(value: unknown): number | null {
  if (typeof value === 'number') { return value }
  if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const nestedId = (value as { id?: unknown }).id
    return typeof nestedId === 'number' ? nestedId : null
  }
  return null
}

export function usePartnerDefaults(): UsePartnerDefaultsReturn {
  const {
    fetchPartnerDefaults,
    fetchPartnerContacts,
    fetchPartnerAddresses,
    updateBusinessPartner,
  } = useBusinessPartners()

  /**
   * The lone active candidate for a role, or null when there is none or a choice
   * to be made. Mirrors the Address drawer's `otherShippingCount === 0` rule:
   * one candidate means it is the default by definition.
   */
  function getSoleCandidateId(
    junctions: Record<string, any>[],
    isEligible: (junction: Record<string, any>) => boolean,
  ): number | null {
    const eligible = junctions.filter(
      junction => String(junction.status ?? '').toLowerCase() === 'active' && isEligible(junction),
    )
    return eligible.length === 1 ? eligible[0].id : null
  }

  async function readDefaults(partnerId: number | string): Promise<PartnerDefaultIds | null> {
    const { data: partnerDefaults, error } = await fetchPartnerDefaults(partnerId)
    if (error || !partnerDefaults) { return null }
    return {
      salesContactJunctionId: getJunctionId(partnerDefaults.default_sales_business_partners_contacts_id),
      billingContactJunctionId: getJunctionId(partnerDefaults.default_billing_business_partners_contacts_id),
      shippingAddressJunctionId: getJunctionId(partnerDefaults.default_shipping_business_partners_addresses_id),
      billingAddressJunctionId: getJunctionId(partnerDefaults.default_billing_business_partners_addresses_id),
    }
  }

  /** One pointer, one request — so a refusal never takes a sibling down with it. */
  async function applyPointer(
    partnerId: number | string,
    field: string,
    junctionId: number,
  ): Promise<boolean> {
    const { error } = await updateBusinessPartner(partnerId, { [field]: junctionId })
    return !error
  }

  /**
   * Fills whatever is still empty. Returns the fields it could not write, so the
   * caller knows whether another attempt is worth making.
   */
  async function runPass(
    partnerId: number | string,
    defaults: PartnerDefaultIds,
  ): Promise<{ changed: boolean, stillMissing: boolean }> {
    let changed = false
    let stillMissing = false

    const needsShippingAddress = defaults.shippingAddressJunctionId === null
    const needsBillingAddress = defaults.billingAddressJunctionId === null
    const needsSalesContact = defaults.salesContactJunctionId === null
    const needsBillingContact = defaults.billingContactJunctionId === null

    if (needsShippingAddress || needsBillingAddress) {
      const { data: partnerAddresses } = await fetchPartnerAddresses(partnerId, { limit: -1 })
      const junctions = partnerAddresses ?? []

      if (needsShippingAddress) {
        const soleShippingId = getSoleCandidateId(junctions, junction => junction.is_shipping_address === true)
        if (soleShippingId) {
          const applied = await applyPointer(partnerId, 'default_shipping_business_partners_addresses_id', soleShippingId)
          applied ? (changed = true) : (stillMissing = true)
        }
      }
      if (needsBillingAddress) {
        const soleBillingId = getSoleCandidateId(junctions, junction => junction.is_billing_address === true)
        if (soleBillingId) {
          const applied = await applyPointer(partnerId, 'default_billing_business_partners_addresses_id', soleBillingId)
          applied ? (changed = true) : (stillMissing = true)
        }
      }
    }

    if (needsSalesContact || needsBillingContact) {
      const { data: partnerContacts } = await fetchPartnerContacts(partnerId, { limit: -1 })
      const soleContactId = getSoleCandidateId(partnerContacts ?? [], () => true)

      if (soleContactId) {
        // Billing first: it has no SAP precondition, so the lone contact is at
        // least the billing default immediately. Sales is refused until the
        // junction's `sap_id` arrives — that refusal is the retry trigger.
        if (needsBillingContact) {
          const applied = await applyPointer(partnerId, 'default_billing_business_partners_contacts_id', soleContactId)
          applied ? (changed = true) : (stillMissing = true)
        }
        if (needsSalesContact) {
          const applied = await applyPointer(partnerId, 'default_sales_business_partners_contacts_id', soleContactId)
          applied ? (changed = true) : (stillMissing = true)
        }
      }
    }

    return { changed, stillMissing }
  }

  async function handleBackfillPartnerDefaults(
    partnerId: number | string | null,
    options: BackfillOptions = {},
  ): Promise<BackfillOutcome> {
    if (partnerId == null) { return { changed: false } }
    const { knownDefaults = null, retries = 0, retryDelayMs = 5000 } = options

    let defaults = knownDefaults ?? await readDefaults(partnerId)
    if (!defaults) { return { changed: false } }

    let changed = false
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const isComplete = defaults.salesContactJunctionId !== null
        && defaults.billingContactJunctionId !== null
        && defaults.shippingAddressJunctionId !== null
        && defaults.billingAddressJunctionId !== null
      if (isComplete) { break }

      const pass = await runPass(partnerId, defaults)
      changed = changed || pass.changed
      if (!pass.stillMissing || attempt === retries) { break }

      // Something was refused — almost always the sales contact waiting on its
      // SAP id. Pause, re-read (the pass may have landed the others), try again.
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
      const refreshed = await readDefaults(partnerId)
      if (!refreshed) { break }
      defaults = refreshed
    }

    return { changed }
  }


  async function handleAssignDefaultContact(
    partnerId: number | string | null,
    junctionId: number | null,
    roles: ContactRoles,
    options: { retries?: number, retryDelayMs?: number } = {},
  ): Promise<AssignContactOutcome> {
    if (partnerId == null || junctionId == null) {
      return { applied: false, pendingRoles: { sales: false, billing: false } }
    }
    const { retries = 0, retryDelayMs = 5000 } = options

    let needsSales = roles.sales
    let needsBilling = roles.billing
    let applied = false

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      // Billing first — ungated, so the new contact is at least the billing
      // default immediately even when sales has to wait.
      if (needsBilling) {
        const ok = await applyPointer(partnerId, 'default_billing_business_partners_contacts_id', junctionId)
        if (ok) { needsBilling = false; applied = true }
      }
      if (needsSales) {
        const ok = await applyPointer(partnerId, 'default_sales_business_partners_contacts_id', junctionId)
        if (ok) { needsSales = false; applied = true }
      }

      if ((!needsSales && !needsBilling) || attempt === retries) { break }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }

    return { applied, pendingRoles: { sales: needsSales, billing: needsBilling } }
  }

  return { handleBackfillPartnerDefaults, handleAssignDefaultContact }
}
