/**
 * Remove a logo, or discard an upload that was never attached to anything.
 *
 * Both paths end in a file deletion, which CONNECT users cannot perform (no
 * `delete` on `directus_files`) — so, like the upload route, this one clears the
 * FK as the user and destroys the file as the service.
 *
 * Body (JSON), one of:
 *   { collection, recordId } — clear the record's logo, then delete the old file.
 *   { fileId }               — discard a staged upload (create flow: the user
 *                              picked a logo, then re-picked or walked away).
 *
 * The discard path is the dangerous one — a raw "delete this file id" primitive —
 * so it is fenced twice: the file must be referenced by nothing, and it must be
 * one the caller uploaded. That way it can only ever destroy the caller's own
 * dangling upload, never a logo in use or someone else's file.
 */

import { AuthError, extractBearerToken, requireAuthenticatedUser } from '../../utils/auth'
import { enforceRateLimit, RateLimitError } from '../../utils/rateLimit'
import {
  LogoFileError,
  assertLogoCollection,
  deleteFileAsService,
  deleteSupersededFile,
  isFileReferenced,
  readCurrentLogoId,
  readFileUploader,
  repointRecordLogo,
} from '../../utils/logoFiles'

const RATE_LIMIT_REQUESTS = 30
const RATE_LIMIT_WINDOW_MS = 60 * 1000

interface LogoDeleteBody {
  collection?: string
  recordId?: string | number
  fileId?: string
}

export default defineEventHandler(async (event): Promise<{ ok: true }> => {
  let user
  try {
    user = await requireAuthenticatedUser(event)
  } catch (error) {
    if (error instanceof AuthError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
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

  const body = await readBody<LogoDeleteBody>(event)

  try {
    // Discard path — a staged upload with no record behind it.
    if (body?.fileId && !body?.recordId) {
      const fileId = String(body.fileId)

      if (await isFileReferenced(fileId)) {
        throw new LogoFileError('That file is in use and cannot be discarded.', 409)
      }
      const uploadedBy = await readFileUploader(fileId)
      if (uploadedBy !== user.id) {
        throw new LogoFileError('You can only discard your own uploads.', 403)
      }

      await deleteFileAsService(fileId)
      return { ok: true }
    }

    // Removal path — clear the record's logo, then destroy what it pointed at.
    const collection = assertLogoCollection(body?.collection)
    const recordId = String(body?.recordId ?? '').trim()
    if (!recordId) {
      throw new LogoFileError('recordId is required.', 400)
    }

    const supersededFileId = await readCurrentLogoId(userToken, collection, recordId)
    await repointRecordLogo(userToken, collection, recordId, null)

    if (supersededFileId) {
      await deleteSupersededFile(supersededFileId)
    }
    return { ok: true }
  } catch (error) {
    if (error instanceof LogoFileError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
