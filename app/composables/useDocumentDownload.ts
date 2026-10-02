import { buildLoadingPageHtml } from '~/utils/loadingPage'

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

// The opened tab's loading screen (see app/utils/loadingPage.ts), so the tab
// isn't blank while the PDF renders.
const LOADING_DOCUMENT_HTML = buildLoadingPageHtml('Loading document…')

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
      // Cloudflare Access intercepted the request rather than the render service
      // failing. Its own prompt is now up, and "please try again" would be a lie
      // — nothing here can succeed until the session is renewed.
      if (handleAccessFailure()) {
        return null
      }
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

  /**
   * @param reservedViewer A tab the caller already opened inside the click
   */
  async function openDocument(
    input: DownloadDocumentInput,
    reservedViewer: Window | null = null,
  ): Promise<void> {
    const key = String(input.docEntry)
    if (!beginAction(key, 'open')) {
      reservedViewer?.close()
      return
    }

    // Reserve the tab synchronously (inside the click gesture) so popup
    // blockers allow it, and show a loading screen so it's never blank while the
    // PDF renders, then point it at the document once it arrives.
    const viewer = reservedViewer ?? window.open('', '_blank')
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
