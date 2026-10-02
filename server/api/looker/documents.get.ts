
interface DocumentFields {
  numberField: string
  docEntryField: string
}

type DocumentSource = DocumentFields & (
  | { dashboardId: string }
  | { model: string, explore: string, filters: Record<string, string> }
  | { connection: string, table: string, numberColumn: string, docEntryColumn: string, where: string }
)

const NOT_CANCELED = 'N'

// The Looker connection behind every explore here, reused by the one type that
// has to reach its table directly.
const SAP_CONNECTION = 'libertysupply_sap'

const DOCUMENT_SOURCES: Record<string, DocumentSource> = {
  'sales-quotes': { dashboardId: '166', numberField: 'sales_quote.doc_num', docEntryField: 'sales_quote.doc_entry' },
  'sales-orders': { dashboardId: '167', numberField: 'sales_order.doc_num', docEntryField: 'sales_order.doc_entry' },
  'sales-invoices': { dashboardId: '168', numberField: 'ar_invoice.doc_num', docEntryField: 'ar_invoice.doc_entry' },
  'purchase-orders': { dashboardId: '170', numberField: 'purchase_order.doc_num', docEntryField: 'purchase_order.doc_entry' },
  'return-requests': {
    model: 'sales',
    explore: 'ar_return_request_row',
    numberField: 'ar_return_request.doc_num',
    docEntryField: 'ar_return_request.doc_entry',
    filters: { 'ar_return_request.canceled': NOT_CANCELED },
  },
  'sales-creditmemo': {
    model: 'sales',
    explore: 'ar_credit_memo_row',
    numberField: 'ar_credit_memo.doc_num',
    docEntryField: 'ar_credit_memo.doc_entry',
    filters: { 'ar_credit_memo.canceled': NOT_CANCELED },
  },
  // Deliveries and packing slips are the same SAP document (ODLN) rendered
  // through two templates, so a number resolves identically for both.
  'sales-deliveries': {
    model: 'sales',
    explore: 'delivery_row',
    numberField: 'delivery.doc_num',
    docEntryField: 'delivery.doc_entry',
    filters: { 'delivery.canceled': NOT_CANCELED },
  },
  'sales-packingslip': {
    model: 'sales',
    explore: 'delivery_row',
    numberField: 'delivery.doc_num',
    docEntryField: 'delivery.doc_entry',
    filters: { 'delivery.canceled': NOT_CANCELED },
  },
  'sales-dpinvoices': {
    connection: SAP_CONNECTION,
    table: 'ODPI',
    numberColumn: 'DocNum',
    docEntryColumn: 'DocEntry',
    where: `CANCELED = '${NOT_CANCELED}'`,
    numberField: 'odpi.doc_num',
    docEntryField: 'odpi.doc_entry',
  },
}
function buildDocumentSql(
  source: DocumentFields & { table: string, numberColumn: string, docEntryColumn: string, where: string },
  digits: string,
): string {
  return `SELECT TOP (1) `
    + `${source.numberColumn} AS [${source.numberField}], `
    + `${source.docEntryColumn} AS [${source.docEntryField}] `
    + `FROM ${source.table} `
    + `WHERE ${source.where} AND ${source.numberColumn} = ${digits}`
}

export default defineEventHandler(async (event) => {
  const { type, number } = getQuery(event)
  const source = DOCUMENT_SOURCES[String(type)]

  if (!source) {
    throw createError({
      statusCode: 400,
      statusMessage: `type must be one of: ${Object.keys(DOCUMENT_SOURCES).join(', ')}`,
    })
  }

  const digits = String(number ?? '').replace(/\D+/g, '')
  if (!digits) {
    throw createError({ statusCode: 400, statusMessage: 'number is required' })
  }

  try {
    const overrides = {
      fields: [source.numberField, source.docEntryField],
      limit: '1',
      extraFilters: { [source.numberField]: digits },
    }

    let rows: Record<string, any>[]
    if ('dashboardId' in source) {
      rows = await fetchAllDashboardTileRows(source.dashboardId, overrides)
    } else if ('connection' in source) {
      rows = await fetchSqlRunnerRows(source.connection, buildDocumentSql(source, digits))
    } else {
      rows = await fetchExploreRows(source.model, source.explore, source.filters, overrides)
    }

    // Row-grain tiles repeat a document across rows; any of them carries the
    // DocEntry we want.
    const row = rows.find(candidate =>
      candidate[source.docEntryField] !== undefined && candidate[source.docEntryField] !== null)

    if (!row) {
      throw createError({
        statusCode: 404,
        statusMessage: `No document found with number ${digits}`,
      })
    }

    return {
      docEntry: String(row[source.docEntryField]),
      number: row[source.numberField] ?? digits,
    }
  } catch (queryError) {
    // A 404 is an answer, not a failure — let it through untouched.
    if ((queryError as { statusCode?: number })?.statusCode === 404) {
      throw queryError
    }
    console.error(`Looker document lookup failed for ${String(type)} #${digits}:`, queryError)
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to look up the document in Looker',
      // Surface the underlying detail in dev only — avoid leaking internal SQL
      // errors to production clients.
      data: import.meta.dev
        ? { detail: queryError instanceof Error ? queryError.message : String(queryError) }
        : undefined,
    })
  }
})
