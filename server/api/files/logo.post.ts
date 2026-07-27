/**
 * Upload a logo — and, when it replaces one, destroy the file it superseded.
 *
 * Directus orphans the old file when an FK moves away from it, and CONNECT users
 * have no `delete` on `directus_files`, so a browser cannot clean up after
 * itself. This route owns the whole transaction instead:
 *
 *   1. upload the new file AS THE USER   (`uploaded_by` = the real person)
 *   2. repoint the record's FK AS THE USER (Directus enforces who may edit it)
 *   3. delete the superseded file AS THE SERVICE (the only credential that can)
 *
 * Omitting `recordId` *stages* an upload for a record that doesn't exist yet (the
 * create-customer/supplier flow); `DELETE /api/files/logo` discards it if the
 * user walks away.
 *
 * Body: multipart/form-data — `file`, `collection`, and optionally `recordId`.
 */

import { AuthError, extractBearerToken, requireAuthenticatedUser } from '../../utils/auth'
import { enforceRateLimit, RateLimitError } from '../../utils/rateLimit'
import {
  LogoFileError,
  assertLogoCollection,
  assertUploadIsAllowed,
  deleteSupersededFile,
  readCurrentLogoId,
  repointRecordLogo,
  uploadLogoAsUser,
  type UploadPart,
} from '../../utils/logoFiles'

// Generous for someone swapping a logo a few times; low enough that a runaway
// client can't fill the file library.
const RATE_LIMIT_REQUESTS = 30
const RATE_LIMIT_WINDOW_MS = 60 * 1000

interface LogoUploadResponse {
  fileId: string
}

export default defineEventHandler(async (event): Promise<LogoUploadResponse> => {
  let user
  try {
    user = await requireAuthenticatedUser(event)
  } catch (error) {
    if (error instanceof AuthError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
  // Present by definition — requireAuthenticatedUser just validated it.
  const userToken = extractBearerToken(event) as string

  try {
    await enforceRateLimit({
      key: `files:logo:${user.id}`,
      limit: RATE_LIMIT_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    })
  } catch (error) {
    if (error instanceof RateLimitError) {
      setResponseHeader(event, 'Retry-After', Number(error.retryAfterSeconds))
      throw createError({ statusCode: 429, statusMessage: error.message })
    }
    throw error
  }

  const parts = await readMultipartFormData(event)
  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: 'Expected multipart/form-data.' })
  }

  const field = (name: string) => parts.find((part) => part.name === name && !part.filename)
  const filePart = parts.find((part) => part.name === 'file' && part.filename)
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: 'No file was provided.' })
  }

  const recordIdRaw = field('recordId')?.data.toString().trim()
  const recordId = recordIdRaw || null

  try {
    const collection = assertLogoCollection(field('collection')?.data.toString().trim())
    const upload: UploadPart = {
      data: filePart.data,
      filename: filePart.filename ?? 'logo',
      type: filePart.type ?? '',
    }
    assertUploadIsAllowed(upload)

    // Read the outgoing logo BEFORE anything is written, as the user — this also
    // proves they can see the record before we upload on their behalf.
    const supersededFileId = recordId
      ? await readCurrentLogoId(userToken, collection, recordId)
      : null

    const fileId = await uploadLogoAsUser(userToken, upload, collection)

    // Staged upload: no record to attach it to yet. The client holds the id and
    // either saves it onto the new record or discards it.
    if (!recordId) {
      return { fileId }
    }

    try {
      await repointRecordLogo(userToken, collection, recordId, fileId)
    } catch (error) {
      // The FK never moved, so the upload is dead weight — take it back out.
      await deleteSupersededFile(fileId)
      throw error
    }

    // The FK now points at the new file, so the old one is unreachable. Cleanup
    // failures are logged, never fatal: the user's change succeeded.
    if (supersededFileId && supersededFileId !== fileId) {
      await deleteSupersededFile(supersededFileId)
    }

    return { fileId }
  } catch (error) {
    if (error instanceof LogoFileError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
