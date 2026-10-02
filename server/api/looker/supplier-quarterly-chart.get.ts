const TRAILING_QUARTERS = 9

function formatQuarterLabel(rawQuarter: string | null | undefined): string {
  if (!rawQuarter) return ''
  const value = String(rawQuarter)
  if (/^\d{4}-Q[1-4]$/i.test(value)) return value.toUpperCase()
  const match = value.match(/^(\d{4})-(\d{2})/)
  if (!match) return value
  const year = match[1]
  const month = Number.parseInt(match[2], 10)
  const quarter = Math.ceil(month / 3)
  return `${year}-Q${quarter}`
}

function getTrailingQuarters(count: number): string[] {
  const now = new Date()
  const currentQuarter = Math.ceil((now.getMonth() + 1) / 3)
  const currentYear = now.getFullYear()
  const labels: string[] = []
  for (let i = count - 1; i >= 0; i--) {
    let quarter = currentQuarter - i
    let year = currentYear
    while (quarter <= 0) {
      quarter += 4
      year -= 1
    }
    labels.push(`${year}-Q${quarter}`)
  }
  return labels
}

export default defineEventHandler(async (event) => {
  const { cardCode } = getQuery(event)

  if (!cardCode) {
    throw createError({ statusCode: 400, statusMessage: 'cardCode query parameter is required' })
  }

  const sdk = getLookerSdk()

  try {
    const queryResult = await sdk.ok(sdk.run_inline_query({
      result_format: 'json',
      body: {
        model: 'connect',
        view: 'connect_supplier_quarterly_dt',
        fields: [
          'connect_supplier_quarterly_dt.po_quarter',
          'connect_supplier_quarterly_dt.po_count',
          'connect_supplier_quarterly_dt.po_dollars',
        ],
        filters: {
          'connect_supplier_quarterly_dt.account_number': String(cardCode),
        },
        sorts: ['connect_supplier_quarterly_dt.po_quarter desc'],
        limit: String(TRAILING_QUARTERS),
      },
    }))

    const parsed = typeof queryResult === 'string' ? JSON.parse(queryResult) : queryResult
    const rawRows = Array.isArray(parsed) ? parsed : []

    // Index PDT results by quarter label so we can zero-fill missing quarters.
    const rowsByQuarter = new Map<string, { bookedSales: number, orderCount: number }>()
    for (const row of rawRows as any[]) {
      const label = formatQuarterLabel(row['connect_supplier_quarterly_dt.po_quarter'])
      if (!label) continue
      rowsByQuarter.set(label, {
        bookedSales: Number(row['connect_supplier_quarterly_dt.po_dollars'] || 0),
        orderCount: Number(row['connect_supplier_quarterly_dt.po_count'] || 0),
      })
    }

    // Always emit the trailing N quarters (matches the dashboard's `Created On Date=9 quarter`).
    const rows = getTrailingQuarters(TRAILING_QUARTERS).map(label => ({
      label,
      bookedSales: rowsByQuarter.get(label)?.bookedSales ?? 0,
      orderCount: rowsByQuarter.get(label)?.orderCount ?? 0,
    }))

    return { rows }
  } catch (queryError) {
    console.error('Looker supplier quarterly chart query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch quarterly chart from Looker' })
  }
})
