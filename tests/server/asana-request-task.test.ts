// @ts-nocheck

/**
 * The payload that files a tool / feature / bug request as an Asana task.
 *
 * The item type is the fiddly part: Asana applies a project's default type in
 * the web UI but leaves an API-created task typeless, and it refuses
 * `custom_type` unless `resource_subtype: 'custom'` travels with it — so the
 * three fields are asserted together.
 */
describe('Scenario: Filing a request as a task', () => {
  let asana: typeof import('../../server/utils/asana')
  let createdTaskBody: Record<string, unknown>

  const BASE_CONFIG = {
    asanaAccessToken: 'token-abc',
    asanaProjectGid: 'project-1',
    asanaBacklogSectionGid: 'section-1',
    asanaFeatureRequestTagGid: 'tag-feature',
    asanaBugReportTagGid: 'tag-bug',
    asanaStatusFieldGid: 'field-status',
    asanaBacklogStatusOptionGid: 'option-backlog',
    asanaTaskTypeGid: 'type-todo',
    asanaTaskTypeBacklogStatusGid: 'type-status-backlog',
  }

  const REQUEST = {
    kind: 'feature',
    title: 'Bulk edit items',
    description: 'Editing one at a time is slow.',
    submitter: { name: 'Ada Lovelace', email: 'ada@example.com' },
    sourceUrl: '/items',
    submittedAt: '2026-08-04T12:00:00.000Z',
  }

  function useConfig(overrides = {}) {
    globalThis.useRuntimeConfig = () => ({ ...BASE_CONFIG, ...overrides })
  }

  beforeAll(async () => {
    useConfig()
    asana = await import('../../server/utils/asana')
  })

  beforeEach(() => {
    useConfig()
    createdTaskBody = null
    globalThis.fetch = vi.fn(async (url: string, options) => {
      if (url.includes('/tasks')) {
        createdTaskBody = JSON.parse(options.body).data
        return {
          ok: true,
          status: 201,
          json: async () => ({ data: { gid: 'task-9', permalink_url: 'https://app.asana.com/0/1/9' } }),
        }
      }
      // The follow-up reposition into the top of the Backlog.
      return { ok: true, status: 200, json: async () => ({ data: {} }) }
    })
  })

  it('marks the task as the project\'s custom item type', async () => {
    await asana.createRequestTask(REQUEST)

    // Asana rejects custom_type outright without this subtype.
    expect(createdTaskBody.resource_subtype).toBe('custom')
    expect(createdTaskBody.custom_type).toBe('type-todo')
    expect(createdTaskBody.custom_type_status_option).toBe('type-status-backlog')
  })

  it('files it into the Backlog section with the right tag and Status', async () => {
    await asana.createRequestTask(REQUEST)

    expect(createdTaskBody.name).toBe('Bulk edit items')
    expect(createdTaskBody.projects).toEqual(['project-1'])
    expect(createdTaskBody.memberships).toEqual([{ project: 'project-1', section: 'section-1' }])
    expect(createdTaskBody.tags).toEqual(['tag-feature'])
    expect(createdTaskBody.custom_fields).toEqual({ 'field-status': 'option-backlog' })
  })

  it('omits the type fields entirely in a workspace with no custom types', async () => {
    useConfig({ asanaTaskTypeGid: '', asanaTaskTypeBacklogStatusGid: '' })

    await asana.createRequestTask(REQUEST)

    // Sending resource_subtype: 'custom' with no type would fail the submission.
    expect(createdTaskBody).not.toHaveProperty('resource_subtype')
    expect(createdTaskBody).not.toHaveProperty('custom_type')
    expect(createdTaskBody).not.toHaveProperty('custom_type_status_option')
  })

  it('still types the task when only the type is configured, without a status', async () => {
    useConfig({ asanaTaskTypeBacklogStatusGid: '' })

    await asana.createRequestTask(REQUEST)

    expect(createdTaskBody.resource_subtype).toBe('custom')
    expect(createdTaskBody.custom_type).toBe('type-todo')
    expect(createdTaskBody).not.toHaveProperty('custom_type_status_option')
  })

  it('returns the new task\'s id and permalink', async () => {
    const task = await asana.createRequestTask(REQUEST)

    expect(task).toEqual({ gid: 'task-9', permalinkUrl: 'https://app.asana.com/0/1/9' })
  })

  it('tags a bug report as a bug rather than a feature', async () => {
    await asana.createRequestTask({ ...REQUEST, kind: 'bug' })

    expect(createdTaskBody.tags).toEqual(['tag-bug'])
  })
})
