// The quote/order stat cards deep-link into these dashboards, so their figures
// are read from the very same tiles (count + the tile's "Document Total" custom
// measure) rather than a PDT. A card and the Looker page it opens then always
// agree — including tax and freight, which `doc_total` carries but the PDT's
// subtotal-based `*_dollars` did not.
const QUOTES_DASHBOARD_ID = '166'
const ORDERS_DASHBOARD_ID = '167'

export default defineEventHandler(async (event) => {
  const { accountNumber } = getQuery(event)

  if (!accountNumber) {
    throw createError({ statusCode: 400, statusMessage: 'accountNumber query parameter is required' })
  }

  const account = String(accountNumber)
  const sdk = getLookerSdk()

  try {
    // The account-level fields have no document-dashboard equivalent, so they
    // still come from the customer metrics PDT.
    const [accountResult, quotes, orders] = await Promise.all([
      sdk.ok(sdk.run_inline_query({
        result_format: 'json',
        body: {
          model: 'connect',
          view: 'connect_customer_metrics_dt',
          fields: [
            'connect_customer_metrics_dt.account_balance',
            'connect_customer_metrics_dt.credit_limit',
            'connect_customer_metrics_dt.payment_terms',
            'connect_customer_metrics_dt.account_standing',
          ],
          filters: {
            'connect_customer_metrics_dt.account_number': account,
          },
          limit: '1',
        },
      })),
      fetchTileDocumentTotals(QUOTES_DASHBOARD_ID, account),
      fetchTileDocumentTotals(ORDERS_DASHBOARD_ID, account),
    ])

    const parsed = typeof accountResult === 'string' ? JSON.parse(accountResult) : accountResult
    const row = Array.isArray(parsed) ? parsed[0] : null

    return {
      lifetimeQuoteCount: quotes.lifetime.count,
      lifetimeQuoteDollars: quotes.lifetime.dollars,
      openQuoteCount: quotes.open.count,
      openQuoteDollars: quotes.open.dollars,
      lifetimeOrderCount: orders.lifetime.count,
      lifetimeOrderDollars: orders.lifetime.dollars,
      openOrderCount: orders.open.count,
      openOrderDollars: orders.open.dollars,
      accountBalance: Number(row?.['connect_customer_metrics_dt.account_balance'] ?? 0),
      creditLimit: Number(row?.['connect_customer_metrics_dt.credit_limit'] ?? 0),
      paymentTerms: (row?.['connect_customer_metrics_dt.payment_terms'] as string | null) ?? null,
      accountStanding: (row?.['connect_customer_metrics_dt.account_standing'] as string | undefined) ?? '',
    }
  } catch (queryError) {
    console.error('Looker customer metrics query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch customer metrics from Looker' })
  }
})
