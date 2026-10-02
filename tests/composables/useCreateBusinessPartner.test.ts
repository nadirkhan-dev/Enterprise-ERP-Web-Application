// @ts-nocheck

import { useCreateBusinessPartner } from '../../app/composables/useCreateBusinessPartner'

describe('Scenario: Initial business-partner account manager', () => {
  const userId = 'sales-user-id'
  const createBusinessPartner = vi.fn()
  const handleBackfillPartnerDefaults = vi.fn()
  const loadAccountManagerCapabilities = vi.fn()
  const getCreateAccountManagerDefault = vi.fn()

  const form = {
    companyName: 'Example Partner',
    partnerGroup: 44,
    website: '',
    isNationalAccount: false,
    firstName: 'Example',
    lastName: 'Person',
    jobTitle: '',
    emailAddress: 'person@example.com',
    country: 1,
    phoneNumber: '(555) 123-4567',
    extension: '',
    phoneType: 'general',
    smsCapable: false,
    logoFileId: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    createBusinessPartner.mockResolvedValue({ data: { id: 123 }, error: null })
    loadAccountManagerCapabilities.mockResolvedValue(undefined)
    getCreateAccountManagerDefault.mockReturnValue('self')
    handleBackfillPartnerDefaults.mockResolvedValue(undefined)

    vi.stubGlobal('digitsOnly', (value: unknown) => String(value ?? '').replace(/\D/g, ''))
    vi.stubGlobal('useBusinessPartners', () => ({ createBusinessPartner }))
    vi.stubGlobal('usePartnerDefaults', () => ({ handleBackfillPartnerDefaults }))
    vi.stubGlobal('useAuthStore', () => ({ user: { id: userId } }))
    vi.stubGlobal('usePermissions', () => ({
      loadAccountManagerCapabilities,
      getCreateAccountManagerDefault,
    }))
  })

  async function createPayload(
    relationshipType: 'customer' | 'supplier',
    businessPartnerGroupSapId?: number,
  ) {
    const { executeCreate } = useCreateBusinessPartner()
    const result = await executeCreate(form, relationshipType, { businessPartnerGroupSapId })

    expect(result.error).toBeNull()
    expect(createBusinessPartner).toHaveBeenCalledOnce()
    return createBusinessPartner.mock.calls[0][0]
  }

  it.each(['Sales', 'Sales Manager'])(
    'leaves a Homeowner unassigned when created by %s',
    async () => {
      const payload = await createPayload('customer', 107)

      expect(payload.account_manager_id).toBeNull()
      expect(payload.business_partner_groups_id).toBe(form.partnerGroup)
    },
  )

  it('keeps self-assignment for an ordinary customer', async () => {
    const payload = await createPayload('customer', 103)

    expect(payload.account_manager_id).toBe(userId)
  })

  it('preserves the existing supplier default', async () => {
    const payload = await createPayload('supplier')

    expect(payload.account_manager_id).toBe(userId)
  })
})
