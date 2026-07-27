/**
 * Service Master (SAP sync worker) realtime client — server-only.
 *
 * Connect's browser can't authenticate to Service Master directly: Cloudflare
 * Access service-token headers can't be set on a browser WebSocket. So Nitro
 * holds ONE upstream WebSocket to Service Master's `/ws/jobs` feed and fans
 * `sync-run` events out to per-partner subscribers, which the SSE route
 * (/api/sap-sync/events) relays to the browser.
 *
 * Service Master contract (servicemaster: src/modules/realtime/routes.ts):
 *   - Connect to `NUXT_SERVICEMASTER_WS_URL` (e.g. wss://…/ws/jobs). CF Access
 *     headers go on the HTTP upgrade (validated at Cloudflare's edge).
 *   - App auth is the FIRST message (the WS API can't send headers):
 *       → { "type": "auth", "token": "<SERVICE_API_KEY>" }
 *       ← { "type": "ready" }
 *   - Then the server streams, one per status transition:
 *       ← { "type": "sync-run", "data": <SyncRunEvent> }
 *     where SyncRunEvent = { runId, status, entity, directusId,
 *       sapKey: string|null,  // SAP id on success
 *       error?: { name, message, … } | null, … }
 *   Connect filters by `directusId` server-side.
 */
import { EventEmitter } from 'node:events'
import WebSocket from 'ws'

export interface SyncRunStatus {
  directusId: string
  entity: string
  status: 'queued' | 'processing' | 'retrying' | 'success' | 'failed' | 'cancelled' | string
  sapId?: string | null
  error?: string | null
}

// Per-partner pub/sub keyed by directusId.
const bus = new EventEmitter()
bus.setMaxListeners(0)

let socket: WebSocket | null = null
let connecting = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let subscriberCount = 0

const RECONNECT_DELAY_MS = 3000

function getConfig() {
  // Read process.env directly (this is server-only code). Nuxt's runtimeConfig
  // env override expects NUXT_SERVICE_MASTER_* (camelCase→SNAKE), but the deploy
  // sets NUXT_SERVICEMASTER_*, so runtimeConfig resolves to the build-time value —
  // which is empty in the Docker image (the var isn't a build arg). Falling back
  // to runtimeConfig keeps dev working where the value is baked from .env.
  const runtime = useRuntimeConfig()
  return {
    url: String(process.env.NUXT_SERVICEMASTER_WS_URL || runtime.serviceMasterWsUrl || '').trim(),
    apiKey: String(process.env.NUXT_SERVICEMASTER_API_KEY || runtime.serviceMasterApiKey || '').trim(),
    cfId: String(process.env.NUXT_CF_ACCESS_CLIENT_ID || runtime.cfAccessClientId || '').trim(),
    cfSecret: String(process.env.NUXT_CF_ACCESS_CLIENT_SECRET || runtime.cfAccessClientSecret || '').trim(),
  }
}

// Map a Service Master SyncRunEvent to Connect's compact status shape.
function normalize(event: any): SyncRunStatus | null {
  const directusId = event?.directusId != null ? String(event.directusId) : null
  if (!directusId) { return null }
  // Prefer Service Master's frontend-friendly `hint` (e.g. "The record was not
  // found in SAP.") over the raw SAP `message` ("SAP 404: Entity … does not
  // exist"). This is the text Connect surfaces in the SAP-sync-failed toast and
  // the failed indicator's tooltip; falling back to `message`, then null.
  const error = typeof event?.error === 'string'
    ? event.error
    : (event?.error?.hint ?? event?.error?.message ?? null)
  return {
    directusId,
    entity: event?.entity ?? 'business_partners',
    status: event?.status ?? 'processing',
    sapId: event?.sapKey ? String(event.sapKey) : null,
    error: error ?? null,
  }
}

function scheduleReconnect() {
  if (reconnectTimer || subscriberCount === 0) { return }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_DELAY_MS)
}

function connect() {
  if (socket || connecting) { return }
  const config = getConfig()
  if (!config.url) {
    console.warn('[serviceMasterSocket] NUXT_SERVICEMASTER_WS_URL is not set — sync-run relay disabled, browser will see no SAP sync status')
    return
  }

  connecting = true
  // CF Access service token on the HTTP upgrade (the edge validates these);
  // the app-level SERVICE_API_KEY is sent as the first message after open.
  const headers: Record<string, string> = {}
  if (config.cfId) { headers['CF-Access-Client-Id'] = config.cfId }
  if (config.cfSecret) { headers['CF-Access-Client-Secret'] = config.cfSecret }

  let ws: WebSocket
  try {
    ws = new WebSocket(config.url, { headers })
  } catch {
    connecting = false
    scheduleReconnect()
    return
  }
  socket = ws

  ws.on('open', () => {
    connecting = false
    console.info('[serviceMasterSocket] upstream connected, authenticating')
    ws.send(JSON.stringify({ type: 'auth', token: config.apiKey }))
  })
  ws.on('message', (raw: WebSocket.RawData) => {
    let message: any
    try { message = JSON.parse(raw.toString()) }
    catch { return }
    if (message?.type !== 'sync-run') { return }
    const update = normalize(message.data)
    if (update) { bus.emit(update.directusId, update) }
  })
  ws.on('close', (code: number, reason: WebSocket.RawData) => {
    socket = null
    connecting = false
    console.warn(`[serviceMasterSocket] upstream closed code=${code} reason=${reason?.toString() || ''}`)
    scheduleReconnect()
  })
  ws.on('error', (err: Error) => {
    // 'close' fires after 'error' and handles the reconnect.
    console.warn(`[serviceMasterSocket] upstream error: ${err?.message || err}`)
    try { ws.close() }
    catch { /* already closing */ }
  })
}

/**
 * Subscribe to a partner's sync-run updates (by Directus id). Opens the upstream
 * socket on first subscriber. Returns an unsubscribe function.
 */
export function subscribeToPartnerSync(
  directusId: string,
  handler: (update: SyncRunStatus) => void,
): () => void {
  subscriberCount += 1
  bus.on(directusId, handler)
  connect()

  return () => {
    bus.off(directusId, handler)
    subscriberCount = Math.max(0, subscriberCount - 1)
    // Leave the upstream socket open — sync traffic is low and other partners
    // may be subscribed. It reconnects on drop only while subscribers remain.
  }
}
