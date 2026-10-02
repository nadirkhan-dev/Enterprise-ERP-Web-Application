
const ASANA_API_BASE = 'https://app.asana.com/api/1.0'

// Asana caps a single attachment at 100 MB; the request forms advertise 50 MB
// per file, so that is the limit enforced here.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

/**
 * The request kinds a client may submit, and the copy/tag each maps to. A route
 * must never take a tag gid or project gid from the request body — that would
 * let any authenticated user write a task anywhere in the workspace.
 */
export const REQUEST_KINDS = {
  tool: { label: 'Tool Request', tagKey: 'featureRequest' },
  feature: { label: 'Feature Request', tagKey: 'featureRequest' },
  bug: { label: 'Bug Report', tagKey: 'bugReport' },
} as const

export type RequestKind = keyof typeof REQUEST_KINDS

export class AsanaError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 502) {
    super(message)
    this.name = 'AsanaError'
    this.statusCode = statusCode
  }
}

interface AsanaConfig {
  accessToken: string
  projectGid: string
  sectionGid: string
  tagGids: { featureRequest: string, bugReport: string }
  /**
   * The project's `Status` enum field and its "Backlog" option. The CONNECT board
   * tracks status BOTH as a section and as this parallel custom field, and the
   * team's tickets keep the two in sync — so a task dropped in the Backlog section
   * with no Status reads as untriaged next to everything else. Optional: absent
   * config just skips the field rather than failing the submission.
   */
  statusField: { fieldGid: string, backlogOptionGid: string } | null
  taskType: { typeGid: string, statusOptionGid: string | null } | null
}

function getAsanaConfig(): AsanaConfig {
  const runtime = useRuntimeConfig()
  const accessToken = String(runtime.asanaAccessToken || '')
  const projectGid = String(runtime.asanaProjectGid || '')
  const sectionGid = String(runtime.asanaBacklogSectionGid || '')
  const featureRequest = String(runtime.asanaFeatureRequestTagGid || '')
  const bugReport = String(runtime.asanaBugReportTagGid || '')
  const statusFieldGid = String(runtime.asanaStatusFieldGid || '')
  const backlogOptionGid = String(runtime.asanaBacklogStatusOptionGid || '')
  const taskTypeGid = String(runtime.asanaTaskTypeGid || '')
  const taskTypeStatusGid = String(runtime.asanaTaskTypeBacklogStatusGid || '')

  if (!accessToken || !projectGid || !sectionGid || !featureRequest || !bugReport) {
    throw new AsanaError('Asana is not configured — request destination is unavailable.', 500)
  }

  return {
    accessToken,
    projectGid,
    sectionGid,
    tagGids: { featureRequest, bugReport },
    statusField: statusFieldGid && backlogOptionGid
      ? { fieldGid: statusFieldGid, backlogOptionGid }
      : null,
    taskType: taskTypeGid
      ? { typeGid: taskTypeGid, statusOptionGid: taskTypeStatusGid || null }
      : null,
  }
}

/** Narrow an untrusted `kind` from the request body to a known request kind. */
export function assertRequestKind(value: unknown): RequestKind {
  if (typeof value === 'string' && value in REQUEST_KINDS) {
    return value as RequestKind
  }
  throw new AsanaError(`Unsupported request kind: ${String(value)}`, 400)
}

async function readAsanaError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { errors?: Array<{ message?: string }> }
    return payload?.errors?.[0]?.message || fallback
  } catch {
    return fallback
  }
}

export interface SubmitterIdentity {
  name: string
  email: string
}

/**
 * The submitter, read from Directus with the CALLER's own token so the name on
 * the Asana task is the real requester rather than anything the browser claimed.
 */
export async function readSubmitterIdentity(userToken: string): Promise<SubmitterIdentity> {
  const runtime = useRuntimeConfig()
  const directusUrl = String(runtime.directusUrl || '').replace(/\/$/, '')
  if (!directusUrl) {
    throw new AsanaError('Directus URL is not configured (DIRECTUS_URL missing).', 500)
  }

  const response = await fetch(
    `${directusUrl}/users/me?fields=email,first_name,last_name`,
    { headers: { Authorization: `Bearer ${userToken}` } },
  )
  if (!response.ok) {
    throw new AsanaError(`Could not read the submitter's profile (${response.status})`, 502)
  }

  const payload = await response.json() as {
    data?: { email?: string | null, first_name?: string | null, last_name?: string | null }
  }
  const email = payload.data?.email ?? ''
  const fullName = [payload.data?.first_name, payload.data?.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()

  return { name: fullName || email || 'Unknown user', email }
}

/**
 * Asana renders `html_notes` with a strict allowlist and rejects stray markup,
 * so every interpolated value must be escaped — a description containing "<" or
 * "&" would otherwise fail the whole submission.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

interface BuildNotesOptions {
  kind: RequestKind
  description: string
  submitter: SubmitterIdentity
  sourceUrl: string | null
  submittedAt: string
}

/** The task body: the request itself, then provenance the dev team needs. */
function buildTaskNotes(options: BuildNotesOptions): string {
  const { kind, description, submitter, sourceUrl, submittedAt } = options
  const lines = [
    escapeHtml(description),
    '',
    `<b>Submitted by:</b> ${escapeHtml(submitter.name)}${submitter.email ? ` (${escapeHtml(submitter.email)})` : ''}`,
    `<b>Submitted at:</b> ${escapeHtml(submittedAt)}`,
    `<b>Type:</b> ${escapeHtml(REQUEST_KINDS[kind].label)}`,
  ]
  if (sourceUrl) {
    lines.push(`<b>Submitted from:</b> ${escapeHtml(sourceUrl)}`)
  }
  lines.push('', '<i>Created automatically from CONNECT.</i>')
  return `<body>${lines.join('\n')}</body>`
}

export interface CreatedTask {
  gid: string
  permalinkUrl: string | null
}

async function moveTaskToBacklogTop(taskGid: string): Promise<void> {
  try {
    const config = getAsanaConfig()
    const response = await fetch(
      `${ASANA_API_BASE}/sections/${encodeURIComponent(config.sectionGid)}/addTask`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { task: taskGid } }),
      },
    )
    if (!response.ok) {
      console.error(
        `Asana task ${taskGid} filed but not moved to the top of the Backlog `
        + `(${response.status}): ${await readAsanaError(response, 'reposition failed')}`,
      )
    }
  } catch (error) {
    console.error(`Asana task ${taskGid} filed but not repositioned: ${(error as Error).message}`)
  }
}
async function readAsanaUserGidByEmail(email: string): Promise<string | null> {
  const config = getAsanaConfig()

  const response = await fetch(
    `${ASANA_API_BASE}/users/${encodeURIComponent(email)}?opt_fields=gid`,
    { headers: { Authorization: `Bearer ${config.accessToken}` } },
  )
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new AsanaError(
      await readAsanaError(response, `could not look up ${email} (${response.status})`),
    )
  }

  const payload = await response.json() as { data?: { gid?: string } }
  return payload.data?.gid ?? null
}
async function addSubmitterAsCollaborator(
  taskGid: string,
  submitter: SubmitterIdentity,
): Promise<void> {
  if (!submitter.email) {
    return
  }

  try {
    const config = getAsanaConfig()
    const userGid = await readAsanaUserGidByEmail(submitter.email)
    // No Asana seat. The expected case for most staff, so nothing to report.
    if (!userGid) {
      return
    }

    const response = await fetch(
      `${ASANA_API_BASE}/tasks/${encodeURIComponent(taskGid)}/addFollowers`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ data: { followers: [userGid] } }),
      },
    )
    if (!response.ok) {
      console.error(
        `Asana task ${taskGid} filed but ${submitter.email} was not added as a `
        + `collaborator (${response.status}): `
        + `${await readAsanaError(response, 'addFollowers failed')}`,
      )
    }
  } catch (error) {
    console.error(
      `Asana task ${taskGid} filed but ${submitter.email} was not added as a `
      + `collaborator: ${(error as Error).message}`,
    )
  }
}

export interface CreateRequestTaskOptions {
  kind: RequestKind
  title: string
  description: string
  submitter: SubmitterIdentity
  sourceUrl?: string | null
  submittedAt: string
}

/**
 * Create the request as a task in the CONNECT project's Backlog section, tagged
 * per its kind. `memberships` places it in the section in the same call — adding
 * the project alone would drop it in the project's default (untriaged) column.
 */
export async function createRequestTask(options: CreateRequestTaskOptions): Promise<CreatedTask> {
  const { kind, title, description, submitter, sourceUrl = null, submittedAt } = options
  const config = getAsanaConfig()
  const tagGid = config.tagGids[REQUEST_KINDS[kind].tagKey]

  const response = await fetch(`${ASANA_API_BASE}/tasks?opt_fields=permalink_url`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        name: title,
        html_notes: buildTaskNotes({ kind, description, submitter, sourceUrl, submittedAt }),
        projects: [config.projectGid],
        memberships: [{ project: config.projectGid, section: config.sectionGid }],
        tags: [tagGid],
        ...(config.taskType
          ? {
              resource_subtype: 'custom',
              custom_type: config.taskType.typeGid,
              ...(config.taskType.statusOptionGid
                ? { custom_type_status_option: config.taskType.statusOptionGid }
                : {}),
            }
          : {}),
        // Mirrors the section into the parallel Status field, the way the team's
        // existing tickets are kept in sync. Omitted entirely when unconfigured.
        ...(config.statusField
          ? {
              custom_fields: {
                [config.statusField.fieldGid]: config.statusField.backlogOptionGid,
              },
            }
          : {}),
      },
    }),
  })

  if (!response.ok) {
    throw new AsanaError(
      await readAsanaError(response, `Asana rejected the request (${response.status})`),
      response.status === 401 || response.status === 403 ? 502 : 502,
    )
  }

  const payload = await response.json() as { data?: { gid?: string, permalink_url?: string } }
  const gid = payload.data?.gid
  if (!gid) {
    throw new AsanaError('Asana created the task but returned no id.', 502)
  }

  await Promise.all([
    moveTaskToBacklogTop(gid),
    addSubmitterAsCollaborator(gid, submitter),
  ])

  return { gid, permalinkUrl: payload.data?.permalink_url ?? null }
}

export interface AttachmentPart {
  data: Buffer
  filename: string
  type: string
}

/** Reject anything Asana would refuse (or that would blow the size budget). */
export function assertAttachmentIsAllowed(part: AttachmentPart): void {
  if (part.data.length === 0) {
    throw new AsanaError('That file is empty.', 400)
  }
  if (part.data.length > MAX_ATTACHMENT_BYTES) {
    throw new AsanaError(`File is too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB).`, 413)
  }
}

/**
 * Attach a file to an existing task. Asana takes the raw bytes as multipart —
 * there is no URL-reference route that would keep the file where it already is.
 */
export async function attachFileToTask(taskGid: string, part: AttachmentPart): Promise<string> {
  const config = getAsanaConfig()

  const form = new FormData()
  form.append('parent', taskGid)
  // Copy the Buffer into a plain Uint8Array — a Node Buffer may sit on a
  // SharedArrayBuffer, which Blob won't take.
  form.append(
    'file',
    new Blob([Uint8Array.from(part.data)], { type: part.type || 'application/octet-stream' }),
    part.filename,
  )

  const response = await fetch(`${ASANA_API_BASE}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.accessToken}` },
    body: form,
  })

  if (!response.ok) {
    throw new AsanaError(
      await readAsanaError(response, `Could not attach ${part.filename} (${response.status})`),
      response.status === 413 ? 413 : 502,
    )
  }

  const payload = await response.json() as { data?: { gid?: string } }
  return payload.data?.gid ?? ''
}
