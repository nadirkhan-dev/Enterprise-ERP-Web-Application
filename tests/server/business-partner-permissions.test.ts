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
  updatePermissions?: Array<{ fields?: string[] | null, validation: Record<string, unknown> | null, permissions?: Record<string, unknown> | null }>
}) {
  const { roles = {}, access = [], permissions = [], updatePermissions = [] } = options

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

  it('adds up grants across policies — one supplier grant is enough', async () => {
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

    expect(await resolve()).toEqual({ customer: true, supplier: true })
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
