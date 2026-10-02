
import WebSocket from 'ws'
import { fetchProviderCredentials } from './providerConfig'
import type { PromptMessage } from './promptRegistry'
import { fetchPromptMessages } from './promptRegistry'


const AI_PROVIDER_CODE = 'gpt-4.1-mini'
const API_KEY_ENV_VAR = 'NUXT_OPENAI_API_KEY'


const DEFAULT_REALTIME_MODEL = 'gpt-4o-mini-transcribe'

const DEFAULT_PREVIEW_MODEL = 'gpt-live-transcribe'

/** Values in the provider row that mean "run without a preview leg". */
const PREVIEW_OFF = new Set(['off', 'none', 'false'])

const DEFAULT_MAX_TURN_MS = 300000
const DEFAULT_TRANSCRIPTION_LANGUAGE = 'en'
const REALTIME_PATH = '/realtime?intent=transcription'

/**
 * Slug of the AI Improve brief in SupplyHub's prompt registry. The wording lives
 * there, in `prompts` — not in this file and not in `providers.api_config`.
 */
const NOTES_IMPROVE_PROMPT_SLUG = 'notes-improve'

/** `activities.subject` is varchar(100); a longer suggestion cannot be saved. */
const MAX_SUBJECT_LENGTH = 100

const CHAT_PATH = '/chat/completions'


export class OpenAiError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 500) {
    super(message)
    this.name = 'OpenAiError'
    this.statusCode = statusCode
  }
}

interface OpenAiConfig {
  apiRoot: string
  apiKey: string
  chatModel: string
  transcriptionPrompt: string
  transcriptionLanguage: string
  realtimeModel: string
  previewModel: string
  maxTurnMs: number
}

/**
 * @returns the preview model, or an empty string to run without a preview leg.
 */
function resolvePreviewModel(raw: unknown): string {
  const model = String(raw ?? '').trim()
  if (!model) {
    return DEFAULT_PREVIEW_MODEL
  }
  return PREVIEW_OFF.has(model.toLowerCase()) ? '' : model
}

/** The sample rate the realtime session runs at; the client must record at it. */
export const REALTIME_SAMPLE_RATE = 24000

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}


/**
 *
 * @returns the API root, or an empty string when the row names no usable URL.
 */
function resolveApiRoot(baseUrl: string): string {
  const trimmed = String(baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!trimmed) {
    return ''
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return ''
  }

  const VERSION_SEGMENT = /^v\d+$/
  const version = parsed.pathname.split('/').find((segment) => VERSION_SEGMENT.test(segment))
  return version ? `${parsed.origin}/${version}` : parsed.origin
}

/**
 * Endpoint, key and models for both calls, all read from SupplyHub.
 *
 * @throws {OpenAiError} 503 when the provider row is missing, unreadable, or
 *         names no usable endpoint — saying so beats a 401 from OpenAI.
 */
async function loadConfig(): Promise<OpenAiConfig> {
  const provider = await fetchProviderCredentials(AI_PROVIDER_CODE, {
    fallbackApiKeyEnvVar: API_KEY_ENV_VAR,
  })

  // No silent fallback: SupplyHub owns this configuration, so a missing or
  // unreadable row is a real misconfiguration and says so rather than quietly
  // running on different settings than the platform is configured for.
  if (!provider) {
    throw new OpenAiError(
      `The "${AI_PROVIDER_CODE}" provider is not configured in SupplyHub, `
      + `or no API key was found in ${API_KEY_ENV_VAR}.`,
      503,
    )
  }

  const apiRoot = resolveApiRoot(provider.baseUrl)
  if (!apiRoot) {
    throw new OpenAiError(
      `The "${AI_PROVIDER_CODE}" provider in SupplyHub has no usable API base URL.`,
      503,
    )
  }

  const config = provider.config
  return {
    apiRoot,
    apiKey: provider.apiKey,
    // The row's own code is the model id — it is an entry in SupplyHub's "AI
    // Models" group — so an explicit `chatModel` is only needed to override it.
    chatModel: String(config?.chatModel ?? '').trim() || AI_PROVIDER_CODE,
    transcriptionPrompt: String(config?.transcriptionPrompt ?? '').trim(),
    transcriptionLanguage: String(config?.transcriptionLanguage ?? '').trim()
      || DEFAULT_TRANSCRIPTION_LANGUAGE,
    realtimeModel: String(config?.realtimeTranscriptionModel ?? '').trim()
      || DEFAULT_REALTIME_MODEL,
    previewModel: resolvePreviewModel(config?.realtimePreviewModel),
    maxTurnMs: Number(config?.maxTurnMs) > 0
      ? Number(config?.maxTurnMs)
      : DEFAULT_MAX_TURN_MS,
  }
}


/**
 * One chat completion against the configured model.
 *
 * @param promptMessages the registry messages, verbatim and in order, followed
 *        by the notes to work on — so a prompt can carry few-shot turns, not
 *        just a system brief, without this code needing to know.
 * @throws {OpenAiError} when OpenAI is unreachable or refuses.
 */
async function requestCompletion(
  config: OpenAiConfig,
  promptMessages: PromptMessage[],
  notes: string,
  responseFormat: Record<string, unknown>,
  unreachableMessage: string,
  refusedMessage: string,
): Promise<string> {
  let response: Response
  try {
    response = await fetch(`${config.apiRoot}${CHAT_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.chatModel,
        // Near-zero: the job is punctuation and paragraphing, where creative
        // variation is only a chance to drift from what was actually said.
        temperature: 0.2,
        response_format: responseFormat,
        messages: [...promptMessages, { role: 'user', content: notes }],
      }),
    })
  } catch (error) {
    throw new OpenAiError(`${unreachableMessage}: ${(error as Error).message}`, 502)
  }

  const payload = (await response.json().catch(() => null)) as ChatResponse | null

  if (!response.ok) {
    const detail = payload?.error?.message || `${refusedMessage} (${response.status}).`
    throw new OpenAiError(detail, response.status === 401 ? 502 : response.status)
  }

  return String(payload?.choices?.[0]?.message?.content ?? '').trim()
}

/** What one Improve call produces. */
export interface ImprovedNote {
  notes: string
  /** Empty when a subject was not asked for. */
  subject: string
}

function buildResponseFormat(withSubject: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = { notes: { type: 'string' } }
  if (withSubject) {
    properties.subject = { type: 'string' }
  }
  return {
    type: 'json_schema',
    json_schema: {
      name: 'improved_activity_note',
      strict: true,
      schema: {
        type: 'object',
        properties,
        required: Object.keys(properties),
        additionalProperties: false,
      },
    },
  }
}

function normalizeSubject(raw: string): string {
  const cleaned = String(raw ?? '').replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0].trim()
  if (cleaned.length <= MAX_SUBJECT_LENGTH) {
    return cleaned
  }
  const cut = cleaned.slice(0, MAX_SUBJECT_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  // No space to cut at means one very long token; the hard slice is all there is.
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()
}

/**
 * "AI Improve" — turn dictated activity notes into clean written notes.

 * @param notes the raw notes to rewrite.
 * @returns the rewritten notes. Falls back to the input unchanged if the model
 *          answers empty — returning nothing would wipe the user's notes.
 * @throws {OpenAiError} when OpenAI is unconfigured or refuses.
 */
export async function improveNotes(notes: string, withSubject = false): Promise<ImprovedNote> {
  const config = await loadConfig()

  const promptMessages = await fetchPromptMessages(NOTES_IMPROVE_PROMPT_SLUG)
  if (!promptMessages) {
    throw new OpenAiError(
      `AI Improve is not configured: SupplyHub has no prompt with slug "${NOTES_IMPROVE_PROMPT_SLUG}", `
      + 'or it carries no messages.',
      503,
    )
  }

  const raw = await requestCompletion(
    config,
    promptMessages,
    notes,
    buildResponseFormat(withSubject),
    'Could not reach the AI Improve service',
    'Could not improve the notes',
  )

  // Structured Outputs guarantees the shape, but a refusal or a truncated reply
  // can still arrive — falling back to the notes unchanged beats wiping them.
  let parsed: { notes?: string, subject?: string }
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[openai] AI Improve returned unparseable JSON; keeping the notes as they were.')
    return { notes, subject: '' }
  }

  return {
    notes: String(parsed.notes ?? '').trim() || notes,
    subject: withSubject ? normalizeSubject(parsed.subject ?? '') : '',
  }
}

/**
 * @param withPrompt whether to send the vocabulary brief. Only the leg that is
 *        the text of record needs it — the preview model ignores it.
 * @returns a socket that emits OpenAI realtime events. The caller owns closing it.
 */
function openTranscriptionLeg(config: OpenAiConfig, model: string, withPrompt: boolean): WebSocket {
  // Derived from the row's own base URL, so pointing SupplyHub at a different
  // host moves this too rather than leaving a hardcoded endpoint behind.
  const url = `${config.apiRoot.replace(/^http/, 'ws')}${REALTIME_PATH}`

  const socket = new WebSocket(url, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  })

  socket.once('open', () => {
    socket.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: REALTIME_SAMPLE_RATE },
            transcription: {
              model,
              ...(withPrompt && config.transcriptionPrompt
                ? { prompt: config.transcriptionPrompt }
                : {}),
              ...(config.transcriptionLanguage
                ? { language: config.transcriptionLanguage }
                : {}),
            },
            turn_detection: null,
          },
        },
      },
    }))
  })

  return socket
}
export interface RealtimeTranscription {
  transcriptionPrompt: string
  transcript: WebSocket
  preview: WebSocket | null
  language: string
  maxTurnMs: number
}

/**
 * @throws {OpenAiError} when the provider is not configured.
 */
export async function openRealtimeTranscription(): Promise<RealtimeTranscription> {
  const config = await loadConfig()

  return {
    transcript: openTranscriptionLeg(config, config.realtimeModel, true),
    preview: config.previewModel
      ? openTranscriptionLeg(config, config.previewModel, false)
      : null,
    transcriptionPrompt: config.transcriptionPrompt,
    language: config.transcriptionLanguage,
    maxTurnMs: config.maxTurnMs,
  }
}
