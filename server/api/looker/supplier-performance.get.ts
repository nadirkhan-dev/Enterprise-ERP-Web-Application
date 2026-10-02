// The PO stat cards deep-link into this dashboard, so their figures are read
// from the very same tile (count + the tile's "Document Total" custom measure)
// rather than a PDT — a card and the Looker page it opens then always agree,
// and the figures are live rather than lagging the PDT's rebuild.
//
// NOTE: unlike the customer dashboards (166/167), tile 170 carries no
// "Document Cancelled" filter, so cancelled POs are included here — exactly as
// they already are in the Purchase Orders table, which reads the same tile.
const PURCHASE_ORDERS_DASHBOARD_ID = '170'

export default defineEventHandler(async (event) => {
  const { cardCode } = getQuery(event)

  if (!cardCode) {
    throw createError({ statusCode: 400, statusMessage: 'cardCode query parameter is required' })
  }

  const account = String(cardCode)
  const sdk = getLookerSdk()

  try {
    // The account-level fields have no purchase-order dashboard equivalent, so
    // they still come from the supplier metrics PDT.
    const [accountResult, purchaseOrders] = await Promise.all([
      sdk.ok(sdk.run_inline_query({
        result_format: 'json',
        body: {
          model: 'connect',
          view: 'connect_supplier_metrics_dt',
          fields: [
            'connect_supplier_metrics_dt.account_balance',
            'connect_supplier_metrics_dt.credit_limit',
          ],
          filters: {
            'connect_supplier_metrics_dt.account_number': account,
          },
          limit: '1',
        },
      })),
      fetchTileDocumentTotals(PURCHASE_ORDERS_DASHBOARD_ID, account),
    ])

    const parsed = typeof accountResult === 'string' ? JSON.parse(accountResult) : accountResult
    const row = Array.isArray(parsed) ? parsed[0] : null

    return {
      lifetimePoCount: purchaseOrders.lifetime.count,
      lifetimePoDollars: purchaseOrders.lifetime.dollars,
      openPoCount: purchaseOrders.open.count,
      openPoDollars: purchaseOrders.open.dollars,
      accountBalance: Number(row?.['connect_supplier_metrics_dt.account_balance'] ?? 0),
      creditLimit: Number(row?.['connect_supplier_metrics_dt.credit_limit'] ?? 0),
    }
  } catch (queryError) {
    console.error('Looker supplier performance query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch supplier performance from Looker' })
  }
})
