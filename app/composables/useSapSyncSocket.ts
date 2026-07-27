/**
 * Client subscription to a partner's SAP-sync status — over Server-Sent Events.
 *
 * The browser can't authenticate to Service Master directly: Cloudflare Access
 * service-token headers can't be set on a browser WebSocket. So Nitro holds the
 * upstream WebSocket server-side (see server/utils/serviceMasterSocket.ts) and
 * relays each partner's status over an SSE route:
 *   `/api/sap-sync/events?partnerId=<directusId>`
 *
 * This composable opens one EventSource per watched partner (shared across every
 * subscriber on the page) and fans `SyncRunStatus` events out by Directus id.
 * The server emits one JSON status per transition; EventSource reconnects
 * automatically on drop. No URL or token ships in the client bundle anymore —
 * the WS URL, app API key, and CF Access headers all live server-side.
 */

export interface SapSyncStatus {
  directusId: string
  status: 'queued' | 'processing' | 'retrying' | 'success' | 'failed' | 'cancelled' | string
  sapId: string | null
  error: string | null
}

type SapSyncHandler = (update: SapSyncStatus) => void

interface PartnerStream {
  source: EventSource
  handlers: Set<SapSyncHandler>
}

// Browser singletons — one EventSource per watched partner, shared across
// composable calls within a single client.
const streams = new Map<string, PartnerStream>()
// Last status seen per partner, replayed to any later subscriber so a sync that
// completed before they attached still resolves the spinner. Kept beyond a
// stream's close so a re-subscribe still sees the last known outcome.
const lastStatus = new Map<string, SapSyncStatus>()

function openStream(key: string): PartnerStream {
  const source = new EventSource(`/api/sap-sync/events?partnerId=${encodeURIComponent(key)}`)
  const stream: PartnerStream = { source, handlers: new Set() }

  source.addEventListener('message', (messageEvent) => {
    let update: SapSyncStatus | null
    try { update = JSON.parse(String(messageEvent.data)) }
    catch { return }
    if (!update || !update.directusId) { return }
    lastStatus.set(key, update)
    for (const handler of stream.handlers) { handler(update) }
  })

  streams.set(key, stream)
  return stream
}

function closeStream(key: string) {
  const stream = streams.get(key)
  if (!stream) { return }
  stream.source.close()
  streams.delete(key)
}

export function useSapSyncSocket() {
  /**
   * Subscribe to a partner's sync-run updates (by Directus id). Opens the shared
   * EventSource on first subscriber and replays the partner's last known status if
   * one arrived earlier. Returns an unsubscribe function.
   */
  function subscribe(directusId: string | number, handler: SapSyncHandler): () => void {
    // Browser-only, like the Directus realtime client — no EventSource during SSR.
    if (typeof window === 'undefined') { return () => {} }
    const key = String(directusId)
    let stream = streams.get(key)
    if (!stream) { stream = openStream(key) }
    stream.handlers.add(handler)

    // Replay last known status (covers a transition that arrived before we attached).
    const cached = lastStatus.get(key)
    if (cached) { handler(cached) }

    return () => {
      const current = streams.get(key)
      if (!current) { return }
      current.handlers.delete(handler)
      if (current.handlers.size === 0) { closeStream(key) }
    }
  }

  return { subscribe }
}
