// Safety valve for the unfiltered, all-accounts document fetch
// (`fetchAllDashboardTileRows`). The per-customer fetch is naturally bounded,
// but an account-agnostic query could otherwise return the entire explore, so
// we cap it and log when the cap is hit rather than truncating silently.
const MAX_ALL_DOCUMENT_ROWS = 10000

// The "Document Total" custom measure the document dashboards (166 Quotes ·
// 167 Orders · 168 Invoices) define on their tile — a SUM of the underlying
// `<view>.doc_total`, i.e. the grand total including tax and freight.
const DOCUMENT_TOTAL_FIELD = 'document_total'

// Mirrors the stat cards' Looker deep-links: "lifetime" spans Open + Closed.
// Cancelled documents are already excluded by the tile's own `cancelled` filter.
const LIFETIME_STATUSES = 'Open,Closed'
const OPEN_STATUS = 'Open'

/**
 * Reads a Looker dashboard's table-tile query (explore, fields, filters, sorts)
 * — the single source of truth shared by the per-customer and all-accounts
 * fetches below.
 */
async function getDashboardTileQuery(dashboardId: string): Promise<Record<string, any>> {
  const sdk = getLookerSdk()

  const elements = await sdk.ok(sdk.dashboard_dashboard_elements(dashboardId, ''))
  const tile = (elements as any[]).find((element) => element?.query)
  if (!tile?.query) {
    throw createError({
      statusCode: 502,
      statusMessage: `Looker dashboard ${dashboardId} has no query tile`,
    })
  }
  return tile.query
}

interface TileQueryOverrides {
  // When set, query only these fields instead of the tile's full column set.
  // Also drops the tile's sorts/dynamic fields, which may reference columns not
  // in the override — and sidesteps any broken computed dimension we don't need.
  fields?: string[]
  sorts?: string[]
}

/**
 * Runs an inline query built from a dashboard tile's template, with the given
 * filters and row limit, and returns the parsed JSON rows.
 */
async function runTileInlineQuery(
  tileQuery: Record<string, any>,
  filters: Record<string, any>,
  limit: string,
  overrides: TileQueryOverrides = {},
): Promise<Record<string, any>[]> {
  const sdk = getLookerSdk()
  const usesOverrideFields = Boolean(overrides.fields)

  const queryResult = await sdk.ok(sdk.run_inline_query({
    result_format: 'json',
    body: {
      model: tileQuery.model,
      view: tileQuery.view,
      fields: overrides.fields ?? tileQuery.fields,
      filters,
      sorts: overrides.sorts ?? tileQuery.sorts,
      limit,
      // Drop the tile's table calcs when fields are narrowed — they may
      // reference columns no longer selected.
      dynamic_fields: usesOverrideFields ? undefined : (tileQuery.dynamic_fields ?? undefined),
    },
  }))

  const parsed = typeof queryResult === 'string' ? JSON.parse(queryResult) : queryResult
  return Array.isArray(parsed) ? parsed : []
}

/**
 * Runs a Looker dashboard's table tile, filtered to the given account, and
 * returns the raw result rows.
 *
 * The query (explore, fields, sorts, limit) is read live from the dashboard
 * tile — so the app's customer detail tables show exactly what the matching
 * Looker dashboard shows. The dashboard is the single source of truth; the
 * only thing applied here is the per-customer account filter.
 *
 * @param dashboardId   Looker dashboard id (e.g. '166').
 * @param accountNumber Customer account (card_code) to filter by.
 */
export async function fetchDashboardTileRows(
  dashboardId: string,
  accountNumber: string,
): Promise<Record<string, any>[]> {
  const tileQuery = await getDashboardTileQuery(dashboardId)

  // Re-point the dashboard's "Account Number" filter at the requested customer.
  const filters: Record<string, any> = { ...(tileQuery.filters ?? {}) }
  for (const filterKey of Object.keys(filters)) {
    if (filterKey.endsWith('.card_code')) {
      filters[filterKey] = accountNumber
    }
  }

  // Force unlimited — the dashboard tile is just a query template (which
  // fields/filters/sort to use); the app paginates client-side, so we
  // need every matching row, not the tile's 5000-row UI cap.
  return runTileInlineQuery(tileQuery, filters, '-1')
}

/**
 * Runs a Looker dashboard's table tile for EVERY account — the per-customer
 * `card_code` filter is dropped so all documents of that type come back. Used
 * by the dashboard document downloader, which has no partner context.
 *
 * Capped at `MAX_ALL_DOCUMENT_ROWS`; logs a warning when the cap is reached so
 * a truncated result is visible rather than silent. Non-account filters defined
 * on the tile (e.g. status) are preserved.
 *
 * Pass `fields` to query only the columns you need (e.g. doc number + DocEntry).
 * This keeps the payload small, lets Looker group/dedupe by those dimensions,
 * and avoids evaluating unused computed dimensions — some of which fail at the
 * SQL level when run unfiltered across all accounts.
 *
 * @param dashboardId Looker dashboard id (e.g. '167').
 * @param overrides   Optional field/sort narrowing for the inline query.
 */
export async function fetchAllDashboardTileRows(
  dashboardId: string,
  overrides: TileQueryOverrides = {},
): Promise<Record<string, any>[]> {
  const tileQuery = await getDashboardTileQuery(dashboardId)

  // Drop any account filter so the query spans all customers/suppliers.
  const filters: Record<string, any> = { ...(tileQuery.filters ?? {}) }
  for (const filterKey of Object.keys(filters)) {
    if (filterKey.endsWith('.card_code')) {
      delete filters[filterKey]
    }
  }

  const rows = await runTileInlineQuery(tileQuery, filters, String(MAX_ALL_DOCUMENT_ROWS), overrides)
  if (rows.length >= MAX_ALL_DOCUMENT_ROWS) {
    console.warn(
      `Looker dashboard ${dashboardId} all-accounts fetch hit the ${MAX_ALL_DOCUMENT_ROWS}-row cap — result is truncated.`,
    )
  }
  return rows
}

/** A tile's custom fields arrive as either JSON text or an already-parsed array. */
function parseDynamicFields(dynamicFields: unknown): Record<string, any>[] {
  if (!dynamicFields) { return [] }
  const parsed = typeof dynamicFields === 'string' ? JSON.parse(dynamicFields) : dynamicFields
  return Array.isArray(parsed) ? parsed : []
}

/** Looker returns money with float noise (300104.499999) — pin it to cents. */
function roundToCents(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100
}

export interface TileDocumentTotals {
  count: number
  dollars: number
}

/**
 * Collapses a document tile to its single "Totals" row — the document count and
 * the "Document Total" sum — under the tile's own filters plus the requested
 * document status.
 */
async function runTileTotals(
  tileQuery: Record<string, any>,
  documentView: string,
  accountNumber: string,
  documentStatus: string,
): Promise<TileDocumentTotals> {
  const sdk = getLookerSdk()

  const filters: Record<string, any> = { ...(tileQuery.filters ?? {}) }
  for (const filterKey of Object.keys(filters)) {
    if (filterKey.endsWith('.card_code')) {
      filters[filterKey] = accountNumber
    }
  }
  filters[`${documentView}.c_doc_status`] = documentStatus

  const countField = `${documentView}.count`
  const queryResult = await sdk.ok(sdk.run_inline_query({
    result_format: 'json',
    body: {
      model: tileQuery.model,
      view: tileQuery.view,
      // No dimensions — Looker aggregates to one row, the tile's Totals line.
      fields: [countField, DOCUMENT_TOTAL_FIELD],
      dynamic_fields: tileQuery.dynamic_fields ?? undefined,
      filters,
      limit: '1',
    },
  }))

  const parsed = typeof queryResult === 'string' ? JSON.parse(queryResult) : queryResult
  const row = Array.isArray(parsed) ? parsed[0] : null
  return {
    count: Number(row?.[countField] ?? 0),
    dollars: roundToCents(row?.[DOCUMENT_TOTAL_FIELD]),
  }
}

/**
 * Lifetime (Open + Closed) and Open totals for a customer, read from the same
 * dashboard tile the matching stat card deep-links to — so the card and the
 * Looker page it opens can never disagree.
 *
 * The tile is the single source of truth: its `Document Total` custom measure
 * names the document view it sums (`sales_quote.doc_total` → `sales_quote`),
 * which in turn gives us the count measure and status filter without hardcoding
 * per-dashboard field names.
 *
 * @param dashboardId   Looker dashboard id ('166' quotes, '167' orders).
 * @param accountNumber Customer account (card_code) to filter by.
 */
export async function fetchTileDocumentTotals(
  dashboardId: string,
  accountNumber: string,
): Promise<{ lifetime: TileDocumentTotals, open: TileDocumentTotals }> {
  const tileQuery = await getDashboardTileQuery(dashboardId)

  const documentTotal = parseDynamicFields(tileQuery.dynamic_fields)
    .find((field) => field.measure === DOCUMENT_TOTAL_FIELD)
  const documentView = String(documentTotal?.based_on ?? '').split('.')[0]
  if (!documentView) {
    throw createError({
      statusCode: 502,
      statusMessage: `Looker dashboard ${dashboardId} has no "${DOCUMENT_TOTAL_FIELD}" custom measure`,
    })
  }

  const [lifetime, open] = await Promise.all([
    runTileTotals(tileQuery, documentView, accountNumber, LIFETIME_STATUSES),
    runTileTotals(tileQuery, documentView, accountNumber, OPEN_STATUS),
  ])
  return { lifetime, open }
}
