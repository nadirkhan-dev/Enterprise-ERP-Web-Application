import type { FieldChoice } from '~/composables/useFieldNotes'
import type { ManufacturerSupplier } from '~/composables/useManufacturers'
export type ItemSupplierRow = ManufacturerSupplier & { _logoSrc?: string | null, _logoSrcset?: string | null }

export type ItemReactive = {
  sku: string
  status: string
  name: string
  manufacturer: string
  mpn: string
  category: string
  remarks: string
  baseCost: string
  offerPrice: string
  grossMargin: string
  manufacturerListPrice: string
  // Display name of the linked shipping group (e.g. 'Parcel', 'LTL').
  shippingGroup: string
  // Immutable business-logic code of the shipping group (e.g. 'parcel', 'ltl').
  shippingGroupCode: string
  // Primary key of the linked shipping group — drives the accessorial lookup.
  shippingGroupId: number | null
  shippingLength: string
  shippingWidth: string
  shippingHeight: string
  shippingWeight: string
  shippingVolume: string
  unitWeight: string
  allowReturns: boolean
  // Raw numeric values for downstream consumers (e.g. shipping rate API).
  shippingLengthRaw: number | null
  shippingWidthRaw: number | null
  shippingHeightRaw: number | null
  shippingWeightRaw: number | null
}

export interface InventoryRow {
  warehouse: string
  binLocation: string
  available: number
  unitCost: string
  minOrderQty: number
}

// SAP warehouse code for Liberty's MSP01 (Minneapolis) — the only Connect-relevant
// warehouse Looker returns (DROPSHIP/RTN01 are excluded). It must always be listed
// on the item page so a shipping estimate can be requested from it, even for
// special-order/non-stock SKUs that carry no availability.
const MSP01_WAREHOUSE_CODE = 'MSP01'

export function createEmptyItem(): ItemReactive {
  return {
    sku: '',
    status: '',
    name: '',
    manufacturer: '',
    mpn: '',
    category: '',
    remarks: '',
    baseCost: '—',
    offerPrice: '—',
    grossMargin: '—',
    manufacturerListPrice: '—',
    shippingGroup: '',
    shippingGroupCode: '',
    shippingGroupId: null,
    shippingLength: '—',
    shippingWidth: '—',
    shippingHeight: '—',
    shippingWeight: '—',
    shippingVolume: '—',
    unitWeight: '—',
    allowReturns: true,
    shippingLengthRaw: null,
    shippingWidthRaw: null,
    shippingHeightRaw: null,
    shippingWeightRaw: null,
  }
}

function formatDimension(value: number | null, unit: string) {
  if (value === null) return '—'
  return `${Number(value)}${unit}`
}

function formatWeight(value: number | null) {
  if (value === null) return '—'
  return `${Number(value)} lbs`
}

const CHOICE_NOTE_SEPARATOR = ' - '
function parseChoiceText(text: string): { label: string, note: string } {
  const separatorIndex = text.indexOf(CHOICE_NOTE_SEPARATOR)
  if (separatorIndex === -1) {
    return { label: text.trim(), note: '' }
  }

  return {
    label: text.slice(0, separatorIndex).trim(),
    note: text.slice(separatorIndex + CHOICE_NOTE_SEPARATOR.length).trim(),
  }
}

type LoaderOptions = {
  item: ItemReactive
  applyPricingSnapshot: (baseCost: number | null, offerPrice: number | null, grossMargin?: number | null) => void
  formatCurrency: (value: number | null) => string
}

export function useItemDetail({ item, applyPricingSnapshot, formatCurrency }: LoaderOptions) {
  const route = useRoute()
  const { fetchItemBySku } = useItems()
  const { fetchItemPricingAvailability, fetchItemQuarterlyChart } = useLooker()
  const { fetchFieldChoices } = useFieldNotes()
  const { fetchManufacturerSuppliers } = useManufacturers()
  const { fetchProductSupplierGroupId } = useBusinessPartnerGroups()
  const { hydrateAssetImages } = useAssetImageRows({ fileIdKey: 'logoId', width: LOGO_THUMB_WIDTH })

  // Suppliers belong to the item's manufacturer (Supplier ↔ Manufacturer, via the
  // manufacturers_business_partners junction) — surfaced read/edit on the item
  // page, but the relationship is manufacturer-wide (CONNECT-556).
  const manufacturerId = ref<number | null>(null)
  const suppliers = ref<ItemSupplierRow[]>([])

  const inventory = ref<InventoryRow[]>([])
  // MOQ is an item-level value, stamped onto every availability row (not a
  // per-warehouse figure). Primary source is Looker (`item.min_ordr_qty`); the
  // Directus `items.min_sale_qty` captured on item load is the fallback, and 1
  // the default when neither source has a minimum.
  const itemMinOrderQty = ref(1)
  const documents = ref<Record<string, any>[]>([])
  const alternateItems = ref<Record<string, any>[]>([])
  const repairParts = ref<Record<string, any>[]>([])
  const crossSells = ref<Record<string, any>[]>([])
  const productionTypeValue = ref('')
  const productionTypeChoices = ref<FieldChoice[]>([])

  const productionTypeChoice = computed(() => {
    const match = productionTypeChoices.value.find((choice) => choice.value === productionTypeValue.value)
    return match ? parseChoiceText(match.text) : null
  })

  // Falls back to the raw code (e.g. 'ATO') while the choice list is in flight,
  // or if SupplyHub drops the value from its choices.
  const productionTypeLabel = computed(() => productionTypeChoice.value?.label || productionTypeValue.value || '—')
  const productionTypeNote = computed(() => productionTypeChoice.value?.note || '')

  const isLoading = ref(true)
  const isPricingLoading = ref(true)
  const hasLoadError = ref(false)
  const loadError = ref<string | null>(null)

  // Quarterly performance chart (Looker dashboard NUXT_LOOKER_ITEM_CHART_DASHBOARD_ID).
  const chartBars = ref<{ label: string, bookedSales: number, orderCount: number }[]>([])
  const isChartLoading = ref(true)
  // Computed so the "Looker" header link is available *before* the chart
  // API resolves — otherwise it'd be hidden during skeleton loading.
  // Mirrors the pattern in Suppliers/[id].vue.
  const chartLookerUrl = computed(() => {
    const sku = route.params.id ? String(route.params.id) : ''
    if (!sku) return null
    const params = new URLSearchParams()
    params.set('Created On Date', '9 quarter')
    params.set('Item SKU', sku)
    return `https://libertysupply.cloud.looker.com/dashboards/163?${params.toString()}`
  })

  async function loadItemQuarterlyChart(itemCode: string) {
    if (!itemCode) {
      chartBars.value = []
      isChartLoading.value = false
      return
    }
    isChartLoading.value = true
    const { data, error } = await fetchItemQuarterlyChart(itemCode)
    if (error) {
      console.error('Failed to load item quarterly chart:', error.message)
      chartBars.value = []
      isChartLoading.value = false
      return
    }
    chartBars.value = data?.rows ?? []
    isChartLoading.value = false
  }

  async function loadItemPricingAvailability(itemCode: string) {
    const { data: pricing, error } = await fetchItemPricingAvailability(itemCode)
    if (error) {
      console.error('Failed to load Looker pricing/availability:', error.message)
      isPricingLoading.value = false
      return
    }

    applyPricingSnapshot(pricing.baseCost, pricing.offerPrice, pricing.grossMargin)

    // Manufacturer list price: prefer Looker's "List" price-list row; the Directus
    // value set during loadItem() stays as the fallback when Looker has none.
    if (pricing.manufacturerListPrice !== null) {
      item.manufacturerListPrice = formatCurrency(pricing.manufacturerListPrice)
    }

    // MOQ: prefer Looker's minimum order qty; the Directus-derived value remains
    // the fallback (and 1 the ultimate default) when Looker has none.
    if (pricing.minOrderQty) {
      itemMinOrderQty.value = pricing.minOrderQty
    }

    // Exclude warehouses that are not relevant for Connect.
    const EXCLUDED_WAREHOUSES = new Set(['DROPSHIP', 'RTN01'])
    const warehouseInventory = pricing.inventory
      .filter((row) => !EXCLUDED_WAREHOUSES.has(row.warehouse))
      .map((row) => ({
        warehouse: row.warehouse,
        binLocation: row.binLocation,
        // Never surface a negative count: committed stock can push Looker's
        // on-hand below zero, so clamp the displayed availability to a floor of
        // 0. (The Looker endpoint clamps too; this guards the rendered value.)
        available: Math.max(0, row.available),
        unitCost: formatCurrency(row.unitCost),
        minOrderQty: itemMinOrderQty.value,
      }))

    // MSP01 must always be listed so a shipping estimate (outbound + inbound)
    // can be requested from it — even for special-order/non-stock (LSS) SKUs,
    // where inventory is not a reliable indicator and Looker returns no MSP01
    // availability row. Synthesize a zero-availability MSP01 row when it's absent.
    if (!warehouseInventory.some((row) => row.warehouse === MSP01_WAREHOUSE_CODE)) {
      warehouseInventory.push({
        warehouse: MSP01_WAREHOUSE_CODE,
        binLocation: '—',
        available: 0,
        unitCost: formatCurrency(pricing.baseCost),
        minOrderQty: itemMinOrderQty.value,
      })
    }

    inventory.value = warehouseInventory
    isPricingLoading.value = false
  }

  async function loadItem() {
    if (!route.params.id) {
      navigateTo('/items')
      return
    }

    isLoading.value = true
    hasLoadError.value = false
    loadError.value = null

    const sku = String(route.params.id)

    // Fire the PDT-backed quarterly chart call in parallel with the Directus
    // fetch — it only needs the SKU from the route, dodging the browser's
    // per-origin connection cap so it isn't queued behind later requests.
    isChartLoading.value = true
    chartBars.value = []
    loadItemQuarterlyChart(sku)

    const { data: itemData, error } = await fetchItemBySku(sku)

    if (error) {
      console.error('Failed to load item:', error.message)
      if (isServerError(error)) {
        hasLoadError.value = true
      } else {
        loadError.value = 'Failed to load item. Please try again.'
      }
      isLoading.value = false
      return
    }

    if (!itemData) {
      loadError.value = `Item "${route.params.id}" not found.`
      isLoading.value = false
      return
    }

    item.sku = itemData.sku || ''
    item.status = itemData.status || ''
    item.name = itemData.description || ''
    item.manufacturer = (itemData.manufacturers_id as any)?.name || ''
    manufacturerId.value = (itemData.manufacturers_id as any)?.id ?? null
    item.mpn = itemData.mpn || ''
    item.category = (itemData.item_groups_id as any)?.name || ''
    item.remarks = (itemData as any).remarks || ''
    applyPricingSnapshot(itemData.base_cost ?? null, itemData.offer_price ?? null)
    item.manufacturerListPrice = formatCurrency(itemData.mfr_list_price)
    item.shippingGroup = (itemData.shipping_groups_id as any)?.name || ''
    item.shippingGroupCode = (itemData.shipping_groups_id as any)?.code || ''
    item.shippingGroupId = (itemData.shipping_groups_id as any)?.id ?? null
    item.shippingLength = formatDimension(itemData.shipping_length_in, '"')
    item.shippingWidth = formatDimension(itemData.shipping_width_in, '"')
    item.shippingHeight = formatDimension(itemData.shipping_height_in, '"')
    item.shippingWeight = formatWeight(itemData.shipping_weight_lb)
    item.shippingLengthRaw = itemData.shipping_length_in
    item.shippingWidthRaw = itemData.shipping_width_in
    item.shippingHeightRaw = itemData.shipping_height_in
    item.shippingWeightRaw = itemData.shipping_weight_lb
    item.shippingVolume = itemData.shipping_volume_in !== null ? String(itemData.shipping_volume_in) : '—'
    item.unitWeight = formatWeight(itemData.unit_weight_lb)
    productionTypeValue.value = itemData.production_type || ''
    // Directus `allow_returns` defaults to true; treat anything but an
    // explicit `false` as returnable so legacy rows don't read as non-returnable.
    item.allowReturns = itemData.allow_returns !== false
    // Directus minimum sales/order quantity — fallback for MOQ until the Looker
    // value (`item.min_ordr_qty`) arrives from loadItemPricingAvailability().
    itemMinOrderQty.value = itemData.min_sale_qty || 1

    isLoading.value = false

    // Suppliers come from the item's manufacturer — load once the id is known.
    suppliers.value = []
    loadSuppliers()

    if (item.sku) {
      isPricingLoading.value = true
      loadItemPricingAvailability(item.sku)
      // Quarterly chart already kicked off pre-Directus above.
    }
  }

  async function loadSuppliers() {
    if (manufacturerId.value == null) {
      suppliers.value = []
      return
    }
    const [{ data, error }, productGroupId] = await Promise.all([
      fetchManufacturerSuppliers(manufacturerId.value),
      fetchProductSupplierGroupId(),
    ])
    if (error || !data) {
      suppliers.value = []
      return
    }
    // An unresolved group id means the reference read failed — show every
    // supplier rather than emptying the table on a lookup hiccup.
    const productSuppliers = productGroupId == null
      ? data
      : data.filter((supplier) => supplier.groupId === productGroupId)
    await hydrateAssetImages(productSuppliers)
    suppliers.value = productSuppliers
  }

  async function loadItemFieldMeta() {
    const { data: choices, error } = await fetchFieldChoices('items')
    if (error || !choices) return
    productionTypeChoices.value = choices.production_type || []
  }

  watch(() => route.params.id, () => loadItem())

  return {
    inventory,
    documents,
    alternateItems,
    repairParts,
    crossSells,
    productionTypeLabel,
    productionTypeNote,
    isLoading,
    isPricingLoading,
    hasLoadError,
    loadError,
    chartBars,
    isChartLoading,
    chartLookerUrl,
    manufacturerId,
    suppliers,
    loadSuppliers,
    loadItem,
    loadItemFieldMeta,
  }
}
