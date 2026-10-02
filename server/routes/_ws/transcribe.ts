

import type WebSocket from 'ws'
import { AuthError, authenticateToken } from '../../utils/auth'
import { enforceRateLimit, RateLimitError } from '../../utils/rateLimit'
import { OpenAiError, openRealtimeTranscription, REALTIME_SAMPLE_RATE } from '../../utils/openai'

// A dictation session is long-lived, so this caps how many a single user can
// start per minute rather than how much they can say.
const RATE_LIMIT_SESSIONS = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000

const NON_LATIN = /[^\u0000-\u024F\u2000-\u206F\u20A0-\u20CF]/g

/**
 * Languages written in a script this guard would wrongly strip. Anything else —
 * including an unset language — keeps the Latin filter on.
 */
const NON_LATIN_LANGUAGES = new Set([
  'ar', 'fa', 'ur', 'he', 'zh', 'ja', 'ko', 'hi', 'bn', 'ta', 'te',
  'th', 'ru', 'uk', 'bg', 'sr', 'el', 'hy', 'ka', 'am',
])

function isLatinScriptLanguage(language: string): boolean {
  const code = language.toLowerCase().split('-')[0].trim()
  return !NON_LATIN_LANGUAGES.has(code)
}

/**
 * @returns the cleaned text, or an empty string when nothing legible survives.
 */
function keepSessionScript(text: string, language: string): string {
  if (!isLatinScriptLanguage(language)) {
    return text
  }
  return /[a-z0-9]/i.test(text.replace(NON_LATIN, '')) ? text : ''
}

const HALLUCINATED_SEGMENTS = new Set([
  // Sign-offs from captioned video, which is what these models were trained on.
  // Deliberately NOT "thank you", "thanks", "bye" or "okay": a rep may genuinely
  // say those, and dropping real speech is the worse failure of the two.
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'subscribe',
  'you',
  '.',
  '...',
])

/** Whether a finished utterance is nothing but a stock phrase. */
function isHallucinatedSegment(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!normalized) { return false }
  // Compared with and without trailing punctuation, since the model varies it.
  return HALLUCINATED_SEGMENTS.has(normalized)
    || HALLUCINATED_SEGMENTS.has(normalized.replace(/[.!?]+$/, ''))
}

/** The leg whose transcripts are the text of record, per connected peer. */
const transcriptSockets = new Map<string, WebSocket>()

/** The leg streaming words as they are spoken; absent when it is not running. */
const previewSockets = new Map<string, WebSocket>()

/** Session language per peer, for the script guard. */
const languages = new Map<string, string>()

const sinceCommitMs = new Map<string, number>()

const maxTurns = new Map<string, number>()

const turnIndexes = new Map<string, number>()

const pendingFinalTurns = new Map<string, number[]>()
const hasSpeech = new Map<string, boolean>()
const previewTextByTurn = new Map<string, Map<number, string>>()
const PREVIEW_LAG_MS = 5000

const prompts = new Map<string, string>()

function normalizeWords(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function isPromptEcho(text: string, prompt: string): boolean {
  const spoken = normalizeWords(text)
  if (!prompt || spoken.split(' ').length < 3) {
    return false
  }
  return normalizeWords(prompt).includes(spoken)
}

/** Legs that have reported their configuration accepted, per peer. */
const readyLegs = new Map<string, number>()

/** How many legs a peer is waiting on before it can forward audio. */
const expectedLegs = new Map<string, number>()

/** PCM16 mono: two bytes per sample. */
function frameDurationMs(base64Audio: string): number {
  // base64 encodes 3 bytes per 4 characters; padding is negligible per frame.
  const bytes = (base64Audio.length * 3) / 4
  return (bytes / 2 / REALTIME_SAMPLE_RATE) * 1000
}


const pending = new Map<string, string[]>()

/** Commits whose transcript has not come back yet, per peer. */
const awaitingTranscripts = new Map<string, number>()

/** Everything still owed to the speaker: commits whose words are in flight. */
function pendingWork(peerId: string): number {
  return awaitingTranscripts.get(peerId) ?? 0
}

const finishing = new Set<string>()

const finishTimers = new Map<string, ReturnType<typeof setTimeout>>()

const MIN_COMMIT_MS = 120

/** How long a finish waits for the tail transcript before giving up on it. */
const FINISH_TIMEOUT_MS = 30000

const EMPTY_COMMIT_CODE = 'input_audio_buffer_commit_empty'

function isEmptyCommitError(event: Record<string, any>): boolean {
  return event.error?.code === EMPTY_COMMIT_CODE
    || /buffer too small/i.test(String(event.error?.message ?? ''))
}

interface ClientMessage {
  type?: string
  audio?: string
}

function send(peer: { send: (data: string) => void }, payload: Record<string, unknown>): void {
  peer.send(JSON.stringify(payload))
}

/** readyState 1 === OPEN; a leg that is anything else is not worth writing to. */
function sendUpstream(socket: WebSocket | undefined, payload: string): void {
  if (socket && socket.readyState === 1) {
    socket.send(payload)
  }
}

function closeUpstreams(peerId: string): void {
  for (const sockets of [transcriptSockets, previewSockets]) {
    const socket = sockets.get(peerId)
    if (socket) {
      // 1000 = normal closure; anything else makes OpenAI log an abnormal end.
      socket.close(1000)
      sockets.delete(peerId)
    }
  }
  languages.delete(peerId)
  maxTurns.delete(peerId)
  sinceCommitMs.delete(peerId)
  turnIndexes.delete(peerId)
  pendingFinalTurns.delete(peerId)
  hasSpeech.delete(peerId)
  prompts.delete(peerId)
  previewTextByTurn.delete(peerId)
  readyLegs.delete(peerId)
  expectedLegs.delete(peerId)
  pending.delete(peerId)
  finishing.delete(peerId)
  awaitingTranscripts.delete(peerId)
  const timer = finishTimers.get(peerId)
  if (timer) {
    clearTimeout(timer)
    finishTimers.delete(peerId)
  }
}

/**
 * @returns whether a transcript is now on its way back.
 */
/**
 * @returns whether a transcript is now on its way back.
 */
function flushTurn(peerId: string): boolean {
  const elapsed = sinceCommitMs.get(peerId) ?? 0
  const isSpeech = !previewSockets.has(peerId)
    || (hasSpeech.get(peerId) ?? false)
    || elapsed < PREVIEW_LAG_MS

  sinceCommitMs.set(peerId, 0)
  hasSpeech.set(peerId, false)

  const command = JSON.stringify({
    type: isSpeech ? 'input_audio_buffer.commit' : 'input_audio_buffer.clear',
  })
  sendUpstream(transcriptSockets.get(peerId), command)
  sendUpstream(previewSockets.get(peerId), command)

  if (!isSpeech) {
    return false
  }

  pendingFinalTurns.get(peerId)?.push(turnIndexes.get(peerId) ?? 0)
  awaitingTranscripts.set(peerId, (awaitingTranscripts.get(peerId) ?? 0) + 1)

  // With a preview leg the turn advances on its `committed` echo instead, so
  // that words still arriving for the turn just ended are numbered as its own.
  if (!previewSockets.has(peerId)) {
    turnIndexes.set(peerId, (turnIndexes.get(peerId) ?? 0) + 1)
  }
  return true
}

function takePreviewText(peerId: string, turn: number): string {
  const heard = previewTextByTurn.get(peerId)
  if (!heard) { return '' }
  const text = heard.get(turn) ?? ''
  for (const earlier of heard.keys()) {
    if (earlier <= turn) { heard.delete(earlier) }
  }
  return text.trim()
}

/** End the session only once nothing is still owed to the speaker. */
function maybeFinishSession(peer: { send: (data: string) => void }, peerId: string): void {
  if (finishing.has(peerId) && pendingWork(peerId) === 0) {
    finishSession(peer, peerId)
  }
}

function finishSession(peer: { send: (data: string) => void }, peerId: string): void {
  send(peer, { type: 'done' })
  closeUpstreams(peerId)
}

function handleStop(peer: { send: (data: string) => void }, peerId: string): void {
  const transcript = transcriptSockets.get(peerId)
  // readyState 1 === OPEN.
  if (!transcript || transcript.readyState !== 1) {
    finishSession(peer, peerId)
    return
  }

  finishing.add(peerId)

  const hasTail = (sinceCommitMs.get(peerId) ?? 0) >= MIN_COMMIT_MS
  if ((hasTail && flushTurn(peerId)) || pendingWork(peerId) > 0) {
    finishTimers.set(peerId, setTimeout(() => finishSession(peer, peerId), FINISH_TIMEOUT_MS))
    return
  }

  finishSession(peer, peerId)
}
function handleLegReady(peer: { send: (data: string) => void }, peerId: string): void {
  const ready = (readyLegs.get(peerId) ?? 0) + 1
  readyLegs.set(peerId, ready)
  if (ready < (expectedLegs.get(peerId) ?? 1)) {
    return
  }

  send(peer, { type: 'ready' })
  for (const audio of pending.get(peerId) ?? []) {
    const frame = JSON.stringify({ type: 'input_audio_buffer.append', audio })
    sendUpstream(transcriptSockets.get(peerId), frame)
    sendUpstream(previewSockets.get(peerId), frame)
  }
  pending.set(peerId, [])
}

export default defineWebSocketHandler({
  async open(peer) {
    const peerId = String(peer.id)
    pending.set(peerId, [])

    const url = new URL(peer.request?.url ?? '', 'http://localhost')
    const token = url.searchParams.get('token') ?? ''

    let user
    try {
      user = await authenticateToken(token)
    } catch (error) {
      const message = error instanceof AuthError ? error.message : 'Authentication failed.'
      send(peer, { type: 'error', message })
      peer.close(1008, 'unauthorized')
      return
    }

    try {
      await enforceRateLimit({
        key: `transcribe:stream:${user.id}`,
        limit: RATE_LIMIT_SESSIONS,
        windowMs: RATE_LIMIT_WINDOW_MS,
      })
    } catch (error) {
      const message = error instanceof RateLimitError
        ? error.message
        : 'Too many dictation sessions.'
      send(peer, { type: 'error', message })
      peer.close(1013, 'rate-limited')
      return
    }

    let transcript: WebSocket
    let preview: WebSocket | null
    let language: string
    let maxTurnMs: number
    let transcriptionPrompt: string
    try {
      ;({
        transcript,
        preview,
        language,
        maxTurnMs,
        transcriptionPrompt,
      } = await openRealtimeTranscription())
    } catch (error) {
      const message = error instanceof OpenAiError
        ? error.message
        : 'Dictation could not be started.'
      send(peer, { type: 'error', message })
      peer.close(1011, 'upstream-unavailable')
      return
    }

    transcriptSockets.set(peerId, transcript)
    languages.set(peerId, language)
    maxTurns.set(peerId, maxTurnMs)
    sinceCommitMs.set(peerId, 0)
    turnIndexes.set(peerId, 0)
    pendingFinalTurns.set(peerId, [])
    hasSpeech.set(peerId, false)
    prompts.set(peerId, transcriptionPrompt)
    previewTextByTurn.set(peerId, new Map())
    readyLegs.set(peerId, 0)
    expectedLegs.set(peerId, preview ? 2 : 1)

    transcript.on('message', (raw: WebSocket.RawData) => {
      let event: Record<string, any>
      try {
        event = JSON.parse(raw.toString())
      } catch {
        return
      }

      switch (event.type) {
        case 'session.updated':
          handleLegReady(peer, peerId)
          break
        case 'conversation.item.input_audio_transcription.completed': {
          const cleaned = keepSessionScript(String(event.transcript ?? ''), language)
          const guarded = isHallucinatedSegment(cleaned)
            || isPromptEcho(cleaned, prompts.get(peerId) ?? '')
            ? ''
            : cleaned
          const turn = pendingFinalTurns.get(peerId)?.shift() ?? turnIndexes.get(peerId) ?? 0
          const heard = takePreviewText(peerId, turn)
          const isSpeech = !previewSockets.has(peerId) || Boolean(heard)
          // Its own wording stands in only when the accurate leg returns nothing
          // for a turn that did hold speech - never as a way in for noise.
          const text = isSpeech ? (guarded || heard) : ''
          send(peer, { type: 'segment', id: String(turn), text })
          awaitingTranscripts.set(peerId, Math.max(0, (awaitingTranscripts.get(peerId) ?? 0) - 1))
          // Ends the session only when this was the LAST thing outstanding.
          maybeFinishSession(peer, peerId)
          break
        }
        case 'error':
          if (isEmptyCommitError(event)) {
            maybeFinishSession(peer, peerId)
            break
          }
          send(peer, { type: 'error', message: String(event.error?.message ?? 'Dictation failed.') })
          // Never leave a stopping client waiting on a transcript that failed.
          if (finishing.has(peerId)) {
            finishSession(peer, peerId)
          }
          break
      }
    })

    transcript.on('error', (error: Error) => {
      send(peer, { type: 'error', message: `Dictation connection failed: ${error.message}` })
    })

    transcript.on('close', () => {
      transcriptSockets.delete(peerId)
      peer.close(1000, 'upstream-closed')
    })

    if (!preview) {
      return
    }

    previewSockets.set(peerId, preview)

    preview.on('message', (raw: WebSocket.RawData) => {
      let event: Record<string, any>
      try {
        event = JSON.parse(raw.toString())
      } catch {
        return
      }

      switch (event.type) {
        case 'session.updated':
          handleLegReady(peer, peerId)
          break
        case 'conversation.item.input_audio_transcription.delta': {
          hasSpeech.set(peerId, true)
          const delta = keepSessionScript(String(event.delta ?? ''), language)
          if (delta) {
            const turn = turnIndexes.get(peerId) ?? 0
            const heard = previewTextByTurn.get(peerId)
            heard?.set(turn, (heard.get(turn) ?? '') + delta)
            if (!finishing.has(peerId)) {
              send(peer, { type: 'delta', id: String(turn), text: delta })
            }
          }
          break
        }
        case 'input_audio_buffer.committed':
          if (!finishing.has(peerId)) {
            turnIndexes.set(peerId, (turnIndexes.get(peerId) ?? 0) + 1)
          }
          break
      }
    })

    preview.on('error', () => {
      previewSockets.delete(peerId)
    })

    preview.on('close', () => {
      previewSockets.delete(peerId)
    })
  },

  message(peer, message) {
    const peerId = String(peer.id)
    let parsed: ClientMessage
    try {
      parsed = JSON.parse(message.text())
    } catch {
      return
    }
    if (parsed.type === 'stop') {
      handleStop(peer, peerId)
      return
    }

    if (parsed.type !== 'audio' || !parsed.audio) {
      return
    }

    // Held until every leg is configured, so both hear the same audio from the
    // same first frame — and so the user's opening words are not dropped.
    if ((readyLegs.get(peerId) ?? 0) < (expectedLegs.get(peerId) ?? 1)) {
      pending.get(peerId)?.push(parsed.audio)
      return
    }

    const frame = JSON.stringify({ type: 'input_audio_buffer.append', audio: parsed.audio })
    sendUpstream(transcriptSockets.get(peerId), frame)
    sendUpstream(previewSockets.get(peerId), frame)
    const elapsed = (sinceCommitMs.get(peerId) ?? 0) + frameDurationMs(parsed.audio)
    const cap = maxTurns.get(peerId) ?? 0
    if (cap > 0 && elapsed >= cap) {
      flushTurn(peerId)
      return
    }
    sinceCommitMs.set(peerId, elapsed)
  },

  close(peer) {
    closeUpstreams(String(peer.id))
  },
})
