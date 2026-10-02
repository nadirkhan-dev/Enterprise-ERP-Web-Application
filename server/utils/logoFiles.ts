/**
 * Server-side logo file handling (Directus `directus_files`).
 *
 * Directus does not delete a file when a reference moves away from it: repointing
 * a logo at a new upload orphans the old file in both `directus_files` and
 * storage. CONNECT team members hold only `create` + `read` on files — never
 * `update`/`delete` — so a browser cannot clean up after itself even if it tried.
 * The cleanup obligation therefore lands here.
 *
 * The split, which the routes in `server/api/files/` depend on:
 *
 *   upload + FK repoint  → the CALLER's token, so `uploaded_by` stays honest and
 *                          Directus keeps enforcing who may edit which record.
 *   delete               → the SERVICE token, the only credential that may
 *                          destroy a file.
 */

const MAX_LOGO_BYTES = 10 * 1024 * 1024

// PNG/JPEG/WebP/GIF only. SVG is deliberately excluded: assets are proxied under
// the app's own origin (`/directus/**`), so an SVG logo is served same-origin and
// its embedded script would run as us — stored XSS via the logo picker.
const ALLOWED_LOGO_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/**
 * The only collections/fields a client may aim a logo write at. A route must
 * never take a collection or field name from the request body unchecked —
 * that would be an arbitrary-FK-write primitive over the whole schema.
 */
export const LOGO_TARGETS = {
  business_partners: { field: 'logo_id', folder: 'Business Partners' },
  manufacturers: { field: 'logo_id', folder: 'Manufacturers' },
} as const

export type LogoCollection = keyof typeof LOGO_TARGETS

export class LogoFileError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'LogoFileError'
    this.statusCode = statusCode
  }
}

export interface UploadPart {
  data: Buffer
  filename: string
  type: string
}

function getDirectusConfig(): { url: string, serviceToken: string } {
  const runtime = useRuntimeConfig()
  const url = String(runtime.directusUrl || '').replace(/\/$/, '')
  const serviceToken = String(runtime.directusToken || '')
  if (!url || !serviceToken) {
    throw new LogoFileError('Directus is not configured (DIRECTUS_URL / NUXT_DIRECTUS_TOKEN missing).', 500)
  }
  return { url, serviceToken }
}

async function readDirectusError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { errors?: Array<{ message?: string }> }
    return payload?.errors?.[0]?.message || fallback
  } catch {
    return fallback
  }
}

/** Narrow an untrusted collection name to a whitelisted logo target. */
export function assertLogoCollection(value: unknown): LogoCollection {
  if (typeof value === 'string' && value in LOGO_TARGETS) {
    return value as LogoCollection
  }
  throw new LogoFileError(`Unsupported collection: ${String(value)}`, 400)
}

/** Reject anything that isn't a reasonably sized raster image. */
export function assertUploadIsAllowed(part: UploadPart): void {
  if (!ALLOWED_LOGO_MIME.has(part.type)) {
    throw new LogoFileError(`Unsupported file type: ${part.type || 'unknown'}. Use PNG, JPEG, WebP or GIF.`, 415)
  }
  if (part.data.length > MAX_LOGO_BYTES) {
    throw new LogoFileError(`File is too large (max ${MAX_LOGO_BYTES / 1024 / 1024} MB).`, 413)
  }
}

// Folder UUIDs differ between environments (dev/prod); folder NAMES don't, so the
// whitelist above pins names and they're resolved to ids here, once per process.
const folderIdCache = new Map<string, string | null>()

async function resolveFolderId(name: string): Promise<string | null> {
  if (folderIdCache.has(name)) {
    return folderIdCache.get(name) ?? null
  }
  const { url, serviceToken } = getDirectusConfig()
  const target = new URL(`${url}/folders`)
  target.searchParams.set('filter[name][_eq]', name)
  target.searchParams.set('fields', 'id')
  target.searchParams.set('limit', '1')

  const response = await fetch(target, { headers: { Authorization: `Bearer ${serviceToken}` } })
  if (!response.ok) {
    // A missing folder must not block the upload — the file lands at the library
    // root instead, which is recoverable; a failed upload isn't.
    console.error(`Could not resolve file folder "${name}" (${response.status})`)
    return null
  }
  const payload = await response.json() as { data?: Array<{ id: string }> }
  const id = payload.data?.[0]?.id ?? null
  folderIdCache.set(name, id)
  return id
}

/**
 * Upload a file to Directus AS THE CALLER, so `uploaded_by` records the real
 * person rather than the service account. Returns the new file's id.
 */
export async function uploadLogoAsUser(
  userToken: string,
  part: UploadPart,
  collection: LogoCollection,
): Promise<string> {
  const { url } = getDirectusConfig()
  const folderId = await resolveFolderId(LOGO_TARGETS[collection].folder)

  const form = new FormData()
  // Metadata must be appended BEFORE the file part — Directus applies only the
  // fields it has already seen when the file stream arrives.
  if (folderId) {
    form.append('folder', folderId)
  }
  // Copy the Buffer into a plain Uint8Array — a Node Buffer may sit on a
  // SharedArrayBuffer, which Blob won't take.
  form.append('file', new Blob([Uint8Array.from(part.data)], { type: part.type }), part.filename)

  const response = await fetch(`${url}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${userToken}` },
    body: form,
  })
  if (!response.ok) {
    throw new LogoFileError(
      await readDirectusError(response, `Upload failed (${response.status})`),
      response.status === 401 || response.status === 403 ? 403 : 502,
    )
  }
  const payload = await response.json() as { data?: { id?: string } }
  const fileId = payload.data?.id
  if (!fileId) {
    throw new LogoFileError('Upload succeeded but returned no file id.', 502)
  }
  return fileId
}

/** Read a record's current logo file id, AS THE CALLER (so read rules apply). */
export async function readCurrentLogoId(
  userToken: string,
  collection: LogoCollection,
  recordId: string,
): Promise<string | null> {
  const { url } = getDirectusConfig()
  const field = LOGO_TARGETS[collection].field
  const response = await fetch(
    `${url}/items/${collection}/${encodeURIComponent(recordId)}?fields=${field}`,
    { headers: { Authorization: `Bearer ${userToken}` } },
  )
  if (response.status === 403 || response.status === 401) {
    throw new LogoFileError('You do not have access to that record.', 403)
  }
  if (response.status === 404) {
    throw new LogoFileError('Record not found.', 404)
  }
  if (!response.ok) {
    throw new LogoFileError(await readDirectusError(response, `Record read failed (${response.status})`), 502)
  }
  const payload = await response.json() as { data?: Record<string, string | null> }
  return payload.data?.[field] ?? null
}

/**
 * Point a record's logo FK at `fileId` (or null to clear), AS THE CALLER — so
 * Directus, not this route, decides whether they're allowed to.
 */
export async function repointRecordLogo(
  userToken: string,
  collection: LogoCollection,
  recordId: string,
  fileId: string | null,
): Promise<void> {
  const { url } = getDirectusConfig()
  const field = LOGO_TARGETS[collection].field
  const response = await fetch(`${url}/items/${collection}/${encodeURIComponent(recordId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${userToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ [field]: fileId }),
  })
  if (response.status === 401 || response.status === 403) {
    throw new LogoFileError('You do not have permission to change this logo.', 403)
  }
  if (!response.ok) {
    throw new LogoFileError(await readDirectusError(response, `Could not update the record (${response.status})`), 502)
  }
}

/** Destroy a file. The service token is the only credential that may do this. */
export async function deleteFileAsService(fileId: string): Promise<void> {
  const { url, serviceToken } = getDirectusConfig()
  const response = await fetch(`${url}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serviceToken}` },
  })
  // Already gone is a success as far as the caller is concerned.
  if (response.status === 404) {
    return
  }
  if (!response.ok) {
    throw new LogoFileError(await readDirectusError(response, `Could not delete file (${response.status})`), 502)
  }
}

/**
 * Delete the file a reference was just moved away from. Never throws: the FK is
 * already repointed and that must stand — a stale file is a cleanup miss to log,
 * not a reason to fail the user's action or roll back a successful write.
 */
export async function deleteSupersededFile(fileId: string): Promise<void> {
  try {
    await deleteFileAsService(fileId)
  } catch (error) {
    console.error(`Orphaned file ${fileId}: cleanup failed — ${(error as Error).message}`)
  }
}

/** True if any whitelisted logo FK still points at this file. */
export async function isFileReferenced(fileId: string): Promise<boolean> {
  const { url, serviceToken } = getDirectusConfig()
  const checks = Object.entries(LOGO_TARGETS).map(async ([collection, { field }]) => {
    const target = new URL(`${url}/items/${collection}`)
    target.searchParams.set(`filter[${field}][_eq]`, fileId)
    target.searchParams.set('fields', 'id')
    target.searchParams.set('limit', '1')
    const response = await fetch(target, { headers: { Authorization: `Bearer ${serviceToken}` } })
    if (!response.ok) {
      // Fail closed: if we can't prove the file is unused, don't delete it.
      throw new LogoFileError(`Reference check failed (${response.status})`, 502)
    }
    const payload = await response.json() as { data?: unknown[] }
    return (payload.data?.length ?? 0) > 0
  })
  const results = await Promise.all(checks)
  return results.some(Boolean)
}

/** The user id that uploaded a file, per Directus. */
export async function readFileUploader(fileId: string): Promise<string | null> {
  const { url, serviceToken } = getDirectusConfig()
  const response = await fetch(
    `${url}/files/${encodeURIComponent(fileId)}?fields=uploaded_by`,
    { headers: { Authorization: `Bearer ${serviceToken}` } },
  )
  if (response.status === 404) {
    throw new LogoFileError('File not found.', 404)
  }
  if (!response.ok) {
    throw new LogoFileError(await readDirectusError(response, `File read failed (${response.status})`), 502)
  }
  const payload = await response.json() as { data?: { uploaded_by?: string | null } }
  return payload.data?.uploaded_by ?? null
}
