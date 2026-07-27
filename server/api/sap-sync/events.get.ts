import { createEventStream } from 'h3'
import { subscribeToPartnerSync, type SyncRunStatus } from '../../utils/serviceMasterSocket'

/**
 * SSE stream of a partner's SAP sync-job status, relayed from the Service Master
 * WebSocket (which Nitro holds server-side with CF Access headers — the browser
 * can't). The browser opens an EventSource to
 * `/api/sap-sync/events?partnerId=<directusId>` and receives `SyncRunStatus`
 * JSON until the job reaches a terminal state or the page closes.
 *
 * Mirrors the deploy-events SSE: EventSource can't send auth headers, so this is
 * same-origin/session-gated like that endpoint; it only ever streams the one
 * partner's sync status (the user's own just-created record).
 */
export default defineEventHandler((event) => {
  const partnerId = String(getQuery(event).partnerId ?? '').trim()
  if (!partnerId) {
    throw createError({ statusCode: 400, statusMessage: 'partnerId query parameter is required' })
  }

  const stream = createEventStream(event)

  const onUpdate = (update: SyncRunStatus) => {
    stream.push(JSON.stringify(update))
  }
  const unsubscribe = subscribeToPartnerSync(partnerId, onUpdate)

  // Keep the stream alive through reverse proxies (Cloudflare/Nginx).
  const heartbeat = setInterval(() => {
    stream.push({ event: 'ping', data: '' })
  }, 30000)

  stream.onClosed(async () => {
    clearInterval(heartbeat)
    unsubscribe()
    await stream.close()
  })

  return stream.send()
})
