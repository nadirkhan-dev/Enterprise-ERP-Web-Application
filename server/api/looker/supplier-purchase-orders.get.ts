export default defineEventHandler(async (event) => {
  const { cardCode } = getQuery(event)

  if (!cardCode) {
    throw createError({ statusCode: 400, statusMessage: 'cardCode query parameter is required' })
  }

  // This endpoint always returns the supplier's full purchase-order set. The
  // dashboard tile is fetched unpaged either way, so slicing a page out here
  // would re-run the whole Looker query on every scroll. The client loads it
  // once and paginates in memory, so `page`/`limit` are intentionally not
  // honored here.
  try {
    // Data sourced from Looker dashboard 170 ("Supplier Purchase Orders") —
    // the dashboard tile defines the explore, fields and sort.
    const rows = await fetchDashboardTileRows('170', String(cardCode))

    return rows.map((row: any) => ({
      id: row['purchase_order.doc_num'],
      orderNumber: row['purchase_order.doc_num'],
      docEntry: row['purchase_order.doc_entry'],
      status: row['purchase_order.c_doc_status'],
      createdOn: row['purchase_order.create_date'],
      promiseShipBy: row['purchase_order.doc_due_date'],
      requestedBy: row['purchase_order.c_slp_code'],
      // "Document Total" is a dashboard custom measure named `document_total`
      // (a SUM of purchase_order.doc_total), not the base dimension — tile 170.
      documentTotal: row['document_total'],
      ownerCode: null,
    }))
  } catch (queryError) {
    console.error('Looker supplier purchase orders (dashboard 170) query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch purchase orders from Looker' })
  }
})
