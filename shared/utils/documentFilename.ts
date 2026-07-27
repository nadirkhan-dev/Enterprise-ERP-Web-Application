// The canonical name for every document PDF Connect generates.
//
// Two places have to agree on this string: the browser, which puts it on the
// download anchor, and the render proxy, which puts it in a Content-Disposition
// header. Keeping one copy in `shared/` (auto-imported by both `app/` and
// `server/`) means the naming rule and the sanitizing rule can't drift apart.

export const DOCUMENT_FILENAME_PREFIX = 'LibertySupply'

// Fallback when a document carries no usable number or label at all.
const FALLBACK_STEM = 'Document'

// Document numbers and labels arrive from SAP/Looker unvalidated and end up in a
// response header, so anything outside this set — quotes, CRLF, path separators —
// is collapsed to a hyphen rather than trusted.
const UNSAFE_CHARS = /[^A-Za-z0-9._-]+/g
const EDGE_SEPARATORS = /^[-._]+|[-._]+$/g

const MAX_SEGMENT_LENGTH = 64
const MAX_STEM_LENGTH = 128

function toSafeToken(value: string | number | null | undefined, maxLength: number): string {
  return String(value ?? '')
    .replace(UNSAFE_CHARS, '-')
    .replace(EDGE_SEPARATORS, '')
    .slice(0, maxLength)
    .replace(EDGE_SEPARATORS, '')
}

/**
 * Builds the download name for a document PDF: `LibertySupply-<number>-<type>.pdf`
 * (e.g. `LibertySupply-SO12345-Order.pdf`).
 *
 * @param {string|number} documentNumber The human-facing number (orderNumber, invoiceNumber…).
 * @param {string} documentLabel The document type token, e.g. 'Order', 'Invoice'.
 */
export function buildDocumentFilename(
  documentNumber: string | number | null | undefined,
  documentLabel: string,
): string {
  const segments = [
    DOCUMENT_FILENAME_PREFIX,
    toSafeToken(documentNumber, MAX_SEGMENT_LENGTH),
    toSafeToken(documentLabel, MAX_SEGMENT_LENGTH),
  ].filter(Boolean)

  // Prefix alone means neither number nor label survived sanitizing.
  if (segments.length === 1) {
    segments.push(FALLBACK_STEM)
  }

  return `${segments.join('-')}.pdf`
}

/**
 * Normalizes a filename that arrived over the wire. The render proxy drops the
 * client-supplied name straight into a Content-Disposition header, so this is
 * what stands between a document number and header injection — it strips any
 * path, removes unsafe characters, and guarantees the LibertySupply prefix even
 * if the caller forgot it.
 */
export function sanitizeDocumentFilename(filename: string | null | undefined): string {
  // `.pop()` on a split always yields a string; the fallback satisfies the type.
  const baseName = String(filename ?? '').split(/[/\\]/).pop() ?? ''
  const stem = toSafeToken(baseName.replace(/\.pdf$/i, ''), MAX_STEM_LENGTH) || FALLBACK_STEM

  if (stem === DOCUMENT_FILENAME_PREFIX || stem.startsWith(`${DOCUMENT_FILENAME_PREFIX}-`)) {
    return `${stem}.pdf`
  }
  return `${DOCUMENT_FILENAME_PREFIX}-${stem}.pdf`
}
