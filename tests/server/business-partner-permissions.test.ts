import type { AuthenticatedUser } from '../../server/utils/auth'

const USER: { id: string, email: string | null, role: string | null } = {
  id: 'user-luis',
  email: 'luis@libertysupply.com',
  role: 'role-employee-basic',
}

/**
 * Stand in for Directus. `roles` maps a role id to its parent; `access` is the
 * policy-attachment table; `permissions` is what /permissions returns for the
 * business_partners create lookup.
 */
function mockDirectus(options: {
  roles?: Record<string, string | null>
  access?: Array<{ policy: { id: string, admin_access: boolean } | null }>
  permissions?: Array<{ fields?: string[] | null, validation: Record<string, unknown> | null }>
  updatePermissions?: Array<{ collection?: string, fields?: string[] | null, validation?: Record<string, unknown> | null, permissions?: Record<string, unknown> | null }>
  deletePermissions?: Array<{ collection: string, permissions?: Record<string, unknown> | null }>
}) {
  const { roles = {}, access = [], permissions = [], updatePermissions = [], deletePermissions = [] } = options

  return vi.fn(async (url: string) => {
    const { pathname, searchParams } = new URL(url)

    if (pathname.startsWith('/roles/')) {
      const id = pathname.slice('/roles/'.length)
      return jsonResponse({ parent: roles[id] ?? null })
    }

    if (pathname === '/access') {
      return jsonResponse(access, searchParams.get('filter'))
    }

    if (pathname === '/permissions') {
      // Create and update rights query the same endpoint; tell them apart by the
      // action in the filter so each gets its own fixture.
      const filter = searchParams.get('filter') ?? ''
      if (filter.includes('"_eq":"delete"')) {
        return jsonResponse(deletePermissions, filter)
      }
      const forUpdate = filter.includes('"_eq":"update"')
      return jsonResponse(forUpdate ? updatePermissions : permissions, filter)
    }

    throw new Error(`Unexpected Directus call: ${url}`)
  })
}

const seenFilters: string[] = []

function jsonResponse(data: unknown, filter?: string | null) {
  if (filter) { seenFilters.push(filter) }
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as unknown as Response
}

async function resolve(user = USER) {
  const { resolveBusinessPartnerCreateRights } = await import(
    '../../server/utils/businessPartnerPermissions'
  )
  return resolveBusinessPartnerCreateRights(user as AuthenticatedUser)
}

async function resolveCapabilities(user = USER) {
  const { resolveAccountManagerCapabilities } = await import(
    '../../server/utils/businessPartnerPermissions'
  )
  return resolveAccountManagerCapabilities(user as AuthenticatedUser)
}

async function resolveDefaults(user = USER) {
  return (await resolveCapabilities(user)).create
}

async function resolveDeletes(user = USER) {
  const { resolveDeleteRights } = await import(
    '../../server/utils/businessPartnerPermissions'
  )
  return resolveDeleteRights(user as AuthenticatedUser)
}

async function resolveStatusFields(user = USER) {
  const { resolveStatusFieldRights } = await import(
    '../../server/utils/businessPartnerPermissions'
  )
  return resolveStatusFieldRights(user as AuthenticatedUser)
}

describe('Scenario: Who may create a supplier', () => {
  beforeEach(() => {
    vi.resetModules()
    seenFilters.length = 0
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  it('lets an Employee Basic user create a customer but not a supplier', async () => {
    // The real CONNECT Internal Sales grant: create on business_partners, capped
    // by validation at relationship_type = customer.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-basic', admin_access: false } }],
      permissions: [{ validation: { _and: [{ relationship_type: { _eq: 'customer' } }] } }],
    })

    expect(await resolve()).toEqual({ customer: true, supplier: false })
  })

  it('lets an administrator create both', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [
        { policy: { id: 'policy-basic', admin_access: false } },
        { policy: { id: 'policy-admin', admin_access: true } },
      ],
    })

    expect(await resolve()).toEqual({ customer: true, supplier: true })
  })

  it('refuses both to a user with no policies at all', async () => {
    globalThis.fetch = mockDirectus({ roles: { 'role-employee-basic': null } })

    expect(await resolve()).toEqual({ customer: false, supplier: false })
  })

  it('refuses both when the user has policies but no create grant', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-readonly', admin_access: false } }],
      permissions: [],
    })

    expect(await resolve()).toEqual({ customer: false, supplier: false })
  })
})

describe('Scenario: Reading the validation rule', () => {
  beforeEach(() => {
    vi.resetModules()
    seenFilters.length = 0
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  it('treats an unrestricted create grant as allowing both types', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-basic', admin_access: false } }],
      permissions: [{ validation: null }],
    })

    expect(await resolve()).toEqual({ customer: true, supplier: true })
  })

  it('ignores validation rules about other fields', async () => {
    // A rule like "name must be filled in" says nothing about supplier vs
    // customer, and must not read as "cannot create suppliers".
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-basic', admin_access: false } }],
      permissions: [{ validation: { _and: [{ name: { _nnull: true } }] } }],
    })

    expect(await resolve()).toEqual({ customer: true, supplier: true })
  })

  it('honours a rule that lists both types', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-basic', admin_access: false } }],
      permissions: [{ validation: { relationship_type: { _in: ['customer', 'supplier'] } } }],
    })

    expect(await resolve()).toEqual({ customer: true, supplier: true })
  })

  it('applies every policy\'s rule at once, so conflicting caps admit neither type', async () => {
    // Directus ANDs the validation of all create rows, so a customer-only rule
    // and a supplier-only rule leave no payload that satisfies both.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [
        { policy: { id: 'policy-basic', admin_access: false } },
        { policy: { id: 'policy-buyer', admin_access: false } },
      ],
      permissions: [
        { validation: { relationship_type: { _eq: 'customer' } } },
        { validation: { relationship_type: { _eq: 'supplier' } } },
      ],
    })

    expect(await resolve()).toEqual({ customer: false, supplier: false })
  })

  it('does not let an unrestricted policy lift another policy\'s cap', async () => {
    // The live operations setup: CONNECT Internal Operations caps creates at
    // customer, SupplyHub SAP adds an unrestricted create on the same role. The
    // empty rule contributes no constraint — it does not grant suppliers, and
    // reading it as one sent operations users to a form that failed on save.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [
        { policy: { id: 'policy-ops', admin_access: false } },
        { policy: { id: 'policy-sap', admin_access: false } },
      ],
      permissions: [
        { validation: { _and: [{ relationship_type: { _eq: 'customer' } }, { account_manager_id: { _null: true } }] } },
        { validation: null },
      ],
    })

    expect(await resolve()).toEqual({ customer: true, supplier: false })
  })

  it('refuses a type it cannot make sense of, rather than guessing', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-basic', admin_access: false } }],
      permissions: [{ validation: { relationship_type: { _contains: 'sup' } } }],
    })

    expect(await resolve()).toEqual({ customer: false, supplier: false })
  })
})

describe('Scenario: Policies inherited through nested roles', () => {
  beforeEach(() => {
    vi.resetModules()
    seenFilters.length = 0
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  it('counts a policy attached to a parent role', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': 'role-parent', 'role-parent': null },
      access: [{ policy: { id: 'policy-admin', admin_access: true } }],
    })

    expect(await resolve()).toEqual({ customer: true, supplier: true })

    const accessFilter = seenFilters.find(filter => filter.includes('role'))
    expect(accessFilter).toContain('role-parent')
    expect(accessFilter).toContain('role-employee-basic')
  })

  it('survives a role that is its own ancestor', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': 'role-parent', 'role-parent': 'role-employee-basic' },
      access: [{ policy: { id: 'policy-basic', admin_access: false } }],
      permissions: [{ validation: { relationship_type: { _eq: 'customer' } } }],
    })

    expect(await resolve()).toEqual({ customer: true, supplier: false })
  })
})

describe('Scenario: What the create form defaults the account manager to', () => {
  beforeEach(() => {
    vi.resetModules()
    seenFilters.length = 0
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  // The create-permission field allowlist including a writable account manager.
  const withAccountManager = ['account_manager_id', 'relationship_type', 'name']

  it('pre-fills self for a Sales user creating a customer, empty for a supplier', async () => {
    // Sales: create capped to customer, account manager null or the creator.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      permissions: [{
        fields: withAccountManager,
        validation: {
          _and: [
            { relationship_type: { _eq: 'customer' } },
            { _or: [
              { account_manager_id: { _null: true } },
              { account_manager_id: { _eq: '$CURRENT_USER' } },
            ] },
          ],
        },
      }],
    })

    expect(await resolveDefaults()).toEqual({ customer: 'self', supplier: 'null' })
  })

  it('pre-fills self for a Sales Manager creating a customer', async () => {
    // Sales Manager: create capped to customer, but any account manager allowed.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales-mgr', admin_access: false } }],
      permissions: [{
        fields: withAccountManager,
        validation: { _and: [{ relationship_type: { _eq: 'customer' } }] },
      }],
    })

    expect(await resolveDefaults()).toEqual({ customer: 'self', supplier: 'null' })
  })

  it('leaves it empty for an Operations user, whose create is capped at null', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-ops', admin_access: false } }],
      permissions: [{
        fields: withAccountManager,
        validation: {
          _and: [
            { relationship_type: { _eq: 'customer' } },
            { account_manager_id: { _null: true } },
          ],
        },
      }],
    })

    expect(await resolveDefaults()).toEqual({ customer: 'null', supplier: 'null' })
  })

  it('leaves it empty for an Operations Manager, who alone may create suppliers', async () => {
    // No validation: any type, any account manager — but the spec leaves the
    // picker empty. The writable supplier create is what marks the Ops Manager.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-ops-mgr', admin_access: false } }],
      permissions: [{ fields: withAccountManager, validation: null }],
    })

    expect(await resolveDefaults()).toEqual({ customer: 'null', supplier: 'null' })
  })

  it('leaves it empty for an administrator', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-admin', admin_access: true } }],
    })

    expect(await resolveDefaults()).toEqual({ customer: 'null', supplier: 'null' })
  })

  it('leaves it empty for a user with no policies at all', async () => {
    globalThis.fetch = mockDirectus({ roles: { 'role-employee-basic': null } })

    expect(await resolveDefaults()).toEqual({ customer: 'null', supplier: 'null' })
  })

  it('leaves it empty when the create grant cannot write account_manager_id', async () => {
    // Customer create is allowed, but the field is not in the create allowlist —
    // it must be omitted, which stores null.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-narrow', admin_access: false } }],
      permissions: [{
        fields: ['name', 'relationship_type'],
        validation: { _and: [{ relationship_type: { _eq: 'customer' } }] },
      }],
    })

    expect(await resolveDefaults()).toEqual({ customer: 'null', supplier: 'null' })
  })
})

describe('Scenario: What the drawer lets you do with the account manager on update', () => {
  beforeEach(() => {
    vi.resetModules()
    seenFilters.length = 0
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  const withAccountManager = ['account_manager_id', 'name']
  // Item-filters that scope an update rule to one relationship type.
  const customerOnly = { _and: [{ relationship_type: { _eq: 'customer' } }] }
  const supplierOnly = { _and: [{ relationship_type: { _neq: 'customer' } }] }

  it('lets Sales one-way clear their own customer, and nothing on suppliers', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      updatePermissions: [
        { fields: withAccountManager, validation: { _and: [{ account_manager_id: { _null: true } }] }, permissions: customerOnly },
        { fields: ['name'], validation: null, permissions: supplierOnly },
      ],
    })

    expect((await resolveCapabilities()).update).toEqual({ customer: 'clear-to-null', supplier: 'none' })
  })

  it('lets a Sales Manager reassign customers but not touch suppliers', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales-mgr', admin_access: false } }],
      updatePermissions: [
        { fields: withAccountManager, validation: null, permissions: customerOnly },
        { fields: ['name'], validation: null, permissions: supplierOnly },
      ],
    })

    expect((await resolveCapabilities()).update).toEqual({ customer: 'any', supplier: 'none' })
  })

  it('lets an Operations user touch neither, not even null', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-ops', admin_access: false } }],
      updatePermissions: [{ fields: ['name'], validation: null, permissions: {} }],
    })

    expect((await resolveCapabilities()).update).toEqual({ customer: 'none', supplier: 'none' })
  })

  it('lets an Operations Manager reassign both customers and suppliers', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-ops-mgr', admin_access: false } }],
      updatePermissions: [{ fields: withAccountManager, validation: null, permissions: {} }],
    })

    expect((await resolveCapabilities()).update).toEqual({ customer: 'any', supplier: 'any' })
  })

  it('lets an administrator reassign both', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-admin', admin_access: true } }],
    })

    expect((await resolveCapabilities()).update).toEqual({ customer: 'any', supplier: 'any' })
  })

  it('lets a user with no policies touch neither', async () => {
    globalThis.fetch = mockDirectus({ roles: { 'role-employee-basic': null } })

    expect((await resolveCapabilities()).update).toEqual({ customer: 'none', supplier: 'none' })
  })
})

describe('Scenario: Which status fields a user may write', () => {
  beforeEach(() => {
    vi.resetModules()
    seenFilters.length = 0
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  const customerScoped = { _and: [{ relationship_type: { _eq: 'customer' } }] }
  const supplierScoped = { _and: [{ relationship_type: { _neq: 'customer' } }] }

  it('reports the partner status a sales user may write, per relationship type', async () => {
    // The live sales shape: one update row per relationship type, `status` in
    // both, `inactive_note` in neither.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      updatePermissions: [
        { collection: 'business_partners', fields: ['name', 'status'], permissions: customerScoped },
        { collection: 'business_partners', fields: ['name', 'status'], permissions: supplierScoped },
      ],
    })

    const rights = await resolveStatusFields()
    expect(rights.business_partners).toEqual({
      customer: { status: true, inactiveNote: false, remarks: false },
      supplier: { status: true, inactiveNote: false, remarks: false },
    })
  })

  it('withholds a partner type the policy cannot reach', async () => {
    // A customer-only update row leaves suppliers untouchable, whatever fields
    // it lists.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      updatePermissions: [
        { collection: 'business_partners', fields: ['status', 'inactive_note'], permissions: customerScoped },
      ],
    })

    const rights = await resolveStatusFields()
    expect(rights.business_partners.customer).toEqual({ status: true, inactiveNote: true, remarks: false })
    expect(rights.business_partners.supplier).toEqual({ status: false, inactiveNote: false, remarks: false })
  })

  it('scores each type against its own rows, not the pooled set', async () => {
    // The live sales shape: `status` on the customer-scoped row only. Directus
    // scores an update against the rows reaching that record, so the supplier
    // write is refused — reading the rows as one pool would report it writable
    // and hand the user a toggle that fails on save.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      updatePermissions: [
        { collection: 'business_partners', fields: ['status'], permissions: customerScoped },
        { collection: 'business_partners', fields: ['inactive_note'], permissions: supplierScoped },
      ],
    })

    const rights = await resolveStatusFields()
    expect(rights.business_partners.customer).toEqual({ status: true, inactiveNote: false, remarks: false })
    expect(rights.business_partners.supplier).toEqual({ status: false, inactiveNote: true, remarks: false })
  })

  it('reads a wildcard grant as covering every field', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-ops', admin_access: false } }],
      updatePermissions: [
        { collection: 'business_partners_contacts', fields: ['*'], permissions: {} },
      ],
    })

    expect((await resolveStatusFields()).business_partners_contacts).toEqual({
      status: true,
      inactiveNote: true,
      remarks: true,
    })
  })

  it('reports remarks independently of the status pair', async () => {
    // A remarks-only grant must not unlock status or the note — each field
    // right stands on its own, and the account-notes drawer reads only this one.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      updatePermissions: [
        { collection: 'business_partners', fields: ['remarks'], permissions: customerScoped },
      ],
    })

    const rights = await resolveStatusFields()
    expect(rights.business_partners.customer).toEqual({ status: false, inactiveNote: false, remarks: true })
  })

  it('withholds a junction the user has no update grant on', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      updatePermissions: [
        { collection: 'business_partners_contacts', fields: ['status', 'inactive_note'], permissions: {} },
      ],
    })

    const rights = await resolveStatusFields()
    expect(rights.business_partners_contacts).toEqual({ status: true, inactiveNote: true, remarks: false })
    expect(rights.business_partners_addresses).toEqual({ status: false, inactiveNote: false, remarks: false })
    expect(rights.manufacturers_business_partners).toEqual({ status: false, inactiveNote: false, remarks: false })
  })

  it('lets an administrator write every status field', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-admin', admin_access: true } }],
    })

    const rights = await resolveStatusFields()
    expect(rights.business_partners.supplier).toEqual({ status: true, inactiveNote: true, remarks: true })
    expect(rights.manufacturers_business_partners).toEqual({ status: true, inactiveNote: true, remarks: true })
  })

  it('withholds everything from a user with no policies', async () => {
    globalThis.fetch = mockDirectus({ roles: { 'role-employee-basic': null } })

    const rights = await resolveStatusFields()
    expect(rights.business_partners).toEqual({
      customer: { status: false, inactiveNote: false, remarks: false },
      supplier: { status: false, inactiveNote: false, remarks: false },
    })
    expect(rights.business_partners_addresses).toEqual({ status: false, inactiveNote: false, remarks: false })
  })
})

describe('Scenario: Who may delete phone numbers and shipping accounts', () => {
  beforeEach(() => {
    vi.resetModules()
    seenFilters.length = 0
    globalThis.useRuntimeConfig = () => ({
      directusUrl: 'http://directus.test',
      directusToken: 'service-token',
    })
  })

  // The sales grant as CONNECT-1031/1034 specify it: the partner-scoped rows are
  // capped at customers. The contact-phone row carries no filter — that collection
  // has no relation path back to a partner — so it answers true for both, and the
  // supplier restriction rests on the partner-scoped rows.
  const SALES_DELETE_ROWS = [
    { collection: 'contacts_phone_numbers', permissions: {} },
    {
      collection: 'business_partners_phone_numbers',
      permissions: { business_partners_id: { relationship_type: { _eq: 'customer' } } },
    },
    { collection: 'shipping_accounts', permissions: {} },
    {
      collection: 'business_partners_shipping_accounts',
      permissions: { business_partners_id: { relationship_type: { _eq: 'customer' } } },
    },
  ]

  it('lets a sales user delete on customers but not on suppliers', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      deletePermissions: SALES_DELETE_ROWS,
    })

    expect(await resolveDeletes()).toEqual({
      contactPhone: { customer: true, supplier: true },
      partnerPhone: { customer: true, supplier: false },
      shipping: { customer: true, supplier: false },
    })
  })

  it('lets an operations user delete on both, their rows being unscoped', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-ops', admin_access: false } }],
      deletePermissions: [
        { collection: 'contacts_phone_numbers', permissions: {} },
        { collection: 'business_partners_phone_numbers', permissions: {} },
        { collection: 'shipping_accounts', permissions: {} },
        { collection: 'business_partners_shipping_accounts', permissions: {} },
      ],
    })

    expect(await resolveDeletes()).toEqual({
      contactPhone: { customer: true, supplier: true },
      partnerPhone: { customer: true, supplier: true },
      shipping: { customer: true, supplier: true },
    })
  })

  it('reads a relationship_type buried under a relation path', async () => {
    // A contact's phone reaches the partner through its contact — the scan has to
    // find `relationship_type` however deep it sits.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-sales', admin_access: false } }],
      deletePermissions: [
        {
          collection: 'contacts_phone_numbers',
          permissions: {
            contacts_id: {
              business_partners: { business_partners_id: { relationship_type: { _eq: 'customer' } } },
            },
          },
        },
        { collection: 'business_partners_phone_numbers', permissions: {} },
        { collection: 'shipping_accounts', permissions: {} },
        { collection: 'business_partners_shipping_accounts', permissions: {} },
      ],
    })

    const rights = await resolveDeletes()
    expect(rights.contactPhone).toEqual({ customer: true, supplier: false })
  })

  it('withholds a group when only one of its two collections is granted', async () => {
    // Deleting a shipping account removes the junction AND the account row; one
    // grant without the other cannot complete the action.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-partial', admin_access: false } }],
      deletePermissions: [
        { collection: 'business_partners_shipping_accounts', permissions: {} },
      ],
    })

    expect((await resolveDeletes()).shipping).toEqual({ customer: false, supplier: false })
  })

  it('grants the partner-phone icon without the contact-phone one', async () => {
    // The bug this split fixes: pooled into one right, a policy holding only the
    // partner-phone grant lost the icon on BOTH lists. They are separate
    // collections and separate deletes, so one answers without the other.
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-partner-only', admin_access: false } }],
      deletePermissions: [
        { collection: 'business_partners_phone_numbers', permissions: {} },
      ],
    })

    const rights = await resolveDeletes()
    expect(rights.partnerPhone).toEqual({ customer: true, supplier: true })
    expect(rights.contactPhone).toEqual({ customer: false, supplier: false })
  })

  it('grants the contact-phone icon without the partner-phone one', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-contact-only', admin_access: false } }],
      deletePermissions: [
        { collection: 'contacts_phone_numbers', permissions: {} },
      ],
    })

    const rights = await resolveDeletes()
    expect(rights.contactPhone).toEqual({ customer: true, supplier: true })
    expect(rights.partnerPhone).toEqual({ customer: false, supplier: false })
  })

  it('lets an administrator delete everything', async () => {
    globalThis.fetch = mockDirectus({
      roles: { 'role-employee-basic': null },
      access: [{ policy: { id: 'policy-admin', admin_access: true } }],
    })

    expect(await resolveDeletes()).toEqual({
      contactPhone: { customer: true, supplier: true },
      partnerPhone: { customer: true, supplier: true },
      shipping: { customer: true, supplier: true },
    })
  })

  it('withholds everything from a user with no policies', async () => {
    globalThis.fetch = mockDirectus({ roles: { 'role-employee-basic': null } })

    expect(await resolveDeletes()).toEqual({
      contactPhone: { customer: false, supplier: false },
      partnerPhone: { customer: false, supplier: false },
      shipping: { customer: false, supplier: false },
    })
  })
})
