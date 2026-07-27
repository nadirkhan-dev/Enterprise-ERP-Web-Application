import type { SapSyncSubject } from '~/utils/sapSyncMessages'

/**
 * Toast-on-failure for the SAP sync that follows a business-partner *edit*.
 *
 * Every customer/supplier edit — account fields, address, phone, contacts —
 * saves as a nested `updateBusinessPartner(...)`, which re-syncs the whole partner
 * to SAP via the `[SM] Business Partners Sync` flow. The Directus write itself
 * succeeds immediately (the drawer's own "saved" toast covers that); the SAP sync
 * happens asynchronously and its only observable outcome is the partner's
 * `sync-run` event on the relay socket (the same stream the create-sync uses).
 *
 * This watches that stream for a bounded window after a save and surfaces a toast
 * ONLY when the sync fails — success or no-news stays silent, so a healthy edit
 * looks exactly as it does today.
 *
 * Correlation: `useSapSyncSocket.subscribe` replays the partner's LAST cached
 * status synchronously (which is stale — a prior sync's outcome). We ignore that
 * replay and only act on the fresh cycle that arrives after the save. A sync that
 * both starts and fails inside the save's network round-trip could be missed, but
 * a real SAP round-trip is far slower than that.
 */

// A partner's SAP round-trip comfortably exceeds this in the failure case; past it
// we assume success/unreachable and stop watching silently (no "unconfirmed" noise
// on every edit — the user only asked to hear about outright failures).
const WATCH_WINDOW_MS = 30000

// One live watch per partner — a fresh save re-arms and supersedes the previous.
const activeWatches = new Map<string, () => void>()

export function useSapSyncFailureWatch() {
  const { subscribe } = useSapSyncSocket()
  const toast = useToast()

  /**
   * Arm a failure watch for a partner that has just been edited. No-op on the
   * server or without an id. Call only for already-synced records — the initial
   * create-sync owns the first sync and shows its own indicator.
   */
  function watchPartnerSyncFailure(partnerId: string | number | null, subject: SapSyncSubject) {
    if (partnerId == null || typeof window === 'undefined') { return }
    const key = String(partnerId)

    // Supersede any in-flight watch for this partner.
    activeWatches.get(key)?.()

    let armed = false
    let unsubscribe: (() => void) | null = null

    const cleanup = () => {
      clearTimeout(timer)
      unsubscribe?.()
      if (activeWatches.get(key) === cleanup) { activeWatches.delete(key) }
    }

    const timer = setTimeout(cleanup, WATCH_WINDOW_MS)

    unsubscribe = subscribe(key, (update) => {
      // Skip the synchronous replay of the last cached status — only the fresh
      // post-save cycle counts.
      if (!armed) { return }
      if (update.status === 'success') { cleanup(); return }
      if (update.status === 'failed' || update.status === 'cancelled') {
        toast.add({
          severity: 'error',
          summary: 'SAP sync failed',
          detail: update.error || getSapSyncMessages(subject).failed,
          life: 8000,
        })
        cleanup()
      }
      // queued / processing / retrying → still in flight, keep waiting.
    })

    activeWatches.set(key, cleanup)
    // Arm once the synchronous replay above has fired.
    Promise.resolve().then(() => { armed = true })
  }

  return { watchPartnerSyncFailure }
}
