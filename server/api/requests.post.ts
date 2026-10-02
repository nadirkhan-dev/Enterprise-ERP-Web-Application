/**
 * File a tool / feature / bug request from the app (CONNECT-832).
 *
 * The route is deliberately generic: callers submit a "request" and get back a
 * request id. Where that request actually lands — currently an Asana task in the
 * CONNECT project's Backlog — is an implementation detail owned by
 * `server/utils/asana.ts`, so the tracker can be swapped without touching the
 * client. The Asana credential is server-side only, which is why this route is
 * the sole way the app can file a request.
 *
 * The caller is authenticated against Directus first: an unauthenticated endpoint
 * here would be an open write into the team's backlog.
 *
 * Returns the new task's id so the client can follow up with
 * `POST /api/requests/attachments` for each supporting file — an attachment
 * cannot be stored before the task it belongs to exists.
 *
 * Body: JSON — `kind` ('tool' | 'feature' | 'bug'), `title`, `description`, and
 * optionally `sourceUrl` (the app route the request was filed from).
 */

import { AuthError, extractBearerToken, requireAuthenticatedUser } from '../utils/auth'
import { enforceRateLimit, RateLimitError } from '../utils/rateLimit'
import {
  AsanaError,
  assertRequestKind,
  createRequestTask,
  readSubmitterIdentity,
} from '../utils/asana'

// Mirrors the forms' own soft limits so an oversized body can't be smuggled past
// the UI into the backlog.
const MAX_TITLE_LENGTH = 50
const MAX_DESCRIPTION_LENGTH = 1000

// A handful of requests a minute is plenty for a human; past that it's a runaway
// client or someone spamming the dev team's backlog.
const RATE_LIMIT_REQUESTS = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000

interface RequestBody {
  kind?: string
  title?: string
  description?: string
  sourceUrl?: string
}

interface RequestResponse {
  taskGid: string
  permalinkUrl: string | null
}

export default defineEventHandler(async (event): Promise<RequestResponse> => {
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
      key: `requests:create:${user.id}`,
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

  const body = await readBody<RequestBody>(event)
  const title = body?.title?.trim() || ''
  const description = body?.description?.trim() || ''
  const sourceUrl = body?.sourceUrl?.trim() || null

  if (!title || !description) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A title and a description are both required.',
    })
  }
  if (title.length > MAX_TITLE_LENGTH || description.length > MAX_DESCRIPTION_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Title must be ${MAX_TITLE_LENGTH} characters or fewer and description ${MAX_DESCRIPTION_LENGTH} or fewer.`,
    })
  }

  try {
    const kind = assertRequestKind(body?.kind)
    const submitter = await readSubmitterIdentity(userToken)
    const task = await createRequestTask({
      kind,
      title,
      description,
      submitter,
      sourceUrl,
      submittedAt: new Date().toISOString(),
    })
    return { taskGid: task.gid, permalinkUrl: task.permalinkUrl }
  } catch (error) {
    if (error instanceof AsanaError) {
      // A 5xx here means the request never reached the backlog, so surface it
      // and let the user retry rather than reporting a false success.
      if (error.statusCode >= 500) {
        console.error('Failed to file request:', error.message)
      }
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
