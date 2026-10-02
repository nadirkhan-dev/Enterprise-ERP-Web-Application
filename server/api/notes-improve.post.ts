/**
 * "AI Improve" — rewrite dictated notes into readable prose.
 *
 * The AI Improve button beside the microphone on a notes field posts the current
 * notes here; the route hands them to OpenAI's chat-completions endpoint (see
 * `server/utils/openai.ts`) and returns the rewrite. As with transcription, the
 * client never holds the OpenAI key, so this route is the only way the app can
 * reach it.
 *
 * Improve is punctuation and paragraphing only — never a summary that drops
 * detail, and never new information (the prompt lives with the model call). The
 * result is returned to the field as editable text and nothing is persisted
 * here: whatever the user keeps is saved by the drawer's own save.
 *
 * Body: JSON — `notes`.
 */

import { AuthError, requireAuthenticatedUser } from '../utils/auth'
import { enforceRateLimit, RateLimitError } from '../utils/rateLimit'
import { improveNotes, OpenAiError } from '../utils/openai'

// Mirrors the notes field's own soft limit, so an oversized body can't be
// smuggled past the UI into a large model spend.
const MAX_NOTES_LENGTH = 5000

// Improving is a deliberate, one-at-a-time press; a few a minute is human pace
// and caps what a runaway client can spend on our OpenAI credential.
const RATE_LIMIT_REQUESTS = 15
const RATE_LIMIT_WINDOW_MS = 60 * 1000

interface NotesImproveBody {
  notes?: string
  /**
   * Whether the caller's Subject field is empty. A subject is only asked for
   * when it is, so one the user already wrote is never spent tokens on and never
   * at risk of being replaced.
   */
  needsSubject?: boolean
}

interface NotesImproveResponse {
  notes: string
  /** Empty unless a subject was asked for and one could be made. */
  subject: string
}

export default defineEventHandler(async (event): Promise<NotesImproveResponse> => {
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
      key: `notes-improve:${user.id}`,
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

  const body = await readBody<NotesImproveBody>(event)
  const notes = String(body?.notes ?? '').trim()

  if (!notes) {
    throw createError({ statusCode: 400, statusMessage: 'There are no notes to improve.' })
  }
  if (notes.length > MAX_NOTES_LENGTH) {
    throw createError({
      statusCode: 400,
      statusMessage: `Notes are limited to ${MAX_NOTES_LENGTH} characters.`,
    })
  }

  try {
    // One call produces both: the same rewrite pass that cleans the notes names
    // them, and Structured Outputs keeps the two apart in the reply.
    return await improveNotes(notes, Boolean(body?.needsSubject))
  } catch (error) {
    if (error instanceof OpenAiError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
