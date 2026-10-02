/**
 * Attach one supporting file to a request filed by `POST /api/requests`
 * (CONNECT-832).
 *
 * One file per call, so the drawer can report Pending → Uploaded / Error per row
 * exactly as the design shows, and a single bad file doesn't sink the others.
 *
 * `taskGid` is supplied by the client, which is safe by construction: the
 * server-side credential only permits writes to the tracker, and an attachment's
 * blast radius is one file on one task — but the caller must still be an
 * authenticated Connect user, so the endpoint isn't an anonymous upload sink.
 *
 * Body: multipart/form-data — `taskGid` and `file`.
 */

import { AuthError, requireAuthenticatedUser } from '../../utils/auth'
import { enforceRateLimit, RateLimitError } from '../../utils/rateLimit'
import {
  AsanaError,
  assertAttachmentIsAllowed,
  attachFileToTask,
  type AttachmentPart,
} from '../../utils/asana'

// Task gids are numeric strings; anything else is a malformed client.
const TASK_GID_PATTERN = /^\d+$/

// Generous enough for a request carrying a handful of screenshots, low enough
// that a runaway client can't hammer the tracker on our credential.
const RATE_LIMIT_REQUESTS = 30
const RATE_LIMIT_WINDOW_MS = 60 * 1000

interface AttachmentResponse {
  attachmentGid: string
}

export default defineEventHandler(async (event): Promise<AttachmentResponse> => {
  let user
  try {
    user = await requireAuthenticatedUser(event)
  } catch (error) {
    if (error instanceof AuthError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }

  try {
    await enforceRateLimit({
      key: `requests:attachments:${user.id}`,
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

  const taskGid = parts
    .find((part) => part.name === 'taskGid' && !part.filename)
    ?.data.toString().trim() ?? ''
  const filePart = parts.find((part) => part.name === 'file' && part.filename)

  if (!TASK_GID_PATTERN.test(taskGid)) {
    throw createError({ statusCode: 400, statusMessage: 'A valid task id is required.' })
  }
  if (!filePart) {
    throw createError({ statusCode: 400, statusMessage: 'No file was provided.' })
  }

  try {
    const attachment: AttachmentPart = {
      data: filePart.data,
      filename: filePart.filename ?? 'attachment',
      type: filePart.type ?? '',
    }
    assertAttachmentIsAllowed(attachment)
    const attachmentGid = await attachFileToTask(taskGid, attachment)
    return { attachmentGid }
  } catch (error) {
    if (error instanceof AsanaError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
