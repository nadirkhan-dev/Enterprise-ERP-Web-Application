// Proxies the internal PDF render service so its Basic Auth credentials never
// reach the browser. The client POSTs { template, docEntry, filename }; this
// forwards it to `{url}/render` with the server-only credentials and streams
// the resulting PDF straight back.

const ALLOWED_TEMPLATES = [
  'sales-orders',
  'sales-invoices',
  'sales-quotes',
  'sales-deliveries',
  'purchase-orders',
] as const

interface RequestBody {
  template?: string
  docEntry?: string | number
  filename?: string
}

export default defineEventHandler(async (event) => {
  const body = await readBody<RequestBody>(event)

  const template = body?.template
  if (!template || !ALLOWED_TEMPLATES.includes(template as (typeof ALLOWED_TEMPLATES)[number])) {
    throw createError({
      statusCode: 400,
      statusMessage: `template must be one of: ${ALLOWED_TEMPLATES.join(', ')}`,
    })
  }
  if (body?.docEntry === undefined || body.docEntry === null || body.docEntry === '') {
    throw createError({ statusCode: 400, statusMessage: 'docEntry is required' })
  }

  const config = useRuntimeConfig()
  const baseUrl = config.pdfDownloadServiceUrl as string
  const username = config.pdfDownloadServiceUserName as string
  const password = config.pdfDownloadServiceUserPass as string

  if (!baseUrl || !username || !password) {
    throw createError({
      statusCode: 500,
      statusMessage: 'PDF render service is not configured (PDF_DOWNLOAD_SERVICE_URL / _USER_NAME / _USER_PASS)',
    })
  }

  // `body.filename` is client-controlled and gets interpolated into a response
  // header below, so it is sanitized rather than trusted — sanitizeDocumentFilename
  // strips quotes/CRLF/path separators and guarantees the LibertySupply prefix.
  const filename = sanitizeDocumentFilename(body.filename || `${template}-${body.docEntry}`)
  const auth = Buffer.from(`${username}:${password}`).toString('base64')

  let response: Response
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, '')}/render`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template,
        params: { DocEntry: String(body.docEntry) },
        filename,
      }),
    })
  } catch (fetchError) {
    console.error('PDF render service unreachable:', fetchError)
    throw createError({ statusCode: 502, statusMessage: 'PDF render service is unreachable' })
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    console.error(`PDF render failed (${response.status}) for ${template}/${body.docEntry}:`, detail)
    // Surface a missing document as a real 404 so the client can show a
    // "document not found" message instead of a generic render failure.
    if (response.status === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Requested document was not found' })
    }
    throw createError({ statusCode: 502, statusMessage: 'Failed to render document PDF' })
  }

  const pdf = Buffer.from(await response.arrayBuffer())
  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${filename}"`)
  setHeader(event, 'Content-Length', pdf.length)
  return pdf
})
