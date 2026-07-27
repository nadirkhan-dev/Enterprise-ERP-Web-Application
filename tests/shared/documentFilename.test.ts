import {
  DOCUMENT_FILENAME_PREFIX,
  buildDocumentFilename,
  sanitizeDocumentFilename,
} from '../../shared/utils/documentFilename'

describe('Scenario: Naming a generated document PDF', () => {
  it('prefixes every document with the LibertySupply brand token', () => {
    expect(buildDocumentFilename('SO12345', 'Order')).toBe('LibertySupply-SO12345-Order.pdf')
  })

  it('names each document type consistently as prefix-number-type', () => {
    expect(buildDocumentFilename('INV88021', 'Invoice')).toBe('LibertySupply-INV88021-Invoice.pdf')
    expect(buildDocumentFilename('QT4417', 'Quote')).toBe('LibertySupply-QT4417-Quote.pdf')
    expect(buildDocumentFilename('PO9903', 'PurchaseOrder')).toBe('LibertySupply-PO9903-PurchaseOrder.pdf')
    expect(buildDocumentFilename('SO12345', 'Shipment')).toBe('LibertySupply-SO12345-Shipment.pdf')
  })

  it('accepts a numeric document number', () => {
    expect(buildDocumentFilename(12345, 'Order')).toBe('LibertySupply-12345-Order.pdf')
  })

  it('still produces a usable name when the document number is missing', () => {
    expect(buildDocumentFilename(null, 'Order')).toBe('LibertySupply-Order.pdf')
    expect(buildDocumentFilename('', 'Order')).toBe('LibertySupply-Order.pdf')
  })

  it('falls back to a generic name when nothing usable survives', () => {
    expect(buildDocumentFilename(null, '')).toBe('LibertySupply-Document.pdf')
    expect(buildDocumentFilename('///', '!!!')).toBe('LibertySupply-Document.pdf')
  })

  it('collapses characters that are unsafe in a filename or header', () => {
    expect(buildDocumentFilename('SO 123/45', 'Order')).toBe('LibertySupply-SO-123-45-Order.pdf')
  })
})

describe('Scenario: Sanitizing a filename that arrived over the wire', () => {
  it('leaves an already-correct filename untouched', () => {
    expect(sanitizeDocumentFilename('LibertySupply-SO12345-Order.pdf')).toBe('LibertySupply-SO12345-Order.pdf')
  })

  it('adds the LibertySupply prefix when the caller omitted it', () => {
    expect(sanitizeDocumentFilename('SO12345-Order.pdf')).toBe('LibertySupply-SO12345-Order.pdf')
  })

  it('does not double up a prefix that is already present', () => {
    const sanitized = sanitizeDocumentFilename('LibertySupply-SO12345-Order.pdf')
    const occurrences = sanitized.split(DOCUMENT_FILENAME_PREFIX).length - 1
    expect(occurrences).toBe(1)
  })

  it('strips quotes and CRLF so the Content-Disposition header cannot be injected', () => {
    const injected = 'SO1"; attachment; filename="evil.exe\r\nX-Injected: yes'
    const sanitized = sanitizeDocumentFilename(injected)

    expect(sanitized).not.toContain('"')
    expect(sanitized).not.toContain('\r')
    expect(sanitized).not.toContain('\n')
    expect(sanitized).toMatch(/^LibertySupply-[A-Za-z0-9._-]*\.pdf$/)
  })

  it('drops any directory traversal path and keeps only the base name', () => {
    expect(sanitizeDocumentFilename('../../etc/passwd')).toBe('LibertySupply-passwd.pdf')
    expect(sanitizeDocumentFilename('C:\\Windows\\system32\\evil.pdf')).toBe('LibertySupply-evil.pdf')
  })

  it('always returns a .pdf name, even for empty input', () => {
    expect(sanitizeDocumentFilename('')).toBe('LibertySupply-Document.pdf')
    expect(sanitizeDocumentFilename(null)).toBe('LibertySupply-Document.pdf')
    expect(sanitizeDocumentFilename(undefined)).toBe('LibertySupply-Document.pdf')
  })
})
