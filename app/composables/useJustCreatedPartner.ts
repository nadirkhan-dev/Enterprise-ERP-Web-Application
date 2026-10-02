// One-shot, cross-route signal that a partner (customer/supplier) was JUST
// created — so the detail page knows a SAP sync is genuinely in flight and shows
// the "syncing" state. On a plain REOPEN (no mark) the detail page shows the
// not-synced/failed state immediately instead of a misleading spinner, because
// opening a record triggers no sync — only creating one does.
//
// Consumed on read (single use). Client-only in practice: written from the create
// page's submit handler, read inside the detail page's client-only sync watch —
// so it never carries state across SSR requests.
const justCreatedPartnerId = ref<string | number | null>(null)

export function useJustCreatedPartner() {
  function markJustCreated(partnerId: string | number): void {
    justCreatedPartnerId.value = partnerId
  }

  // True — once — when `partnerId` is the record we just created; clears the flag
  // so a later reopen of the same record no longer counts as "just created".
  function consumeJustCreated(partnerId: string | number): boolean {
    const matched = justCreatedPartnerId.value != null
      && String(justCreatedPartnerId.value) === String(partnerId)
    if (matched) { justCreatedPartnerId.value = null }
    return matched
  }

  return { markJustCreated, consumeJustCreated }
}
