export default defineEventHandler(async (event) => {
  const { accountNumber } = getQuery(event)

  if (!accountNumber) {
    throw createError({ statusCode: 400, statusMessage: 'accountNumber query parameter is required' })
  }

  // This endpoint always returns the customer's full quote set (deduped to one
  // row per quote) — the dashboard tile is fetched unpaged. The client loads it
  // once and derives the Quotes total from the row count, so `page`/`limit` are
  // intentionally not honored here.
  try {
    // Data sourced from Looker dashboard 166 ("Customer Quotes Data") — the
    // dashboard tile defines the explore, fields and sort.
    const rows = await fetchDashboardTileRows('166', String(accountNumber))

    // The tile carries a `sales_quote_row`-grain field, so a quote with multiple
    // rows can come back repeated — collapse to one row per quote (doc_num),
    // keeping the first occurrence.
    const seenQuotes = new Set<string>()
    const quotes: Record<string, any>[] = []
    for (const row of rows as any[]) {
      const quoteNumber = row['sales_quote.doc_num']
      const key = String(quoteNumber)
      if (seenQuotes.has(key)) {continue}
      seenQuotes.add(key)
      quotes.push({
        quoteNumber,
        docEntry: row['sales_quote.doc_entry'],
        status: row['sales_quote.c_doc_status'],
        createdOn: row['sales_quote.c_create_time'],
        createdBy: row['sales_quote.c_user_sign'],
        requestedBy: row['sales_quote.c_cntct_code_name'],
        // "Document Total" is a dashboard custom measure named `document_total`
        // (a SUM of sales_quote.doc_total), not the base dimension — tile 166.
        documentTotal: row['document_total'],
      })
    }
    return quotes
  } catch (queryError) {
    console.error('Looker quotes (dashboard 166) query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch quotes from Looker' })
  }
})
