export default defineEventHandler(async (event) => {
  const { accountNumber } = getQuery(event)

  if (!accountNumber) {
    throw createError({ statusCode: 400, statusMessage: 'accountNumber query parameter is required' })
  }

  // This endpoint always returns the customer's full invoice set (deduped to
  // one row per invoice) — the dashboard tile is fetched unpaged. The client
  // loads it once and derives the Invoices total from the row count, so
  // `page`/`limit` are intentionally not honored here.
  try {
    // Data sourced from Looker dashboard 168 ("Customer Invoices Data") — the
    // dashboard tile defines the explore, fields and sort.
    const rows = await fetchDashboardTileRows('168', String(accountNumber))

    // Collapse to one row per invoice (doc_num), keeping the first occurrence —
    // a row-grain field on the tile would otherwise repeat the invoice.
    const seenInvoices = new Set<string>()
    const invoices: Record<string, any>[] = []
    for (const row of rows as any[]) {
      const invoiceNumber = row['ar_invoice.doc_num']
      const key = String(invoiceNumber)
      if (seenInvoices.has(key)) {continue}
      seenInvoices.add(key)
      invoices.push({
        invoiceNumber,
        docEntry: row['ar_invoice.doc_entry'],
        status: row['ar_invoice.c_doc_status'],
        postingDate: row['ar_invoice.create_date'],
        paymentDue: row['ar_invoice.doc_due_date'],
        // "Document Total" is a dashboard custom measure named `document_total`
        // (a SUM of ar_invoice.doc_total), not the base dimension — tile 168.
        documentTotal: row['document_total'],
        balanceDue: row['ar_invoice.c_payment_balance_due'],
      })
    }
    return invoices
  } catch (queryError) {
    console.error('Looker invoices (dashboard 168) query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch invoices from Looker' })
  }
})
