export default defineEventHandler(async (event) => {
  const { accountNumber } = getQuery(event)

  if (!accountNumber) {
    throw createError({ statusCode: 400, statusMessage: 'accountNumber query parameter is required' })
  }

  // This endpoint always returns the customer's full order set (deduped to one
  // row per order) — the dashboard tile is fetched unpaged. The client loads it
  // once and derives the Orders total from the row count, so `page`/`limit` are
  // intentionally not honored here.
  try {
    // Data sourced from Looker dashboard 167 ("Customer Orders Data") — the
    // dashboard tile defines the explore, fields and sort.
    const rows = await fetchDashboardTileRows('167', String(accountNumber))

    // The tile's `ref_delivery_row` field is at delivery-row grain, so an order
    // with multiple delivery rows comes back repeated — collapse to one row
    // per order (doc_num), keeping the first occurrence.
    const seenOrders = new Set<string>()
    const orders: Record<string, any>[] = []
    for (const row of rows as any[]) {
      const orderNumber = row['sales_order.doc_num']
      const key = String(orderNumber)
      if (seenOrders.has(key)) {continue}
      seenOrders.add(key)
      orders.push({
        orderNumber,
        docEntry: row['sales_order.doc_entry'],
        status: row['sales_order.c_doc_status'],
        createdOn: row['sales_order.create_date'],
        createdBy: row['sales_order.c_user_sign'],
        promiseShipBy: row['ref_delivery_row.ship_date'],
        requestedBy: row['sales_order.c_cntct_code_name'],
        // "Document Total" is a dashboard custom measure named `document_total`
        // (a SUM of sales_order.doc_total), not the base dimension — tile 167.
        documentTotal: row['document_total'],
      })
    }
    return orders
  } catch (queryError) {
    console.error('Looker orders (dashboard 167) query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch orders from Looker' })
  }
})
