// Context-aware SAP sync copy (CONNECT-573). The noun reflects what the user
// synced so the same indicators/tooltips/toasts read correctly across flows —
// customer account/address/contact, or a supplier. Single source of truth so
// the wording is never hardcoded per call site.
export type SapSyncSubject = 'account' | 'address' | 'contact' | 'supplier'

interface SapSyncMessages {
  synced: string
  failed: string
  // Shown when the sync neither confirmed success nor reported a failure within
  // the wait window — i.e. we never heard back. Distinct from `failed` because
  // the common cause is upstream of SAP (the Directus flow couldn't enqueue the
  // job, the sync service is unreachable, or the SAP user lacks an active
  // licence) rather than SAP rejecting the record itself.
  unconfirmed: string
}

export function getSapSyncMessages(subject: SapSyncSubject = 'account'): SapSyncMessages {
  // Suppliers have their own phrasing; customer sub-records share one template
  // with the subject noun swapped in.
  if (subject === 'supplier') {
    return {
      synced: 'This supplier was synced to SAP.',
      failed: 'This supplier could not be synced to SAP.',
      unconfirmed: 'We couldn’t confirm this supplier synced to SAP. The sync service may be unavailable, or your SAP user may not have an active licence. Retry, or contact support if it persists.',
    }
  }
  return {
    synced: `Customer SAP ${subject} synced.`,
    failed: `Customer SAP ${subject} failed to sync.`,
    unconfirmed: `We couldn’t confirm the customer SAP ${subject} synced to SAP. The sync service may be unavailable, or your SAP user may not have an active licence. Retry, or contact support if it persists.`,
  }
}
