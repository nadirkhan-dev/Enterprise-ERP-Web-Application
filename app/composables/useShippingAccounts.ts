import type { TryCatchResult } from '~/types/api'
import { useDirectus } from '~/composables/useDirectus'
import { useDirectusCrud } from '~/composables/useDirectusCrud'
import { readItem } from '@directus/sdk'

// Shipping group ids are fixed business identifiers in Directus.
export const SHIPPING_GROUP_PARCEL = 1
export const SHIPPING_GROUP_LTL = 2

const _readItem = readItem as any

// Fields read for a single shipping account (via the junction → account).
const ACCOUNT_FIELDS: string[] = [
  'business_partners_shipping_accounts.id',
  'business_partners_shipping_accounts.shipping_accounts_sort',
  'business_partners_shipping_accounts.shipping_accounts_id.id',
  'business_partners_shipping_accounts.shipping_accounts_id.status',
  'business_partners_shipping_accounts.shipping_accounts_id.account_number',
  'business_partners_shipping_accounts.shipping_accounts_id.shipping_carriers_id.id',
  'business_partners_shipping_accounts.shipping_accounts_id.shipping_carriers_id.name',
  'business_partners_shipping_accounts.shipping_accounts_id.shipping_groups_id.id',
  'business_partners_shipping_accounts.shipping_accounts_id.shipping_groups_id.name',
  'business_partners_shipping_accounts.shipping_accounts_id.default_shipping_methods_id.id',
  'business_partners_shipping_accounts.shipping_accounts_id.default_shipping_methods_id.name',
]

const PARTNER_SHIPPING_FIELDS: string[] = [
  'id',
  'default_parcel_business_partners_shipping_accounts_id',
  'default_ltl_business_partners_shipping_accounts_id',
  ...ACCOUNT_FIELDS,
]

export interface ShippingOption {
  id: number
  name: string
}

export interface ShippingMethodOption extends ShippingOption {
  carrierId: number
  groupId: number
}

export interface ShippingAccountView {
  // Junction row id — what the business partner's default pointers reference.
  junctionId: number
  accountId: number
  status: string
  carrierId: number | null
  carrierName: string
  groupId: number | null
  groupName: string
  accountNumber: string
  methodId: number | null
  methodName: string
  sort: number | null
  isDefault: boolean
}

export interface ShippingAccountInput {
  status: string
  carrierId: number
  groupId: number
  accountNumber: string
  methodId: number | null
}

interface FetchAccountsResult {
  accounts: ShippingAccountView[]
  defaultParcelJunctionId: number | null
  defaultLtlJunctionId: number | null
}

interface ShippingOptionsResult {
  carriers: ShippingOption[]
  groups: ShippingOption[]
  methods: ShippingMethodOption[]
}

// Carriers / groups / methods are reference data — stable for a session. Cache
// the resolved options so each account-drawer open doesn't re-fetch all three.
let optionsCache: ShippingOptionsResult | null = null

/**
 * Map a raw `business_partners_shipping_accounts` junction (with its nested
 * account) into the view-model. Exported so the partner detail fetch can map the
 * accounts it already loaded — no separate request.
 */
export function mapShippingAccount(
  junction: any,
  defaultParcelId: number | null,
  defaultLtlId: number | null,
): ShippingAccountView {
  const account = junction.shipping_accounts_id || {}
  const carrier = account.shipping_carriers_id || null
  const group = account.shipping_groups_id || null
  const method = account.default_shipping_methods_id || null
  return {
    junctionId: junction.id,
    accountId: account.id,
    status: account.status || 'active',
    carrierId: carrier?.id ?? null,
    carrierName: carrier?.name || '',
    groupId: group?.id ?? null,
    groupName: group?.name || '',
    accountNumber: account.account_number || '',
    methodId: method?.id ?? null,
    methodName: method?.name || '',
    sort: junction.shipping_accounts_sort ?? null,
    isDefault: junction.id === defaultParcelId || junction.id === defaultLtlId,
  }
}

export function useShippingAccounts() {
  const directus = useDirectus()
  const partnerCrud = useDirectusCrud('business_partners')
  const accountCrud = useDirectusCrud('shipping_accounts')
  const junctionCrud = useDirectusCrud('business_partners_shipping_accounts')
  const carrierCrud = useDirectusCrud('shipping_carriers')
  const groupCrud = useDirectusCrud('shipping_groups')
  const methodCrud = useDirectusCrud('shipping_methods')

  /** Carriers, groups and methods for the form selects (cached per session). */
  async function fetchOptions(): Promise<TryCatchResult<ShippingOptionsResult>> {
    if (optionsCache) {
      return { data: optionsCache, error: null }
    }

    const [carriersResult, groupsResult, methodsResult] = await Promise.all([
      carrierCrud.fetchMany({ fields: ['id', 'name'], sort: ['name'], limit: -1 }),
      groupCrud.fetchMany({ fields: ['id', 'name'], sort: ['id'], limit: -1 }),
      methodCrud.fetchMany({
        fields: ['id', 'name', 'shipping_carriers_id', 'shipping_groups_id'],
        filter: { status: { _eq: 'active' } },
        sort: ['name'],
        limit: -1,
      }),
    ])

    const error = carriersResult.error || groupsResult.error || methodsResult.error
    if (error) {
      return { data: null, error }
    }

    const methods: ShippingMethodOption[] = (methodsResult.data || []).map((method: any) => ({
      id: method.id,
      name: method.name,
      carrierId: method.shipping_carriers_id,
      groupId: method.shipping_groups_id,
    }))

    optionsCache = {
      carriers: (carriersResult.data || []) as ShippingOption[],
      groups: (groupsResult.data || []) as ShippingOption[],
      methods,
    }
    return { data: optionsCache, error: null }
  }

  /** All shipping accounts assigned to a business partner, plus its defaults. */
  async function fetchForPartner(partnerId: number | string): Promise<TryCatchResult<FetchAccountsResult>> {
    const { data: partnerData, error } = await tryCatch(
      directus.request(_readItem('business_partners', partnerId, {
        fields: PARTNER_SHIPPING_FIELDS,
        deep: { business_partners_shipping_accounts: { _sort: ['shipping_accounts_sort'], _limit: -1 } },
      })),
    )
    if (error) {
      return { data: null, error }
    }

    const partner = partnerData as any
    const defaultParcelJunctionId = partner?.default_parcel_business_partners_shipping_accounts_id ?? null
    const defaultLtlJunctionId = partner?.default_ltl_business_partners_shipping_accounts_id ?? null
    const junctions = (partner?.business_partners_shipping_accounts || []) as any[]

    return {
      data: {
        accounts: junctions.map((junction) => mapShippingAccount(junction, defaultParcelJunctionId, defaultLtlJunctionId)),
        defaultParcelJunctionId,
        defaultLtlJunctionId,
      },
      error: null,
    }
  }

  /**
   * Create a shipping account and link it to the partner in one request via a
   * nested M2M create. Returns the new junction row (with its account).
   */
  async function createForPartner(
    partnerId: number | string,
    input: ShippingAccountInput,
    sort: number | null = null,
  ): Promise<TryCatchResult<any>> {
    return await junctionCrud.createOne({
      business_partners_id: partnerId,
      shipping_accounts_sort: sort,
      shipping_accounts_id: {
        status: input.status,
        shipping_carriers_id: input.carrierId,
        shipping_groups_id: input.groupId,
        account_number: input.accountNumber,
        default_shipping_methods_id: input.methodId,
      },
    })
  }

  /** Update an existing shipping account record. */
  async function updateAccount(accountId: number, input: ShippingAccountInput): Promise<TryCatchResult<any>> {
    return await accountCrud.updateOne(accountId, {
      status: input.status,
      shipping_carriers_id: input.carrierId,
      shipping_groups_id: input.groupId,
      account_number: input.accountNumber,
      default_shipping_methods_id: input.methodId,
    })
  }

  /** Unlink (delete junction) then delete the underlying shipping account. */
  async function removeAccount(junctionId: number, accountId: number): Promise<TryCatchResult<void>> {
    const { error: junctionError } = await junctionCrud.removeOne(junctionId)
    if (junctionError) {
      return { data: null, error: junctionError }
    }
    return await accountCrud.removeOne(accountId)
  }

  /** Point the partner's group-appropriate default at a junction row (or clear it). */
  async function setDefault(
    partnerId: number | string,
    groupId: number,
    junctionId: number | null,
  ): Promise<TryCatchResult<any>> {
    const field = groupId === SHIPPING_GROUP_LTL
      ? 'default_ltl_business_partners_shipping_accounts_id'
      : 'default_parcel_business_partners_shipping_accounts_id'
    return await partnerCrud.updateOne(partnerId, { [field]: junctionId })
  }

  return {
    fetchOptions,
    fetchForPartner,
    createForPartner,
    updateAccount,
    removeAccount,
    setDefault,
  }
}
