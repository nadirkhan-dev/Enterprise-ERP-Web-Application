export default defineEventHandler(async (event) => {
  const { accountNumber } = getQuery(event)

  if (!accountNumber) {
    throw createError({ statusCode: 400, statusMessage: 'accountNumber query parameter is required' })
  }

  // This endpoint always returns the customer's full shipment set (deduped to
  // one row per delivery) — the dashboard tile is fetched unpaged. The client
  // loads it once and derives the Shipments total from the row count, so
  // `page`/`limit` are intentionally not honored here.
  try {
    // Data sourced from Looker dashboard 169 ("Customer Shipments Data") — the
    // dashboard tile defines the explore, fields and sort.
    const rows = await fetchDashboardTileRows('169', String(accountNumber))

    // Collapse to one row per delivery (doc_entry), keeping the first
    // occurrence — a row-grain field on the tile would otherwise repeat the
    // delivery.
    const seenDeliveries = new Set<string>()
    const shipments: Record<string, any>[] = []
    for (const row of rows as any[]) {
      // Delivery doc id for the "sales-deliveries" PDF download (same
      // <view>.doc_entry convention as orders/invoices).
      const docEntry = row['ref_delivery.doc_entry']
      const key = String(docEntry)
      if (seenDeliveries.has(key)) {continue}
      seenDeliveries.add(key)
      shipments.push({
        order_number: row['sales_order.doc_num'],
        order_date: row['sales_order.create_date'],
        shipment_date: row['ref_delivery.create_date'],
        method: row['sales_order.c_trnsp_code'],
        // carrier: row['<new Looker carrier field — pending dashboard 169>'],
        tracking: row['ref_delivery.track_no'],
        docEntry,
      })
    }
    return shipments
  } catch (queryError) {
    console.error('Looker shipments (dashboard 169) query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch shipments from Looker' })
  }
})
