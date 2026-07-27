// Renders a document to PDF via our server proxy (`/api/documents/render`),
// which holds the render service's Basic Auth credentials. Supports both
// downloading the file and opening it inline in a new tab. Tracks in-flight
// actions per DocEntry *and* per action, so download and open can run at the
// same time and each trigger shows its own spinner. Surfaces failures as a toast.

interface DownloadDocumentInput {
  // One of the render service templates, e.g. 'sales-orders'.
  template: string
  docEntry: string | number
  filename: string
}

type DocumentAction = 'open' | 'download'

// Standalone loading page for the opened tab — a separate document, so it can't
// use <BaseSpinner>; this mirrors its planetary 3-dot animation with the same
// colors (primary #009bd4, muted #9ca3a7) so the tab isn't blank while the PDF
// renders.
const LOADING_DOCUMENT_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Loading document…</title><style>
html,body{height:100%;margin:0}
body{display:flex;flex-direction:column;gap:20px;align-items:center;justify-content:center;font-family:"TT Norms Pro",system-ui,-apple-system,sans-serif;background:#f8fafc}
.loading-label{font-size:14px;font-weight:300;color:#9ca3a7}
.base-spinner{position:relative;width:40px;height:40px;display:flex;align-items:center;justify-content:center;perspective:800px}
.base-spinner__orbit,.base-spinner__scene{position:absolute;width:100%;height:100%;transform-style:preserve-3d}
.base-spinner__orbit{animation:spinner-planetary 3s linear infinite}
.base-spinner__dot{position:absolute;width:22%;height:22%;margin:-11%;border-radius:50%;background:#9ca3a7;top:50%;left:50%}
.base-spinner__dot:nth-child(1){animation:spinner-chaos-x 1.5s cubic-bezier(0.7,0,0.3,1) infinite}
.base-spinner__dot:nth-child(2){animation:spinner-chaos-y 1.5s cubic-bezier(0.7,0,0.3,1) infinite}
.base-spinner__dot:nth-child(3){animation:spinner-chaos-z 1.5s cubic-bezier(0.7,0,0.3,1) infinite}
@keyframes spinner-planetary{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
@keyframes spinner-chaos-x{0%,100%{transform:translate3d(-200%,0,-50px) scale(0.7)}50%{transform:translate3d(200%,0,50px) scale(1.4);background:#009bd4}}
@keyframes spinner-chaos-y{0%,100%{transform:translate3d(0,-200%,-50px) scale(0.7)}50%{transform:translate3d(0,200%,50px) scale(1.4);background:#009bd4}}
@keyframes spinner-chaos-z{0%,100%{transform:translate3d(150%,150%,-100px) scale(0.7)}50%{transform:translate3d(-150%,-150%,100px) scale(1.4);background:#009bd4}}
</style></head><body><div class="base-spinner"><div class="base-spinner__orbit"><div class="base-spinner__scene"><div class="base-spinner__dot"></div><div class="base-spinner__dot"></div><div class="base-spinner__dot"></div></div></div></div><div class="loading-label">Loading document…</div></body></html>`

export function useDocumentDownload() {
  const toast = useToast()
  // docEntry → the set of actions currently rendering for that row. Tracked per
  // action so download and open can be in flight at the same time.
  const inFlight = reactive(new Map<string, Set<DocumentAction>>())

  function isActionPending(docEntry: string | number, action: DocumentAction): boolean {
    return inFlight.get(String(docEntry))?.has(action) ?? false
  }

  // Backward-compatible single-action lookup for callers that only render one
  // spinner at a time (the customer-page sections).
  function pendingAction(docEntry: string | number): DocumentAction | null {
    const actions = inFlight.get(String(docEntry))
    if (!actions || actions.size === 0) { return null }
    return actions.values().next().value ?? null
  }

  // Claims the action for this docEntry; returns false if it's already running.
  function beginAction(key: string, action: DocumentAction): boolean {
    const actions = inFlight.get(key) ?? new Set<DocumentAction>()
    if (actions.has(action)) { return false }
    actions.add(action)
    inFlight.set(key, actions)
    return true
  }

  function endAction(key: string, action: DocumentAction): void {
    const actions = inFlight.get(key)
    if (!actions) { return }
    actions.delete(action)
    if (actions.size === 0) { inFlight.delete(key) }
  }

  async function fetchPdf(input: DownloadDocumentInput): Promise<Blob | null> {
    const { data, error } = await tryCatch(
      $fetch<Blob>('/api/documents/render', {
        method: 'POST',
        body: {
          template: input.template,
          docEntry: input.docEntry,
          filename: input.filename,
        },
        responseType: 'blob',
      }),
    )

    if (error || !data) {
      // A 404 from the render proxy means the document doesn't exist (vs. a
      // transient render failure), so it gets its own non-retry message.
      const statusCode = (error as { statusCode?: number, status?: number } | null)?.statusCode
        ?? (error as { statusCode?: number, status?: number } | null)?.status
      const isNotFound = statusCode === 404
      toast.add({
        severity: 'error',
        summary: isNotFound ? 'Document not found' : 'Document unavailable',
        detail: isNotFound
          ? 'The requested document could not be found.'
          : 'Could not generate the document PDF. Please try again.',
        life: 4000,
      })
      return null
    }
    return data
  }

  async function downloadDocument(input: DownloadDocumentInput): Promise<void> {
    const key = String(input.docEntry)
    if (!beginAction(key, 'download')) { return }

    const blob = await fetchPdf(input)
    endAction(key, 'download')
    if (!blob) { return }

    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    // The blob URL carries no Content-Disposition, so this attribute alone names
    // the saved file. Re-normalizing here (rather than trusting the caller) keeps
    // the LibertySupply prefix guaranteed even for a call site that hand-rolls a name.
    anchor.download = sanitizeDocumentFilename(input.filename)
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Revoke only after the browser has started reading the blob — revoking
    // synchronously after click() can abort the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
  }

  async function openDocument(input: DownloadDocumentInput): Promise<void> {
    const key = String(input.docEntry)
    if (!beginAction(key, 'open')) { return }

    // Reserve the tab synchronously (inside the click gesture) so popup
    // blockers allow it, and show a loading screen so it's never blank while the
    // PDF renders, then point it at the document once it arrives.
    const viewer = window.open('', '_blank')
    if (viewer) {
      viewer.document.write(LOADING_DOCUMENT_HTML)
      viewer.document.close()
    }

    const blob = await fetchPdf(input)
    endAction(key, 'open')
    if (!blob) {
      viewer?.close()
      return
    }

    const objectUrl = URL.createObjectURL(blob)
    if (viewer) {
      viewer.location.href = objectUrl
    } else {
      window.open(objectUrl, '_blank')
    }
    // Release the blob URL once the new tab has had time to load it.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  }

  return { downloadDocument, openDocument, pendingAction, isActionPending }
}
