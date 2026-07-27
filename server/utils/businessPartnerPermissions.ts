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
 * Grants are additive, exactly as Directus treats them: one policy that permits
 * suppliers is enough, however many others stop at customers.
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

  return {
    customer: permissions.some(permission => isRelationshipTypeAllowed(permission.validation, 'customer')),
    supplier: permissions.some(permission => isRelationshipTypeAllowed(permission.validation, 'supplier')),
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

  // Admins bypass every rule: they may reassign anything, but the spec still
  // leaves the create picker empty for the operations-style tiers.
  if (policies.some(policy => policy.admin_access)) {
    return {
      create: { customer: 'null', supplier: 'null' },
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
