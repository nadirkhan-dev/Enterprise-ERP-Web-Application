// Returns every document of a given type (across all accounts) as a lightweight
// { docEntry, number } list for the dashboard document downloader. Each type
// maps to the same Looker dashboard tile the customer/supplier sections use, but
// without the per-account filter (see fetchAllDashboardTileRows).

interface DocumentSource {
  dashboardId: string
  numberField: string
  docEntryField: string
}

const DOCUMENT_SOURCES: Record<string, DocumentSource> = {
  'sales-quotes': { dashboardId: '166', numberField: 'sales_quote.doc_num', docEntryField: 'sales_quote.doc_entry' },
  'sales-orders': { dashboardId: '167', numberField: 'sales_order.doc_num', docEntryField: 'sales_order.doc_entry' },
  'sales-invoices': { dashboardId: '168', numberField: 'ar_invoice.doc_num', docEntryField: 'ar_invoice.doc_entry' },
  'purchase-orders': { dashboardId: '170', numberField: 'purchase_order.doc_num', docEntryField: 'purchase_order.doc_entry' },
}

export default defineEventHandler(async (event) => {
  const { type } = getQuery(event)
  const source = DOCUMENT_SOURCES[String(type)]

  if (!source) {
    throw createError({
      statusCode: 400,
      statusMessage: `type must be one of: ${Object.keys(DOCUMENT_SOURCES).join(', ')}`,
    })
  }

  try {
    // Request only the columns we map — keeps the payload light and avoids the
    // tile's other (sometimes SQL-broken) computed dimensions. Newest first.
    const rows = await fetchAllDashboardTileRows(source.dashboardId, {
      fields: [source.numberField, source.docEntryField],
      sorts: [`${source.docEntryField} desc`],
    })

    // Some tiles (e.g. orders at delivery-row grain) repeat a document across
    // rows, so collapse to one entry per DocEntry, keeping the first occurrence.
    const seen = new Set<string>()
    const documents: { docEntry: string, number: string | number }[] = []
    for (const row of rows) {
      const docEntry = row[source.docEntryField]
      if (docEntry === undefined || docEntry === null) {
        continue
      }
      const key = String(docEntry)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      documents.push({ docEntry: key, number: row[source.numberField] ?? key })
    }

    return documents
  } catch (queryError) {
    console.error(`Looker all-documents query failed for ${String(type)}:`, queryError)
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to fetch documents from Looker',
      // Surface the underlying detail in dev only — avoid leaking internal SQL
      // errors to production clients.
      data: import.meta.dev
        ? { detail: queryError instanceof Error ? queryError.message : String(queryError) }
        : undefined,
    })
  }
})
