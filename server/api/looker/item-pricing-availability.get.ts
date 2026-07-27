export default defineEventHandler(async (event) => {
  const { itemCode } = getQuery(event)

  if (!itemCode) {
    throw createError({ statusCode: 400, statusMessage: 'itemCode query parameter is required' })
  }

  const sdk = getLookerSdk()

  const pricingPromise = sdk.ok(sdk.run_inline_query({
    result_format: 'json',
    body: {
      model: 'inventory',
      view: 'item',
      fields: [
        'item.item_code',
        'item_price.c_price_list',
        'item_price.c_item_cost',
        'item_price.price',
        'item_price.c_gross_margin',
        'item.min_ordr_qty',
      ],
      filters: {
        'item.item_code': String(itemCode),
      },
      limit: '50',
    },
  }))

  const inventoryPromise = sdk.ok(sdk.run_inline_query({
    result_format: 'json',
    body: {
      model: 'inventory',
      view: 'inventory',
      fields: [
        'inventory.item_code',
        'inventory.whs_code',
        'inventory.c_available',
        'bin_location_via_bin_abs.bin_code',
        'bin_inventory.on_hand_qty',
      ],
      filters: {
        'inventory.item_code': String(itemCode),
      },
      sorts: ['inventory.whs_code', 'bin_location_via_bin_abs.bin_code'],
      limit: '500',
    },
  }))

  let pricingRaw, inventoryRaw
  try {
    [pricingRaw, inventoryRaw] = await Promise.all([pricingPromise, inventoryPromise])
  } catch (queryError) {
    console.error('Looker item pricing/availability query failed:', queryError)
    throw createError({ statusCode: 502, statusMessage: 'Failed to fetch item data from Looker' })
  }

  const pricingRows = (typeof pricingRaw === 'string' ? JSON.parse(pricingRaw) : pricingRaw) as any[]
  const inventoryRows = (typeof inventoryRaw === 'string' ? JSON.parse(inventoryRaw) : inventoryRaw) as any[]

  const costRow = pricingRows.find(row => row['item_price.c_price_list'] === 'Cost')
  const priceRow = pricingRows.find(row => row['item_price.c_price_list'] === 'Price')
  const listRow = pricingRows.find(row => row['item_price.c_price_list'] === 'List')

  const baseCost = costRow?.['item_price.c_item_cost'] ?? priceRow?.['item_price.c_item_cost'] ?? null
  const offerPrice = priceRow?.['item_price.price'] ?? null
  const manufacturerListPrice = listRow?.['item_price.price'] ?? null
  // Gross margin is computed in Looker (`item_price.c_gross_margin` = gross profit ÷ price)
  // and lives on the "Price" price-list row. Returned as a raw decimal fraction (e.g. 0.24).
  const grossMargin = priceRow?.['item_price.c_gross_margin'] ?? null
  // Minimum order quantity from SAP Planning Data (`item.min_ordr_qty`); item-level,
  // so it's identical on every price row. Null when the item has no minimum set.
  const minOrderQty = pricingRows.find(row => row['item.min_ordr_qty'] != null)?.['item.min_ordr_qty'] ?? null

  const inventory = (Array.isArray(inventoryRows) ? inventoryRows : []).map((row: any) => ({
    warehouse: row['inventory.whs_code'] ?? '',
    binLocation: row['bin_location_via_bin_abs.bin_code'] ?? '',
    // Availability must never be negative — Looker on-hand can go below zero for
    // oversold/committed inventory, so clamp to a floor of 0.
    available: Math.max(0, Number(row['bin_inventory.on_hand_qty'] ?? row['inventory.c_available'] ?? 0) || 0),
    unitCost: baseCost,
  }))

  return {
    baseCost,
    offerPrice,
    grossMargin,
    manufacturerListPrice,
    minOrderQty,
    inventory,
  }
})
