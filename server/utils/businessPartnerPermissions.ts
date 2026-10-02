/**
 * "May this person create a supplier? A customer?"
 *
 * Both are the same collection — `business_partners` — told apart only by
 * `relationship_type`. Directus draws the line between them with a *validation*
 * rule on the create permission: the CONNECT Internal Sales policy, for one, may
 * create business partners only where `relationship_type = customer`.
 *
 * The browser cannot answer this on its own. `/permissions/me` reports a grant as
 * `{ access, fields, presets }` and omits `validation` entirely, so a
 * customer-only create looks identical to an unrestricted one — which is why the
 * Suppliers list used to hand Employee Basic users a create form that Directus
 * then rejected on save. Reading the rules directly needs `directus_permissions`,
 * which app users have no grant on. So the question is answered here, with the
 * service token, and the browser is told only yes or no.
 */

import type { AuthenticatedUser } from './auth'

export type RelationshipType = 'customer' | 'supplier'

export type BusinessPartnerCreateRights = Record<RelationshipType, boolean>

/** A Directus filter tree — `{ _and: [...] }`, `{ field: { _eq: 'x' } }`, etc. */
type Filter = Record<string, unknown>

interface Policy {
  id: string
  name: string
  admin_access: boolean
}

const COLLECTION = 'business_partners'

export class PermissionLookupError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 502) {
    super(message)
    this.name = 'PermissionLookupError'
    this.statusCode = statusCode
  }
}

async function fetchAsService<T>(path: string, params: Record<string, string>): Promise<T> {
  const runtime = useRuntimeConfig()
  const url = String(runtime.directusUrl || '').replace(/\/$/, '')
  const serviceToken = String(runtime.directusToken || '')
  if (!url || !serviceToken) {
    throw new PermissionLookupError('Directus is not configured (DIRECTUS_URL / NUXT_DIRECTUS_TOKEN missing).', 500)
  }

  let response: Response
  try {
    response = await fetch(`${url}${path}?${new URLSearchParams(params)}`, {
      headers: { Authorization: `Bearer ${serviceToken}` },
    })
  } catch (error) {
    throw new PermissionLookupError(`Permission lookup network error: ${(error as Error).message}`)
  }

  if (!response.ok) {
    throw new PermissionLookupError(`Permission lookup failed (${response.status})`)
  }

  const payload = await response.json() as { data?: T }
  if (payload.data === undefined) {
    throw new PermissionLookupError('Permission lookup returned no data.')
  }
  return payload.data
}

/**
 * The user's role and every role above it.
 *
 * Directus roles nest, and a nested role inherits its parents' policies — so
 * stopping at the role on the user record would miss grants they really hold.
 * The `seen` guard is for a mis-configured parent cycle, which would otherwise
 * spin forever.
 */
async function fetchRoleChain(roleId: string | null): Promise<string[]> {
  const chain: string[] = []
  let current = roleId

  while (current && !chain.includes(current)) {
    chain.push(current)
    const role = await fetchAsService<{ parent: string | null }>(`/roles/${current}`, { fields: 'parent' })
    current = role?.parent ?? null
  }

  return chain
}

/**
 * Every policy attached to the user — directly, through their role, and through
 * that role's parents. This is the "all the policies they are part of" set that
 * Directus itself unions when it authorizes a request.
 */
async function fetchPolicies(user: AuthenticatedUser): Promise<Policy[]> {
  const roleIds = await fetchRoleChain(user.role)

  const attachedToUserOrRole: Filter[] = [{ user: { _eq: user.id } }]
  if (roleIds.length) {
    attachedToUserOrRole.push({ role: { _in: roleIds } })
  }

  const access = await fetchAsService<Array<{ policy: Policy | null }>>('/access', {
    limit: '-1',
    fields: 'policy.id,policy.name,policy.admin_access',
    filter: JSON.stringify({ _or: attachedToUserOrRole }),
  })

  return access.map(row => row.policy).filter((policy): policy is Policy => Boolean(policy))
}

/**
 * Whether `condition` — the operators under `relationship_type` — admits `type`.
 *
 * An operator we cannot read counts as a rejection. Of the two ways to be wrong,
 * withholding a create form from someone entitled to it costs them a click
 * (they get the request form instead); offering one Directus will refuse costs
 * them a filled-in form and a dead end.
 */
function matchesRelationshipType(condition: Filter, type: RelationshipType): boolean {
  return Object.entries(condition).every(([operator, operand]) => {
    switch (operator) {
      case '_eq': return operand === type
      case '_neq': return operand !== type
      case '_in': return Array.isArray(operand) && operand.includes(type)
      case '_nin': return Array.isArray(operand) && !operand.includes(type)
      // A concrete relationship_type is neither null nor empty, so "must be
      // null/empty" rules exclude it and "must not be" rules pass it.
      case '_null': case '_empty': return operand === false
      case '_nnull': case '_nempty': return operand === true
      default: return false
    }
  })
}

/**
 * Whether a create permission's `validation` still admits a record whose
 * `relationship_type` is `type`.
 *
 * Only that one field is being asked about, so conditions on *other* fields count
 * as satisfiable — the create form fills those in, and none of them is what
 * separates a supplier from a customer. A rule of `{ name: { _nnull: true } }`
 * must not read as "cannot create suppliers".
 */
function isRelationshipTypeAllowed(validation: Filter | null, type: RelationshipType): boolean {
  if (!validation || !Object.keys(validation).length) {
    return true
  }

  return Object.entries(validation).every(([key, value]) => {
    if (key === '_and') {
      return (value as Filter[]).every(rule => isRelationshipTypeAllowed(rule, type))
    }
    if (key === '_or') {
      return (value as Filter[]).some(rule => isRelationshipTypeAllowed(rule, type))
    }
    if (key !== 'relationship_type') {
      return true
    }
    return matchesRelationshipType(value as Filter, type)
  })
}

/**
 * What the user may create in `business_partners`, per relationship type.
 *
 * Grants do NOT add up here. Directus gathers the validation of *every* create
 * row for the collection and applies them together — `processPayload` ends at
 * `validatePayload({ _and: rules }, payload)` — so a payload has to satisfy all
 * of them. A second policy widens the writable *fields* (those are unioned) but
 * can never relax another policy's validation.
 *
 * That is why the operations tiers differ. `SupplyHub SAP` carries an
 * unrestricted create and sits on both operations roles, but its empty rule adds
 * no constraint rather than lifting one: `CONNECT Internal Operations` still
 * caps plain operations users at `relationship_type = customer`, while an
 * Operations Manager's grants are unrestricted on both policies and so admit
 * suppliers. Reading these as OR handed those users a supplier form Directus
 * then rejected on save — the exact failure this module exists to prevent.
 */
export async function resolveBusinessPartnerCreateRights(
  user: AuthenticatedUser,
): Promise<BusinessPartnerCreateRights> {
  const policies = await fetchPolicies(user)

  // Admins bypass permission rules altogether — no create row to read.
  if (policies.some(policy => policy.admin_access)) {
    return { customer: true, supplier: true }
  }

  const policyIds = policies.map(policy => policy.id)
  if (!policyIds.length) {
    return { customer: false, supplier: false }
  }

  // `validation` is the only rule that bears on a create: the `permissions`
  // filter selects existing rows, and a create has none to select.
  const permissions = await fetchAsService<Array<{ validation: Filter | null }>>('/permissions', {
    limit: '-1',
    fields: 'validation',
    filter: JSON.stringify({
      _and: [
        { collection: { _eq: COLLECTION } },
        { action: { _eq: 'create' } },
        { policy: { _in: policyIds } },
      ],
    }),
  })

  // Empty and absent rules are dropped before the `_and`, matching how Directus
  // builds the list — an unrestricted grant contributes no constraint at all.
  const validationRules = permissions
    .map(permission => permission.validation)
    .filter((validation): validation is Filter => Boolean(validation) && Object.keys(validation).length > 0)

  // A create still needs a grant to exist; past that, every rule has to admit
  // the type.
  const isAllowed = (type: RelationshipType): boolean =>
    permissions.length > 0 && validationRules.every(rule => isRelationshipTypeAllowed(rule, type))

  return {
    customer: isAllowed('customer'),
    supplier: isAllowed('supplier'),
  }
}

export type AccountManagerCreateDefault = 'self' | 'null'

// What the caller may do with `account_manager_id` when updating a partner of a
// given type: 'none' (cannot write it, not even null), 'clear-to-null' (the sales
// one-way self-unassign), or 'any' (reassign to anyone / unassign).
export type AccountManagerUpdateCapability = 'none' | 'clear-to-null' | 'any'

export interface AccountManagerCapabilities {
  create: Record<RelationshipType, AccountManagerCreateDefault>
  update: Record<RelationshipType, AccountManagerUpdateCapability>
}

// How freely one create permission lets the payload set `account_manager_id`
// for a given relationship type. Ordered least → most permissive so additive
// grants reduce to the most permissive across the user's policies.
type AccountManagerCreateCapability = 'none' | 'null' | 'self-or-null' | 'any'

const CREATE_CAPABILITY_RANK: Record<AccountManagerCreateCapability, number> = {
  none: 0,
  null: 1,
  'self-or-null': 2,
  any: 3,
}

const UPDATE_CAPABILITY_RANK: Record<AccountManagerUpdateCapability, number> = {
  none: 0,
  'clear-to-null': 1,
  any: 2,
}

/**
 * Collect what a validation tree says about `account_manager_id`: whether it is
 * constrained at all, whether the current user is an allowed value, and whether
 * null is allowed. `_and`/`_or` are walked; only the account_manager_id leaves
 * matter here.
 */
function scanAccountManagerConstraint(
  node: Filter | null,
  found: { constrained: boolean, allowsSelf: boolean, allowsNull: boolean },
): void {
  if (!node) { return }
  for (const [key, value] of Object.entries(node)) {
    if (key === '_and' || key === '_or') {
      if (Array.isArray(value)) {
        value.forEach(child => scanAccountManagerConstraint(child as Filter, found))
      }
    } else if (key === 'account_manager_id') {
      found.constrained = true
      const operators = (value ?? {}) as Record<string, unknown>
      if (operators._eq === '$CURRENT_USER') { found.allowsSelf = true }
      if (operators._null === true) { found.allowsNull = true }
    }
  }
}

/**
 * The account-manager create capability one permission grants for `type`: 'none'
 * if it does not admit the type, otherwise how freely it lets the create set
 * account_manager_id. A field the permission cannot write counts as 'null' — the
 * create must omit it, which stores null.
 */
function accountManagerCreateCapability(
  permission: { fields: string[] | null, validation: Filter | null },
  type: RelationshipType,
): AccountManagerCreateCapability {
  if (!isRelationshipTypeAllowed(permission.validation, type)) {
    return 'none'
  }
  const fields = permission.fields ?? []
  const isWritable = fields.includes('account_manager_id') || fields.includes('*')
  if (!isWritable) {
    return 'null'
  }
  const found = { constrained: false, allowsSelf: false, allowsNull: false }
  scanAccountManagerConstraint(permission.validation, found)
  if (!found.constrained) { return 'any' }
  if (found.allowsSelf) { return 'self-or-null' }
  return 'null'
}

/**
 * The account-manager update capability one permission grants for `type`.
 *
 * The relationship type on update is scoped by the permission's item-filter
 * (`permissions`), not its validation — the sales tiers carry one update rule for
 * customers (account manager writable) and another for suppliers (account manager
 * absent). A field the permission cannot write is 'none' (even null is rejected);
 * a validation pinning the value to null is the one-way 'clear-to-null'; anything
 * else is 'any'.
 */
function accountManagerUpdateCapability(
  permission: { fields: string[] | null, validation: Filter | null, permissions: Filter | null },
  type: RelationshipType,
): AccountManagerUpdateCapability {
  if (!isRelationshipTypeAllowed(permission.permissions, type)) {
    return 'none'
  }
  const fields = permission.fields ?? []
  const isWritable = fields.includes('account_manager_id') || fields.includes('*')
  if (!isWritable) {
    return 'none'
  }
  const found = { constrained: false, allowsSelf: false, allowsNull: false }
  scanAccountManagerConstraint(permission.validation, found)
  if (found.constrained && found.allowsNull && !found.allowsSelf) {
    return 'clear-to-null'
  }
  return 'any'
}

/**
 * The create default per relationship type — 'self' (pre-fill the creating user)
 * or 'null' (leave empty) — from the caller's business_partners create grants.
 *
 * The spec: pre-fill self where the salesperson owns the customer they create
 * (Sales, Sales Manager); leave empty for the operations tiers. Operations
 * Manager is told apart from Sales Manager without a name match — only Operations
 * Manager can create a supplier with a writable account manager, so a supplier
 * capability of 'any' marks them.
 */
function deriveCreateDefaults(
  permissions: Array<{ fields: string[] | null, validation: Filter | null }>,
): Record<RelationshipType, AccountManagerCreateDefault> {
  const capabilityFor = (type: RelationshipType): AccountManagerCreateCapability =>
    permissions.reduce<AccountManagerCreateCapability>((best, permission) => {
      const capability = accountManagerCreateCapability(permission, type)
      return CREATE_CAPABILITY_RANK[capability] > CREATE_CAPABILITY_RANK[best] ? capability : best
    }, 'none')

  const customerCapability = capabilityFor('customer')
  const supplierCapability = capabilityFor('supplier')
  const isOperationsManager = supplierCapability === 'any'

  const defaultFor = (capability: AccountManagerCreateCapability): AccountManagerCreateDefault => {
    if (capability === 'self-or-null') { return 'self' }
    if (capability === 'any') { return isOperationsManager ? 'null' : 'self' }
    return 'null'
  }

  return {
    customer: defaultFor(customerCapability),
    supplier: defaultFor(supplierCapability),
  }
}

/** The update capability per relationship type, most-permissive across grants. */
function deriveUpdateCapability(
  permissions: Array<{ fields: string[] | null, validation: Filter | null, permissions: Filter | null }>,
): Record<RelationshipType, AccountManagerUpdateCapability> {
  const capabilityFor = (type: RelationshipType): AccountManagerUpdateCapability =>
    permissions.reduce<AccountManagerUpdateCapability>((best, permission) => {
      const capability = accountManagerUpdateCapability(permission, type)
      return UPDATE_CAPABILITY_RANK[capability] > UPDATE_CAPABILITY_RANK[best] ? capability : best
    }, 'none')

  return {
    customer: capabilityFor('customer'),
    supplier: capabilityFor('supplier'),
  }
}

// account_manager_id maps to a SAP SlpCode, and the pool of valid managers is
// department-scoped: Sales (1) owns customers, Logistics (8) owns suppliers.
const SALES_DEPARTMENT_ID = 1
const LOGISTICS_DEPARTMENT_ID = 8

/**
 * The account-manager create default for a user whose create field-permissions
 * can't be read as a signal — i.e. an admin, who bypasses them. Falls back to
 * the user's SAP identity, which is what account_manager_id ultimately becomes
 * (a SlpCode): a Sales-department rep owns the customers they create, a
 * Logistics-department rep the suppliers. A user with no SlpCode (or in neither
 * department) stays 'null', matching the operations tiers.
 *
 * Read with the service token — the SAP fields may not be user-readable, and a
 * lookup failure degrades to 'null' (no auto-assign) rather than throwing, so an
 * admin still keeps their update capability.
 */
async function sapCreateDefaults(userId: string): Promise<Record<RelationshipType, AccountManagerCreateDefault>> {
  const empty: Record<RelationshipType, AccountManagerCreateDefault> = { customer: 'null', supplier: 'null' }
  try {
    const sapUser = await fetchAsService<{ sap_department_id: number | null, sap_sales_employee_id: number | null }>(
      `/users/${userId}`,
      { fields: 'sap_department_id,sap_sales_employee_id' },
    )
    const isRep = sapUser?.sap_sales_employee_id != null
    return {
      customer: isRep && sapUser?.sap_department_id === SALES_DEPARTMENT_ID ? 'self' : 'null',
      supplier: isRep && sapUser?.sap_department_id === LOGISTICS_DEPARTMENT_ID ? 'self' : 'null',
    }
  } catch {
    return empty
  }
}

/**
 * What the caller may do with a business partner's account manager, per
 * relationship type and per action: the create default (what each create form
 * pre-fills, since Directus keeps no server-side preset) and the update
 * capability (how the account-info drawer branches).
 *
 * Both are derived from the create/update field-permissions — the same source
 * `resolveBusinessPartnerCreateRights` reads — rather than a policy name a rename
 * could silently change. The fallbacks are safe by design: 'null' is accepted by
 * every tier's create grant, and 'none' withholds a control rather than offering
 * one Directus would reject.
 */
export async function resolveAccountManagerCapabilities(
  user: AuthenticatedUser,
): Promise<AccountManagerCapabilities> {
  const policies = await fetchPolicies(user)

  // Admins bypass every rule, so the permission-based sales-tier detection can't
  // see them. They may reassign anything (update 'any'); for the create default
  // fall back to their SAP identity so an admin who is also a real rep (Sales or
  // Logistics dept with a SlpCode) still owns what they create, while a pure
  // admin with no SlpCode stays unassigned.
  if (policies.some(policy => policy.admin_access)) {
    return {
      create: await sapCreateDefaults(user.id),
      update: { customer: 'any', supplier: 'any' },
    }
  }

  const policyIds = policies.map(policy => policy.id)
  if (!policyIds.length) {
    return {
      create: { customer: 'null', supplier: 'null' },
      update: { customer: 'none', supplier: 'none' },
    }
  }

  const permissionsFor = (action: 'create' | 'update', fields: string) =>
    fetchAsService<Array<{ fields: string[] | null, validation: Filter | null, permissions: Filter | null }>>('/permissions', {
      limit: '-1',
      fields,
      filter: JSON.stringify({
        _and: [
          { collection: { _eq: COLLECTION } },
          { action: { _eq: action } },
          { policy: { _in: policyIds } },
        ],
      }),
    })

  const [createPermissions, updatePermissions] = await Promise.all([
    permissionsFor('create', 'fields,validation'),
    permissionsFor('update', 'fields,validation,permissions'),
  ])

  return {
    create: deriveCreateDefaults(createPermissions),
    update: deriveUpdateCapability(updatePermissions),
  }
}

// The status-bearing collections CONNECT can edit. `business_partners` carries
// the record's own status; the rest are the junctions behind the contact,
// address and manufacturer-association drawers. Every other collection with a
// status column belongs to SupplyHub — CONNECT never writes them.
const STATUS_COLLECTIONS = [
  'business_partners',
  'business_partners_contacts',
  'business_partners_addresses',
  'manufacturers_business_partners',
] as const

export type StatusCollection = typeof STATUS_COLLECTIONS[number]

// The three grants are independent in Directus — a policy can hold `status`
// without `inactive_note` (or either without `remarks`), so each is reported on
// its own and the UI disables exactly the controls the caller cannot write.
// `remarks` rides along here because it lives on the same collections (the
// partner's account notes, the manufacturer junction's remarks).
export interface FieldWriteRights {
  status: boolean
  inactiveNote: boolean
  remarks: boolean
}

export interface StatusFieldRights {
  /** Scoped by relationship type — the sales tiers carry one update row per type. */
  business_partners: Record<RelationshipType, FieldWriteRights>
  business_partners_contacts: FieldWriteRights
  business_partners_addresses: FieldWriteRights
  manufacturers_business_partners: FieldWriteRights
}

const NO_RIGHTS: FieldWriteRights = { status: false, inactiveNote: false, remarks: false }
const ALL_RIGHTS: FieldWriteRights = { status: true, inactiveNote: true, remarks: true }

const noRights = (): StatusFieldRights => ({
  business_partners: { customer: { ...NO_RIGHTS }, supplier: { ...NO_RIGHTS } },
  business_partners_contacts: { ...NO_RIGHTS },
  business_partners_addresses: { ...NO_RIGHTS },
  manufacturers_business_partners: { ...NO_RIGHTS },
})

/**
 * Whether `field` may be written, given a set of update rows.
 *
 * Callers pass only the rows whose item-filter matches the record in question —
 * Directus scores an update against those, not against every row on the
 * collection. A sales policy carrying `status` on its customer-scoped row does
 * not thereby carry it on suppliers: writing one there is refused with
 * "no permission to access field status", which is how this was pinned down.
 */
function isFieldWritable(permissions: Array<{ fields: string[] | null }>, field: string): boolean {
  return permissions.some((permission) => {
    const fields = permission.fields ?? []
    return fields.includes('*') || fields.includes(field)
  })
}

/**
 * Which status / inactive-note / remarks fields the caller may write, per entity
 * CONNECT exposes a control for.
 *
 * The browser cannot work this out: `/permissions/me` reports a grant's `fields`
 * for the *collection*, but the app needs the answer per relationship type — a
 * policy may reach customers and suppliers through separate update rows — and
 * for the junctions behind each drawer. So it is resolved here with the service
 * token, the same way create rights are, and the UI is told only yes or no.
 *
 * Everything is read from the live rows rather than matched against policy
 * names, so editing a policy in Directus changes the UI on the user's next
 * session without a deploy.
 */
export async function resolveStatusFieldRights(user: AuthenticatedUser): Promise<StatusFieldRights> {
  const policies = await fetchPolicies(user)

  // Admins bypass field permissions entirely — there is no row to read.
  if (policies.some(policy => policy.admin_access)) {
    return {
      business_partners: { customer: { ...ALL_RIGHTS }, supplier: { ...ALL_RIGHTS } },
      business_partners_contacts: { ...ALL_RIGHTS },
      business_partners_addresses: { ...ALL_RIGHTS },
      manufacturers_business_partners: { ...ALL_RIGHTS },
    }
  }

  const policyIds = policies.map(policy => policy.id)
  if (!policyIds.length) {
    return noRights()
  }

  const permissions = await fetchAsService<Array<{
    collection: string
    fields: string[] | null
    permissions: Filter | null
  }>>('/permissions', {
    limit: '-1',
    fields: 'collection,fields,permissions',
    filter: JSON.stringify({
      _and: [
        { collection: { _in: STATUS_COLLECTIONS } },
        { action: { _eq: 'update' } },
        { policy: { _in: policyIds } },
      ],
    }),
  })

  const rowsFor = (collection: StatusCollection) =>
    permissions.filter(permission => permission.collection === collection)

  const rightsFor = (collection: StatusCollection): FieldWriteRights => {
    const rows = rowsFor(collection)
    if (!rows.length) { return { ...NO_RIGHTS } }
    return {
      status: isFieldWritable(rows, 'status'),
      inactiveNote: isFieldWritable(rows, 'inactive_note'),
      remarks: isFieldWritable(rows, 'remarks'),
    }
  }

  // A partner's fields are scored per relationship type, against only the rows
  // that reach that type. The sales tiers split their update grant in two — a
  // customer-scoped row carrying `status`, a supplier-scoped row without it — and
  // the supplier write is refused even though the same policy holds the field for
  // customers. Pooling the rows would report the supplier control as writable and
  // hand the user a toggle that fails on save.
  const partnerRows = rowsFor('business_partners')
  const partnerRightsFor = (type: RelationshipType): FieldWriteRights => {
    const matching = partnerRows.filter(row => isRelationshipTypeAllowed(row.permissions, type))
    if (!matching.length) { return { ...NO_RIGHTS } }
    return {
      status: isFieldWritable(matching, 'status'),
      inactiveNote: isFieldWritable(matching, 'inactive_note'),
      remarks: isFieldWritable(matching, 'remarks'),
    }
  }

  return {
    business_partners: {
      customer: partnerRightsFor('customer'),
      supplier: partnerRightsFor('supplier'),
    },
    business_partners_contacts: rightsFor('business_partners_contacts'),
    business_partners_addresses: rightsFor('business_partners_addresses'),
    manufacturers_business_partners: rightsFor('manufacturers_business_partners'),
  }
}

function filterAdmitsRelationshipType(filter: Filter | null, type: RelationshipType): boolean {
  if (!filter || !Object.keys(filter).length) {
    return true
  }

  return Object.entries(filter).every(([key, value]) => {
    if (key === '_and') {
      return Array.isArray(value) && value.every(rule => filterAdmitsRelationshipType(rule as Filter, type))
    }
    if (key === '_or') {
      return Array.isArray(value) && value.some(rule => filterAdmitsRelationshipType(rule as Filter, type))
    }
    if (key === 'relationship_type') {
      return matchesRelationshipType(value as Filter, type)
    }
    // Any other key is either a relation to walk into or a field's operators;
    // operator values are primitives, so recursing is safe and finds nothing.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return filterAdmitsRelationshipType(value as Filter, type)
    }
    return true
  })
}

const DELETE_COLLECTION_GROUPS = {
  contactPhone: ['contacts_phone_numbers'],
  partnerPhone: ['business_partners_phone_numbers'],
  shipping: ['shipping_accounts', 'business_partners_shipping_accounts'],
} as const

export type DeleteGroup = keyof typeof DELETE_COLLECTION_GROUPS

/** Per group, whether the caller may delete on a customer / on a supplier. */
export type DeleteRights = Record<DeleteGroup, Record<RelationshipType, boolean>>

const noDeleteRights = (): DeleteRights => ({
  contactPhone: { customer: false, supplier: false },
  partnerPhone: { customer: false, supplier: false },
  shipping: { customer: false, supplier: false },
})

export async function resolveDeleteRights(user: AuthenticatedUser): Promise<DeleteRights> {
  const policies = await fetchPolicies(user)

  // Admins bypass permission rules altogether — no delete row to read.
  if (policies.some(policy => policy.admin_access)) {
    return {
      contactPhone: { customer: true, supplier: true },
      partnerPhone: { customer: true, supplier: true },
      shipping: { customer: true, supplier: true },
    }
  }

  const policyIds = policies.map(policy => policy.id)
  if (!policyIds.length) {
    return noDeleteRights()
  }

  const collections = Object.values(DELETE_COLLECTION_GROUPS).flat()
  const permissions = await fetchAsService<Array<{
    collection: string
    permissions: Filter | null
  }>>('/permissions', {
    limit: '-1',
    fields: 'collection,permissions',
    filter: JSON.stringify({
      _and: [
        { collection: { _in: collections } },
        { action: { _eq: 'delete' } },
        { policy: { _in: policyIds } },
      ],
    }),
  })

  const canDelete = (group: DeleteGroup, type: RelationshipType): boolean =>
    DELETE_COLLECTION_GROUPS[group].every(collection =>
      permissions.some(permission =>
        permission.collection === collection
        && filterAdmitsRelationshipType(permission.permissions, type),
      ),
    )

  const rightsFor = (group: DeleteGroup): Record<RelationshipType, boolean> => ({
    customer: canDelete(group, 'customer'),
    supplier: canDelete(group, 'supplier'),
  })

  return {
    contactPhone: rightsFor('contactPhone'),
    partnerPhone: rightsFor('partnerPhone'),
    shipping: rightsFor('shipping'),
  }
}
