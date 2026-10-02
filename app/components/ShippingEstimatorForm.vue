<script setup lang="ts">
import ltlIconUrl from '~/assets/icons/ltl.svg'
import type { InputNumberInputEvent } from 'primevue/inputnumber'
import type { ShippingAccessorialOption } from '~/composables/useShippingAccessorials'
import type { ShippingEstimate } from '~/composables/useShippingEstimates'
import type { Warehouse } from '~/composables/useWarehouses'

// The estimator runs in two modes, sharing all rate logic below:
//  • 'item'   — the item-detail drawer supplies weight, dimensions, shipping
//               category and the item's suppliers (see DrawerShippingEstimator).
//  • 'manual' — the standalone /tools page: the user types the weight and picks
//               Parcel/LTL, suppliers are fetched, dimensions fall back to the
//               default package.
type EstimatorMode = 'item' | 'manual'
type ShippingCategory = 'parcel' | 'LTL'
// Where the shipment starts. The trigger row picks the initial side (a warehouse
// row opens on 'warehouse', a supplier row on 'supplier'); the Ship From toggle
// lets the user switch afterwards.
type ShipFromSource = 'warehouse' | 'supplier'

// A supplier the estimate can ship from — either one of the item's associated
// suppliers or the warehouse's linked supplier.
interface SupplierOption {
  id: number | string
  name: string
  accountNumber?: string | null
}

// What the trigger row hands the drawer. The drawer UI is identical either way;
// only the initial Ship From selection differs. Warehouse rows carry only a name
// (Looker inventory has no id), so the drawer resolves it against its own
// warehouse list to reach the linked supplier + address.
interface EstimatorContext {
  source: 'warehouse' | 'supplier'
  warehouseName?: string | null
  supplier?: SupplierOption | null
}

interface Props {
  mode?: EstimatorMode
  // Drawer open/close state — flipping true triggers a form reset. Always true
  // for the always-mounted manual page.
  visible?: boolean
  // ── item-mode inputs (ignored in manual mode) ──
  weightLb?: number | null
  lengthIn?: number | null
  widthIn?: number | null
  heightIn?: number | null
  shippingCategory?: ShippingCategory
  // The item's shipping group, used to load its accessorials (Options).
  shippingGroupId?: number | null
  // The item's associated suppliers (from the Suppliers section) — populate the
  // Supplier dropdown so the user can switch the ship-from supplier.
  suppliers?: SupplierOption[]
  context?: EstimatorContext | null
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'item',
  visible: false,
  weightLb: null,
  lengthIn: null,
  widthIn: null,
  heightIn: null,
  shippingCategory: 'parcel',
  shippingGroupId: null,
  suppliers: () => [],
  context: null,
})

const isManual = computed(() => props.mode === 'manual')

const LTL_AUTO_THRESHOLD_LB = 50
const PARCEL_MAX_LB = 75
const PARCEL_DISABLED_MESSAGE = 'Shipments of 75lbs. or more must ship via LTL.'
const PARCEL_DISCOURAGED_MESSAGE = 'Shipments of 50lbs. or more should ship via LTL.'
const ACCESSORIAL_SKELETON_COUNT = 3
const manualWeight = ref<number | null>(null)
const itemWeight = ref<number | null>(null)
const manualCategory = ref<ShippingCategory>('parcel')
const itemCategoryOverride = ref<ShippingCategory | null>(null)
const isCategoryManual = ref(false)

const isCategoryUserChosen = ref(false)
const isParcelDisabled = computed(
  () => isManual.value && (manualWeight.value ?? 0) >= PARCEL_MAX_LB,
)

const isParcelDiscouraged = computed(
  () => isManual.value
    && (manualWeight.value ?? 0) >= LTL_AUTO_THRESHOLD_LB
    && !isParcelDisabled.value,
)
// The over-75 constraint is withheld from anyone who chose LTL themselves — the
// weight took no option away from them, so there is nothing to explain.
const showParcelDisabledNote = computed(
  () => isParcelDisabled.value && !isCategoryUserChosen.value,
)
const weightMethodNote = computed(() => {
  if (isParcelDiscouraged.value) { return PARCEL_DISCOURAGED_MESSAGE }
  if (showParcelDisabledNote.value) { return PARCEL_DISABLED_MESSAGE }
  return null
})
const categoryOptions = computed(() => [
  { label: 'Parcel', value: 'parcel' as ShippingCategory, icon: 'pi pi-box', disabled: isParcelDisabled.value },
  // Local asset rather than a Material Symbol — the design's LTL glyph (a crated
  // pallet) isn't in either icon set, so it ships alongside inbound.svg.
  { label: 'LTL', value: 'LTL' as ShippingCategory, iconSrc: ltlIconUrl, disabled: false },
])
// Ship From origin: one of Liberty's own warehouses, or a supplier.
const shipFromOptions = [
  { label: 'Warehouse', value: 'warehouse' as ShipFromSource, icon: 'ms:warehouse' },
  { label: 'Supplier', value: 'supplier' as ShipFromSource, icon: 'ms:corporate_fare' },
]
// Inbound is unavailable when the shipment already starts at the inbound
// warehouse — Liberty can't ship to itself (see isInboundDisabled).
const directionOptions = computed(() => [
  { label: 'Inbound', value: true, icon: 'ms:shelves', disabled: isInboundDisabled.value },
  { label: 'Outbound', value: false, icon: 'pi pi-user', disabled: false },
])
const manualSuppliers = ref<SupplierOption[]>([])
// Resolved at runtime from the shipping_groups collection (no hardcoded id) so
// the selected Parcel/LTL category picks which group's accessorials load.
const manualGroupIds = ref<{ parcel: number | null; ltl: number | null }>({
  parcel: null,
  ltl: null,
})

// Effective inputs — item props in item mode, the manual controls otherwise.
const effectiveWeight = computed(() => (isManual.value ? manualWeight.value : itemWeight.value))
const selectedWeight = computed<number | null>({
  get: () => effectiveWeight.value ?? null,
  set: (value) => {
    if (isManual.value) {
      manualWeight.value = value
    } else {
      itemWeight.value = value
    }
  },
})

/**
 * InputNumber only commits `v-model` on blur or Enter, so a typed weight didn't
 * reach `canSubmit` until the field lost focus — Get Estimate stayed disabled
 * while the number sat right there in the input. Take the live value off `@input`
 * instead, as the pricing inputs do (see SpecialSkuPricing).
 */
function handleWeightInput(event: InputNumberInputEvent) {
  const typed = event.value
  if (typed == null || typed === '') {
    selectedWeight.value = null
    return
  }
  // The event carries a string while the field is mid-edit ("12." , "1,2"), and
  // the " lbs" suffix rides along with it.
  const parsed = typeof typed === 'number' ? typed : Number(String(typed).replace(/[^0-9.-]/g, ''))
  selectedWeight.value = Number.isNaN(parsed) ? null : parsed
}
const effectiveCategory = computed<ShippingCategory>(() =>
  isManual.value ? manualCategory.value : (itemCategoryOverride.value ?? props.shippingCategory ?? 'parcel'),
)
const selectedCategory = computed<ShippingCategory>({
  get: () => effectiveCategory.value,
  set: (value) => {
    if (isManual.value) {
      manualCategory.value = value
    } else {
      itemCategoryOverride.value = value
    }
  },
})
// The parcel fallback box must never reach an LTL quote. A 16 × 12 × 12 in
// carton rates a pallet's worth of freight at an impossible density, and it
// masks the server's own loaded-pallet default — so for LTL, dimensions are
// either the item's real ones or nothing at all, and the server decides.
const measuredLength = computed(() => (isManual.value ? null : props.lengthIn))
const measuredWidth = computed(() => (isManual.value ? null : props.widthIn))
const measuredHeight = computed(() => (isManual.value ? null : props.heightIn))
const isLtl = computed(() => effectiveCategory.value === 'LTL')
const effectiveLength = computed(() =>
  isLtl.value ? measuredLength.value : (measuredLength.value ?? DEFAULT_PACKAGE_IN.length))
const effectiveWidth = computed(() =>
  isLtl.value ? measuredWidth.value : (measuredWidth.value ?? DEFAULT_PACKAGE_IN.width))
const effectiveHeight = computed(() =>
  isLtl.value ? measuredHeight.value : (measuredHeight.value ?? DEFAULT_PACKAGE_IN.height))
const effectiveSuppliers = computed(() => (isManual.value ? manualSuppliers.value : props.suppliers))
const accessorialGroupId = computed<number | null>(() =>
  isManual.value
    ? (effectiveCategory.value === 'LTL' ? manualGroupIds.value.ltl : manualGroupIds.value.parcel)
    : itemCategoryOverride.value
      ? (effectiveCategory.value === 'LTL' ? manualGroupIds.value.ltl : manualGroupIds.value.parcel)
      : props.shippingGroupId,
)

const COUNTRY_OPTIONS = [
  { label: 'United States (US)', code: 'US' },
  { label: 'Canada', code: 'CA' },
  { label: 'Mexico', code: 'MX' },
]

// HARDCODED fallback package — mirrors the Shopify "Store default" box
// (16 × 12 × 12 in) so the carrier rates on dimensional weight when the item
// itself has no dimensions in Directus. Remove once items carry real L/W/H.
const DEFAULT_PACKAGE_IN = { length: 16, width: 12, height: 12 }

// Destination + package options. Origin is modelled separately (Ship From).
const shipping = reactive({
  accessorials: [] as number[],
  country: COUNTRY_OPTIONS[0]!.label,
  postalCode: '',
  enterFullAddress: false,
  stateCode: '',
  city: '',
  street: '',
  unitSuite: '',
  latitude: null as number | null,
  longitude: null as number | null,
})

// ── Ship From state ────────────────────────────────────────────────────────
interface SupplierAddressOption {
  junctionId: number
  label: string
  postalCode: string
  countryCode: string
  stateCode: string | null
  city: string | null
  streetLine1: string | null
  streetLine2: string | null
  isDefault: boolean
}

const shipFromSource = ref<ShipFromSource>('supplier')
const shipFromWarehouseId = ref<number | null>(null)
const supplierId = ref<number | string | null>(null)
const supplierAddressJunctionId = ref<number | string | null>(null)
// The manual ship-from is a US postal code. State/city for the origin are
// resolved from the postal lookup (see resolveOriginLocation) whenever the origin
// itself doesn't carry a state — UPS requires a ShipFrom state and neither a
// typed postal nor a region-less supplier address provides one.
const SHIP_FROM_COUNTRY = 'US'
const shipFromPostalCode = ref('')
const originStateCode = ref('')
const originCity = ref('')
const lastOriginLookupKey = ref('')
const supplierAddresses = ref<SupplierAddressOption[]>([])
const isSupplierAddressesLoading = ref(false)
const inbound = ref(false)

const warehouses = ref<Warehouse[]>([])

const { fetchWarehouses } = useWarehouses()
const { fetchBusinessPartner, fetchBusinessPartners } = useBusinessPartners()
const { fetchProductSupplierGroupId } = useBusinessPartnerGroups()
const shippingGroupCrud = useDirectusCrud('shipping_groups')

// The warehouse the trigger came from, resolved from the loaded list by name.
const contextWarehouse = computed(() => {
  if (props.context?.source !== 'warehouse' || !props.context.warehouseName) {
    return null
  }
  // The trigger row carries the SAP warehouse code (Looker's `whs_code`, e.g.
  // 'MSP01'), which needn't equal the warehouse's display name — MSP01's record
  // is named "Liberty Supply". Resolve on name, code, or SAP id so the warehouse
  // always matches its own address/supplier — mirrors the inbound MSP01 lookup.
  const identifier = props.context.warehouseName.trim().toLowerCase()
  return warehouses.value.find(warehouse =>
    [warehouse.name, warehouse.code, warehouse.sapId].some(
      value => (value ?? '').trim().toLowerCase() === identifier,
    ),
  ) ?? null
})

// Supplier dropdown = the item's suppliers ∪ the trigger's supplier. The field is
// optional and clearable, so an empty selection is how the user says "no supplier
// on record" — it brings the Ship-From postal code back in the Address slot.
const supplierOptions = computed(() => {
  const byId = new Map<string, SupplierOption>()
  for (const supplier of effectiveSuppliers.value) {
    byId.set(String(supplier.id), supplier)
  }
  const warehouseSupplier = contextWarehouse.value?.supplier
  const contextSupplier = props.context?.source === 'warehouse'
    ? warehouseSupplier
      ? {
          id: warehouseSupplier.id,
          name: warehouseSupplier.name ?? 'Supplier',
          accountNumber: warehouseSupplier.accountNumber,
        }
      : null
    : props.context?.supplier ?? null
  if (contextSupplier && !byId.has(String(contextSupplier.id))) {
    byId.set(String(contextSupplier.id), contextSupplier)
  }
  return Array.from(byId.values()).map(
    supplier => ({ label: supplier.name, value: supplier.id }),
  )
})
const isSupplierReal = computed(() => supplierId.value !== null)
const supplierHasAddresses = computed(() => supplierAddresses.value.length > 0)

// Nothing to pick until a supplier is chosen, and nothing to pick either when
// that supplier has no shipping addresses on file ("None on record").
const supplierAddressDisabled = computed(
  () => !isSupplierReal.value || !supplierHasAddresses.value,
)
const supplierAddressPlaceholder = computed(() => {
  if (isSupplierReal.value && !supplierHasAddresses.value) {
    return isSupplierAddressesLoading.value ? 'Loading…' : 'None on record'
  }
  return 'Select supplier address'
})

// The address is required except when the supplier has none on record — there is
// nothing to select, and the manual Ship-From postal takes over.
const isSupplierAddressRequired = computed(
  () => !(isSupplierReal.value && !supplierHasAddresses.value),
)

const showSupplierAddress = computed(() => isSupplierReal.value)
const hasSupplierAddressToPick = computed(
  () => isSupplierReal.value && supplierHasAddresses.value,
)

const supplierAddressOptions = computed(() =>
  supplierAddresses.value.map(
    address => ({ label: address.label, value: address.junctionId }),
  ),
)

const selectedSupplierAddress = computed(
  () => supplierAddresses.value.find(address => address.junctionId === supplierAddressJunctionId.value) ?? null,
)

// Ship From = Warehouse: THE WAREHOUSE is the origin — its own address, not its
// linked supplier's. The warehouse is picked from the same list the app uses
// everywhere (Liberty Supply MSP01, Neuco, …); its address follows from that
// choice and is shown read-only for confirmation.
const isWarehouseOrigin = computed(() => shipFromSource.value === 'warehouse')

const warehouseOptions = computed(() =>
  warehouses.value.map(warehouse => ({
    label: getWarehouseLabel(warehouse),
    value: warehouse.id,
  })),
)

const warehouseOrigin = computed(
  () =>
    (isWarehouseOrigin.value
      ? warehouses.value.find(warehouse => warehouse.id === shipFromWarehouseId.value)
      : null) ?? null,
)

// Read-only Address field beside the Warehouse dropdown, e.g.
// "13821 Industrial Park Blvd, Minneapolis, MN 55340".
const warehouseOriginAddressLabel = computed(() => {
  const address = warehouseOrigin.value?.address
  if (!address) { return '' }
  return buildAddressLabel({
    streetLine1: [address.streetLine1, address.streetLine2].filter(Boolean).join(', ') || null,
    city: address.city,
    stateCode: address.regionCode,
    postalCode: address.postalCode,
  })
})

const showShipFromPostal = computed(
  () => !isWarehouseOrigin.value && !hasSupplierAddressToPick.value,
)

// Reassurance banner: a real supplier address is selected — confirm it's right.
const showConfirmSupplierAddress = computed(
  () =>
    !isWarehouseOrigin.value
    && isSupplierReal.value
    && supplierHasAddresses.value
    && Boolean(selectedSupplierAddress.value),
)
const isShipFromPostalRequired = computed(() => !showConfirmSupplierAddress.value)

// Inbound ships into Liberty's MSP01 warehouse regardless of trigger row.
const inboundWarehouse = computed(
  () =>
    warehouses.value.find(
      warehouse =>
        (warehouse.code ?? '').toUpperCase() === 'MSP01'
        || (warehouse.sapId ?? '').toUpperCase() === 'MSP01',
    ) ?? null,
)

// Single fixed option so the disabled inbound "Warehouse" dropdown displays the
// warehouse label — the destination is fixed, unlike the Ship From picker.
const inboundWarehouseLabel = computed(() => getWarehouseLabel(inboundWarehouse.value))
const inboundWarehouseOptions = computed(() =>
  inboundWarehouseLabel.value
    ? [{ label: inboundWarehouseLabel.value, value: inboundWarehouseLabel.value }]
    : [],
)

// Inbound lands at MSP01, so shipping FROM MSP01 would be Liberty shipping to
// itself — the direction is disabled while that warehouse is the origin.
const isInboundDisabled = computed(
  () =>
    isWarehouseOrigin.value
    && warehouseOrigin.value != null
    && warehouseOrigin.value.id === inboundWarehouse.value?.id,
)

// Ship From = Warehouse defaults to MSP01, the warehouse most estimates start
// from (any other warehouse — e.g. Neuco — is picked explicitly).
const defaultShipFromWarehouseId = computed(
  () => inboundWarehouse.value?.id ?? warehouses.value[0]?.id ?? null,
)

function toJunctionId(value: unknown): number | null {
  if (value == null) { return null }
  if (typeof value === 'object') {
    const nested = (value as { id?: number }).id
    return typeof nested === 'number' ? nested : null
  }
  return typeof value === 'number' ? value : Number(value) || null
}

// One-line address as the design writes it: comma-separated parts, with the
// state and postal code together on the tail — "515 Crossroads Pkwy,
// Bollingbrook, IL 60440". Shared by the supplier address dropdown and the
// warehouse origin's read-only Address field.
function buildAddressLabel(address: {
  streetLine1: string | null
  city: string | null
  stateCode: string | null
  postalCode: string | null
}): string {
  const region = [address.stateCode, address.postalCode].filter(Boolean).join(' ')
  return [address.streetLine1, address.city, region].filter(Boolean).join(', ')
}

async function loadSupplierAddresses(partnerId: number | string) {
  isSupplierAddressesLoading.value = true
  supplierAddresses.value = []
  const { data: partner, error } = await fetchBusinessPartner(partnerId)
  isSupplierAddressesLoading.value = false

  if (error || !partner) {
    return
  }

  const defaultJunctionId = toJunctionId(partner.default_shipping_business_partners_addresses_id)
  const junctions = (partner.addresses ?? []).filter(
    (junction: any) => junction?.is_shipping_address && typeof junction?.addresses_id === 'object',
  )

  supplierAddresses.value = junctions.map((junction: any): SupplierAddressOption => {
    const address = junction.addresses_id
    const region = typeof address.regions_id === 'object' ? address.regions_id : null
    const country = typeof address.countries_id === 'object' ? address.countries_id : null
    const streetLine1 = address.street_line_1 ?? null
    const postalCode = address.postal_code ?? ''
    const stateCode = region?.code ?? null
    const city = address.city ?? null
    return {
      junctionId: junction.id,
      label: buildAddressLabel({ streetLine1, city, stateCode, postalCode }),
      postalCode,
      countryCode: country?.code ?? 'US',
      stateCode,
      city,
      streetLine1,
      streetLine2: address.street_line_2 ?? null,
      isDefault: defaultJunctionId != null && junction.id === defaultJunctionId,
    }
  })

  // Default to the partner's default shipping address (else the first).
  const preselected = supplierAddresses.value.find(address => address.isDefault)
    ?? supplierAddresses.value[0]
  supplierAddressJunctionId.value = preselected ? preselected.junctionId : null
}

// Switching to Warehouse (or having the warehouse list arrive afterwards) seeds
// the dropdown with the default warehouse, so the origin is never left blank.
watch([shipFromSource, warehouses], () => {
  if (shipFromSource.value === 'warehouse' && shipFromWarehouseId.value == null) {
    shipFromWarehouseId.value = defaultShipFromWarehouseId.value
  }
})

// Changing the supplier reloads its shipping addresses (or clears them when the
// field is cleared, where the manual Ship-From postal takes over).
watch(supplierId, (value) => {
  supplierAddresses.value = []
  supplierAddressJunctionId.value = null
  if (value !== null) {
    loadSupplierAddresses(value)
  }
})

// ── Accessorials (shipping options) ─────────────────────────────────────────
const accessorialOptions = ref<ShippingAccessorialOption[]>([])
const isAccessorialsLoading = ref(false)

const selectedAccessorialCodes = computed(() =>
  accessorialOptions.value
    .filter(accessorial => shipping.accessorials.includes(accessorial.id))
    .map(accessorial => accessorial.code),
)

// Limited-access and residential delivery describe the same stop two ways, and
// Priority1's carriers reject the pair — ABF calls it incompatible and one
// combination 500s the whole quote. Disabling the other box states that up front
// rather than letting the user select it and lose the estimate. The server
// re-checks: this is a courtesy, not the guard.
const EXCLUSIVE_DELIVERY_CODES = ['limited_access_delivery', 'residential_delivery']

const accessorialsRenderKey = computed(() => {
  if (isAccessorialsLoading.value && !accessorialOptions.value.length) { return 'loading' }
  return accessorialOptions.value.map(accessorial => accessorial.id).join('-') || 'empty'
})

function isAccessorialBlocked(accessorial: ShippingAccessorialOption): boolean {
  const other = EXCLUSIVE_DELIVERY_CODES.find(code => code !== accessorial.code)
  if (!other || !EXCLUSIVE_DELIVERY_CODES.includes(accessorial.code)) { return false }
  return selectedAccessorialCodes.value.includes(other)
}

const countries = COUNTRY_OPTIONS.map(option => option.label)

// ── Estimates table ─────────────────────────────────────────────────────────
const estimates = ref<ShippingEstimate[]>([])
const warnings = ref<string[]>([])
const isLoading = ref(false)
const hasAttemptedEstimates = ref(false)
const isAddressUnserviceable = ref(false)
const estimatesTableRef = ref(null)
// Saved column widths for this table (see useColumnResize).
const { tableProps: columnResizeProps, menuProps: columnMenuProps, hasStoredWidths: hasStoredColumnWidths } = useColumnResize({
  tableKey: 'form.shipping-estimates',
  tableRef: estimatesTableRef,
})

const MIN_SKELETON_ROWS = 7
const skeletonRowCount = ref(MIN_SKELETON_ROWS)
// Scroll height applied while loading so the measured rows fill the space exactly
// (no inner scroll, no gap). Null until the first measurement lands.
const loadingScrollHeight = ref<string | null>(null)
// Scroll height for the LOADED table — the same footer-anchored region the
// skeleton fills. It keeps the loaded estimates in an internal scroll (sticky
// header, body scrolls) that fills to the footer, so the drawer itself never
// scrolls to reveal rows; a scrollbar shows only when the estimates overflow it.
const loadedScrollHeight = ref<string | null>(null)

const estimateSkeletonRows = computed<Array<Record<string, any>>>(() =>
  Array.from({ length: skeletonRowCount.value }, (_, index) => ({
    _skeleton: true,
    carrier: `skeleton-${index}`,
  })),
)

// Bottom bound for the table fill = the scrolling drawer-content's inner bottom
// edge (its rect bottom minus padding-bottom). Anchoring to the content box — not
// the `.estimator-footer` top, which sits inside the separate `.p-drawer-footer`
// below its padding — keeps the filled table INSIDE the content box, so it never
// pushes `.p-drawer-content` into overflow and scrolls the drawer. Floored for a
// sub-pixel safety margin.
function getFillBottomBound(tableEl: HTMLElement): number | null {
  const contentEl = tableEl.closest('.p-drawer-content') as HTMLElement | null
  if (!contentEl) { return null }
  const paddingBottom = parseFloat(getComputedStyle(contentEl).paddingBottom) || 0
  return Math.floor(contentEl.getBoundingClientRect().bottom - paddingBottom)
}

// Fill the leftover vertical space with skeleton rows. Rows area = bottom bound −
// table-header bottom; scroll height = bottom bound − table top (header + rows).
// Row height is live-measured.
function measureSkeletonFill() {
  const tableEl = (estimatesTableRef.value as any)?.$el as HTMLElement | undefined
  if (!tableEl) { return }
  const bottomBound = getFillBottomBound(tableEl)
  if (bottomBound == null) { return }
  const headEl = tableEl.querySelector('.p-datatable-thead') as HTMLElement | null
  const rowEl = tableEl.querySelector('.p-datatable-tbody > tr') as HTMLElement | null
  if (!headEl) { return }

  const headBottom = headEl.getBoundingClientRect().bottom
  const tableTop = tableEl.getBoundingClientRect().top
  const rowHeight = rowEl?.offsetHeight || 52
  const rowsArea = bottomBound - headBottom
  if (rowsArea <= 0 || rowHeight <= 0) { return }

  // Ceil so the rows fully cover the space (no sub-row gap). The scroll area is
  // capped to the whole table footprint (header + rows) so it fills exactly.
  skeletonRowCount.value = Math.max(MIN_SKELETON_ROWS, Math.ceil(rowsArea / rowHeight))
  loadingScrollHeight.value = `${bottomBound - tableTop}px`
}

// Size the loaded table's scroll viewport to the same content-anchored region the
// skeleton fills (bottom bound − table top). The sticky header + body then scroll
// inside it once the estimates overflow, instead of growing the drawer.
function measureLoadedFill() {
  const tableEl = (estimatesTableRef.value as any)?.$el as HTMLElement | undefined
  if (!tableEl) { return }
  const bottomBound = getFillBottomBound(tableEl)
  if (bottomBound == null) { return }
  const fillHeight = bottomBound - tableEl.getBoundingClientRect().top
  if (fillHeight <= 0) { return }
  loadedScrollHeight.value = `${fillHeight}px`
}

const hasLoadedEstimates = computed(
  () => !isLoading.value && estimates.value.length > 0,
)

const isEmptyState = computed(
  () => !isLoading.value && estimates.value.length === 0,
)

const tableStateKey = computed(() => {
  if (hasLoadedEstimates.value) return 'loaded'
  if (isEmptyState.value) return 'empty'
  return 'loading'
})

const isMissingShippingWeight = computed(() => !effectiveWeight.value)

const emptyEstimatesMessage = computed(() => {
  if (isMissingShippingWeight.value) {
    return 'No estimate results'
  }
  if (hasAttemptedEstimates.value || isAddressUnserviceable.value) {
    return 'No shipping rates provided'
  }
  return 'No estimate results'
})

const { scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(estimatesTableRef, () => estimates.value.length)

// While loading, fill the panel: the measured height with as many skeleton rows
// as fit. Otherwise fall back to the N-row viewport from useTableRowsPerPage.
const tableScrollHeight = computed(() => {
  if (hasLoadedEstimates.value) { return loadedScrollHeight.value ?? undefined }
  if (isLoading.value && loadingScrollHeight.value) { return loadingScrollHeight.value }
  return scrollHeight.value
})
// Loading renders every skeleton row (no virtual windowing) so they truly fill.
const tableVirtualScroller = computed(() =>
  (hasLoadedEstimates.value || isLoading.value) ? undefined : virtualScrollerOptions.value,
)

// Re-measure the skeleton fill when a load begins (after the table paints) and on
// viewport resize while loading.
function handleSkeletonResize() {
  if (isLoading.value) { measureSkeletonFill() }
  else if (hasLoadedEstimates.value) { measureLoadedFill() }
}
watch(isLoading, (loading) => {
  if (loading) {
    // The table is re-keyed on entering the loading state, so it remounts. Give
    // PrimeVue time to lay out the scrollable table before measuring: two frames,
    // plus a short timeout as a belt-and-braces fallback if layout lands later.
    requestAnimationFrame(() => requestAnimationFrame(measureSkeletonFill))
    setTimeout(measureSkeletonFill, 150)
  }
})
// The table re-keys (remounts) when estimates land, mirroring the loading state.
// Measure the loaded fill on the same two-frames-plus-fallback cadence.
watch(hasLoadedEstimates, (loaded) => {
  if (loaded) {
    requestAnimationFrame(() => requestAnimationFrame(measureLoadedFill))
    setTimeout(measureLoadedFill, 150)
  }
})

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(
  estimatesTableRef,
  computed(() => estimates.value.length),
)

const { showFooterShadow } = useTableFooterShadow(
  estimatesTableRef,
  computed(() => estimates.value.length),
)

const postalLookupError = ref<string | null>(null)
const postalResolvedNote = ref<string | null>(null)
const lastLookedUpKey = ref<string>('')

const { fetchEstimates, lookupPostalCode } = useShippingEstimates()
const { fetchForShippingGroup } = useShippingAccessorials()
const referenceData = useReferenceDataStore()
const locationStore = useLocationStore()
const {
  geocodeAddress,
  geocodeAddressDebounced,
  reverseGeocodeAddress,
  searchAddresses,
  isGeocoderUnavailable,
} = useGeocoder()
const toast = useToast()

const AUTOFILL_OFF = {
  autocomplete: 'new-password',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const
const AUTOFILL_OFF_PT = { pcInputText: { root: { ...AUTOFILL_OFF } } } as const

const submitted = ref(false)

const addressSuggestions = ref<any[]>([])
const isSearching = ref(false)
const autocompleteWrapperRef = ref<HTMLElement | null>(null)
const autocompleteOverlayStyle = computed(() => {
  const width = autocompleteWrapperRef.value?.offsetWidth
  return width ? { maxWidth: `${width}px` } : {}
})
const showMap = ref(false)
// Pick-on-map is item-mode only. The standalone /tools estimator just needs an
// address to rate against, so it gets neither the pin toggle nor the auto-reveal
// that follows picking an autocomplete suggestion — and never loads the Mapbox
// chunk. Guarded at both setters below so `showMap` can't turn on in manual mode.
const isMapEnabled = computed(() => !isManual.value)
const mapRef = ref<any>(null)
const mapInstanceKey = ref(0)
const isMapChunkFailed = ref(false)
let mapChunkTimeout: ReturnType<typeof setTimeout> | null = null
let isApplyingResolved = false
const MAP_CHUNK_TIMEOUT_MS = 8000

const regionOptions = computed(() => {
  const refCountry = referenceData.countryOptions.find(
    option => option.code === getSelectedCountryCode(),
  )
  if (!refCountry) return []
  return referenceData.getRegionsByCountry(refCountry.id).map(region => ({
    code: region.code,
    name: region.name,
    displayLabel: region.code ? `${region.name} (${region.code})` : region.name,
  }))
})

const isRegionsLoading = computed(
  () => referenceData.loading && regionOptions.value.length === 0,
)

async function loadWarehouses() {
  const { data, error } = await fetchWarehouses()
  if (error) {
    console.error('Failed to load warehouses:', error.message)
    return
  }
  warehouses.value = data ?? []
}

async function loadAccessorials(groupId: number) {
  isAccessorialsLoading.value = true
  const { data, error } = await fetchForShippingGroup(groupId)
  isAccessorialsLoading.value = false

  if (error) {
    console.error('Failed to load shipping accessorials:', error.message)
    accessorialOptions.value = []
    return
  }

  accessorialOptions.value = data ?? []
  const availableIds = new Set(accessorialOptions.value.map(accessorial => accessorial.id))
  shipping.accessorials = shipping.accessorials.filter(id => availableIds.has(id))
}

onMounted(() => {
  referenceData.hydrate()
  window.addEventListener('resize', handleSkeletonResize)
  loadShippingGroups()

  // The manual page mounts once and never re-opens, so seed its form here.
  if (isManual.value) {
    resetForm()
    supplierId.value = null
    loadManualSuppliers()
    loadWarehouses()
    return
  }
  if (props.visible) {
    applyOpenState()
    return
  }

  loadWarehouses()
})

onUnmounted(() => {
  clearMapChunkTimeout()
  window.removeEventListener('resize', handleSkeletonResize)
})

watch(
  accessorialGroupId,
  (groupId) => {
    shipping.accessorials = []
    if (typeof groupId === 'number') {
      loadAccessorials(groupId)
    } else {
      accessorialOptions.value = []
    }
  },
  { immediate: true },
)

// Manual mode: drive Parcel/LTL from the weight until the user overrides it, and
// reset that override when the weight is cleared.
watch(manualWeight, (value) => {
  if (!isManual.value) { return }
  if (value == null) {
    isCategoryManual.value = false
    isCategoryUserChosen.value = false
    manualCategory.value = 'parcel'
    return
  }
  if (value >= PARCEL_MAX_LB) {
    isCategoryManual.value = false
    manualCategory.value = 'LTL'
    return
  }
  if (isCategoryManual.value) { return }
  manualCategory.value = value >= LTL_AUTO_THRESHOLD_LB ? 'LTL' : 'parcel'
})

// @change fires only on real user interaction (not the weight-driven watch
// above), so a change here is always a deliberate override. The new value comes
// off the event rather than `manualCategory`, which the v-model may not have
// written yet.
function handleCategoryChange(event: { value?: ShippingCategory }) {
  if (!isManual.value) { return }
  isCategoryManual.value = true
  isCategoryUserChosen.value = (event?.value ?? manualCategory.value) === 'LTL'
}

// Selecting MSP01 as the origin while Inbound is active would rate a shipment to
// itself — fall back to Outbound, the only direction left.
watch(isInboundDisabled, (isDisabled) => {
  if (isDisabled && inbound.value) {
    inbound.value = false
  }
})

// ── Reset + apply trigger context on open ───────────────────────────────────
function resetForm() {
  shipFromSource.value = 'supplier'
  shipFromWarehouseId.value = null
  supplierAddresses.value = []
  supplierAddressJunctionId.value = null
  shipFromPostalCode.value = ''
  originStateCode.value = ''
  originCity.value = ''
  lastOriginLookupKey.value = ''
  inbound.value = false
  itemWeight.value = props.weightLb ?? null
  itemCategoryOverride.value = null
  shipping.accessorials = shipping.accessorials.slice() // keep any group-derived state
  shipping.country = COUNTRY_OPTIONS[0]!.label
  shipping.postalCode = ''
  shipping.enterFullAddress = false
  shipping.stateCode = ''
  shipping.city = ''
  shipping.street = ''
  shipping.unitSuite = ''
  shipping.latitude = null
  shipping.longitude = null
  estimates.value = []
  warnings.value = []
  submitted.value = false
  hasAttemptedEstimates.value = false
  isAddressUnserviceable.value = false
  postalLookupError.value = null
  postalResolvedNote.value = null
  lastLookedUpKey.value = ''
  showMap.value = false
}

function applyContext() {
  const context = props.context
  // No supplier means an empty Supplier field, so toggling Ship From over to
  // Supplier lands on "Select supplier" with the postal code standing in — never
  // on a pre-filled value the user didn't choose.
  if (!context) {
    supplierId.value = null
    return
  }
  if (context.source === 'supplier' && context.supplier) {
    shipFromSource.value = 'supplier'
    supplierId.value = context.supplier.id
    return
  }
  if (context.source === 'warehouse') {
    // The warehouse itself is the origin, linked supplier or not — its address
    // follows from the dropdown (see warehouseOrigin / buildOrigin).
    const warehouse = contextWarehouse.value
    supplierId.value = null
    if (warehouse?.address?.postalCode) {
      shipFromSource.value = 'warehouse'
      shipFromWarehouseId.value = warehouse.id
      return
    }
    // Warehouse has no usable address (or didn't resolve by name) — fall back to
    // its linked supplier, else to the manual postal picker.
    if (warehouse?.supplier) {
      supplierId.value = warehouse.supplier.id
    } else {
      shipFromPostalCode.value = warehouse?.address?.postalCode ?? ''
    }
    return
  }
  supplierId.value = null
}

async function applyOpenState() {
  resetForm()
  if (!warehouses.value.length) {
    await loadWarehouses()
  }
  applyContext()
}

watch(() => props.visible, (isOpen) => {
  if (!isOpen) {
    supplierId.value = null
    return
  }
  applyOpenState()
})

// ── Submit gating ────────────────────────────────────────────────────────────
const hasOrigin = computed(() => {
  if (isWarehouseOrigin.value) {
    return Boolean(warehouseOrigin.value?.address?.postalCode)
  }
  if (showConfirmSupplierAddress.value) {
    return Boolean(selectedSupplierAddress.value?.postalCode)
  }
  return Boolean(shipFromPostalCode.value.trim())
})

const hasDestination = computed(() => {
  if (inbound.value) {
    return Boolean(inboundWarehouse.value?.address?.postalCode)
  }
  return Boolean(shipping.postalCode.trim())
})

const canSubmit = computed(
  () => hasOrigin.value && hasDestination.value && !isMissingShippingWeight.value && !isLoading.value,
)

const fullAddressErrors = computed(() => ({
  street: submitted.value && !inbound.value && shipping.enterFullAddress && !shipping.street.trim(),
  city: submitted.value && !inbound.value && shipping.enterFullAddress && !shipping.city.trim(),
  state: submitted.value && !inbound.value && shipping.enterFullAddress && !shipping.stateCode,
}))

const submitDisabledHint = computed(() => {
  if (isMissingShippingWeight.value) {
    return 'Shipping weight is missing — required to estimate shipping.'
  }
  if (!hasOrigin.value) {
    return isWarehouseOrigin.value
      ? 'Select a ship-from warehouse with an address on record.'
      : 'Enter a ship-from supplier address or postal code.'
  }
  if (!hasDestination.value) {
    return 'Enter a destination postal code.'
  }
  return ''
})

function getSelectedCountryCode() {
  return COUNTRY_OPTIONS.find(option => option.label === shipping.country)?.code ?? 'US'
}

async function validateCurrentPostalCode(): Promise<boolean> {
  const code = shipping.postalCode.trim()
  if (!code) return false

  const countryCode = getSelectedCountryCode()
  const lookupKey = `${countryCode}:${code}`
  if (lookupKey === lastLookedUpKey.value) return true

  postalLookupError.value = null
  isAddressUnserviceable.value = false
  postalResolvedNote.value = null
  const { data: lookupResult, error: lookupError } = await lookupPostalCode(code, countryCode)

  if (lookupError) {
    const fetchError = lookupError as Error & { statusMessage?: string }
    postalLookupError.value = fetchError.statusMessage || fetchError.message || 'Postal code not recognized'
    lastLookedUpKey.value = ''
    return false
  }

  if (!lookupResult.serviceAvailable) {
    postalLookupError.value = 'Postal code is not serviceable by FedEx.'
    isAddressUnserviceable.value = true
    lastLookedUpKey.value = ''
    return false
  }

  lastLookedUpKey.value = lookupKey

  const resolvedPostal = lookupResult.postalCode?.trim() ?? ''
  if (resolvedPostal && resolvedPostal.toUpperCase() !== code.toUpperCase()) {
    const locationParts = [lookupResult.city, lookupResult.stateCode].filter(Boolean)
    const locationLabel = locationParts.length ? ` (${locationParts.join(', ')})` : ''
    postalResolvedNote.value = `Postal code ${code} resolved to ${resolvedPostal}${locationLabel} — verify the destination.`
  }

  if (!shipping.enterFullAddress) {
    if (lookupResult.stateCode && !shipping.stateCode.trim()) {
      shipping.stateCode = lookupResult.stateCode
    }
    if (lookupResult.city && !shipping.city.trim()) {
      shipping.city = lookupResult.city
    }
  }
  return true
}

function handlePostalCodeBlur() {
  validateCurrentPostalCode()
}
async function resolveOriginLocation(postalCode: string, countryCode: string): Promise<void> {
  const postal = postalCode.trim()
  const country = countryCode.trim() || SHIP_FROM_COUNTRY

  function clearResolved() {
    originStateCode.value = ''
    originCity.value = ''
    lastOriginLookupKey.value = ''
  }

  if (!postal) {
    clearResolved()
    return
  }

  const lookupKey = `${country}:${postal}`
  if (lookupKey === lastOriginLookupKey.value) { return }

  const { data: lookupResult, error: lookupError } = await lookupPostalCode(postal, country)
  // A failed/inconclusive lookup isn't fatal — FedEx still rates postal-only and
  // UPS surfaces its own error. Leave the state blank rather than block the quote.
  if (lookupError || !lookupResult?.serviceAvailable) {
    clearResolved()
    return
  }

  lastOriginLookupKey.value = lookupKey
  originStateCode.value = lookupResult.stateCode ?? ''
  originCity.value = lookupResult.city ?? ''
}
function currentOriginAddress(): { postalCode: string, countryCode: string, stateCode: string | null } | null {
  const warehouseAddress = warehouseOrigin.value?.address
  if (warehouseAddress?.postalCode) {
    return {
      postalCode: warehouseAddress.postalCode,
      countryCode: warehouseAddress.countryCode || SHIP_FROM_COUNTRY,
      stateCode: warehouseAddress.regionCode,
    }
  }
  if (showConfirmSupplierAddress.value && selectedSupplierAddress.value) {
    const address = selectedSupplierAddress.value
    return {
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      stateCode: address.stateCode,
    }
  }
  const postal = shipFromPostalCode.value.trim()
  if (!postal) { return null }
  return { postalCode: postal, countryCode: SHIP_FROM_COUNTRY, stateCode: null }
}

async function ensureOriginState(): Promise<void> {
  const origin = currentOriginAddress()
  if (!origin || origin.stateCode) { return }
  await resolveOriginLocation(origin.postalCode, origin.countryCode)
}

function handleShipFromPostalBlur() {
  ensureOriginState()
}
watch([supplierId, supplierAddressJunctionId, shipFromPostalCode], () => {
  originStateCode.value = ''
  originCity.value = ''
  lastOriginLookupKey.value = ''
})

function resetPostalValidation() {
  lastLookedUpKey.value = ''
  postalLookupError.value = null
  postalResolvedNote.value = null
  isAddressUnserviceable.value = false
  hasAttemptedEstimates.value = false
}

watch(() => shipping.country, () => {
  if (isApplyingResolved) {
    return
  }
  resetPostalValidation()
  shipping.postalCode = ''
  shipping.stateCode = ''
  shipping.street = ''
  shipping.unitSuite = ''
  shipping.city = ''
  shipping.latitude = null
  shipping.longitude = null
  addressSuggestions.value = []
  submitted.value = false
  if (showMap.value) {
    nextTick(recenterMapToCountry)
  }
})

watch(() => shipping.postalCode, () => {
  resetPostalValidation()
  if (!shipping.enterFullAddress) {
    shipping.stateCode = ''
    shipping.city = ''
  }
})

function clearMapChunkTimeout() {
  if (mapChunkTimeout) {
    clearTimeout(mapChunkTimeout)
    mapChunkTimeout = null
  }
}

function armMapChunkTimeout() {
  clearMapChunkTimeout()
  isMapChunkFailed.value = false
  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    isMapChunkFailed.value = true
    return
  }
  mapChunkTimeout = setTimeout(() => {
    if (!mapRef.value) {
      isMapChunkFailed.value = true
    }
  }, MAP_CHUNK_TIMEOUT_MS)
}

function retryMapChunk() {
  mapInstanceKey.value += 1
  armMapChunkTimeout()
}

function applyResolvedCountry(countryName: string) {
  const refCountry = referenceData.countryOptions.find(
    option => option.name.toLowerCase() === countryName.toLowerCase(),
  )
  if (!refCountry) return
  const option = COUNTRY_OPTIONS.find(entry => entry.code === refCountry.code)
  if (option) {
    shipping.country = option.label
  }
}

function applyResolvedState(stateName: string) {
  const region = regionOptions.value.find(
    entry => entry.name?.toLowerCase() === stateName.toLowerCase(),
  )
  shipping.stateCode = region?.code ?? ''
}

function applyResolvedAddress(resolved: {
  street?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  latitude?: number
  longitude?: number
}) {
  isApplyingResolved = true
  shipping.street = resolved.street ?? ''
  shipping.city = resolved.city ?? ''
  if (resolved.postalCode) {
    shipping.postalCode = resolved.postalCode
  }
  if (resolved.country) {
    applyResolvedCountry(resolved.country)
  }
  if (resolved.state) {
    applyResolvedState(resolved.state)
  }
  if (resolved.latitude != null && resolved.longitude != null) {
    shipping.latitude = resolved.latitude
    shipping.longitude = resolved.longitude
  }
  nextTick(() => {
    isApplyingResolved = false
  })
}

async function onAddressSearch(event: { query: string }) {
  const query = event.query
  if (!query || query.length < 3) {
    addressSuggestions.value = []
    return
  }
  isSearching.value = true
  addressSuggestions.value = await searchAddresses(query, {
    country: getSelectedCountryCode(),
    proximity: locationStore.coordinates,
  })
  isSearching.value = false
}

function onAddressSelect(event: { value: any }) {
  const selected = event.value
  if (!selected || typeof selected === 'string') {
    return
  }
  applyResolvedAddress(selected)
  revealMap()
  mapRef.value?.flyTo(selected.latitude, selected.longitude)
}

async function handleMarkerDragEnd({ latitude, longitude }: { latitude: number; longitude: number }) {
  const addressParts = await reverseGeocodeAddress(latitude, longitude)
  if (!addressParts) {
    return
  }
  mapRef.value?.placeMarker?.(latitude, longitude)
  applyResolvedAddress({ ...addressParts, latitude, longitude })
}

watch(
  () => [
    shipping.street,
    shipping.city,
    shipping.stateCode,
    shipping.postalCode,
    shipping.country,
  ],
  async () => {
    if (!shipping.enterFullAddress || isApplyingResolved) {
      return
    }
    if (!shipping.street.trim() || !shipping.city.trim()) {
      return
    }
    const region = regionOptions.value.find(entry => entry.code === shipping.stateCode)
    const coordinates = await geocodeAddressDebounced({
      street: shipping.street,
      city: shipping.city,
      state: region?.name || '',
      postalCode: shipping.postalCode,
      country: getSelectedCountryCode(),
    })
    if (coordinates) {
      shipping.latitude = coordinates.latitude
      shipping.longitude = coordinates.longitude
      mapRef.value?.flyTo(coordinates.latitude, coordinates.longitude)
    }
  },
)

watch(
  [isGeocoderUnavailable, mapRef],
  ([isUnavailable]) => {
    if (isUnavailable) {
      mapRef.value?.markUnavailable?.()
    } else {
      mapRef.value?.markAvailable?.()
    }
  },
  { immediate: true },
)

watch(mapRef, (value) => {
  if (value) {
    clearMapChunkTimeout()
  }
})

const COUNTRY_CENTERS: Record<string, { latitude: number; longitude: number; zoom: number }> = {
  US: { latitude: 39.8283, longitude: -98.5795, zoom: 3 },
  CA: { latitude: 56.1304, longitude: -106.3468, zoom: 3 },
  MX: { latitude: 23.6345, longitude: -102.5528, zoom: 4 },
}

function recenterMapToCountry() {
  const center = COUNTRY_CENTERS[getSelectedCountryCode()]
  if (center) {
    mapRef.value?.panTo?.(center.latitude, center.longitude, center.zoom)
  }
}

const STATE_ZOOM = 6

async function panToState() {
  const region = regionOptions.value.find(entry => entry.code === shipping.stateCode)
  if (!region) {
    return
  }
  const coordinates = await geocodeAddress({
    state: region.name,
    country: getSelectedCountryCode(),
  })
  if (coordinates) {
    mapRef.value?.panTo?.(coordinates.latitude, coordinates.longitude, STATE_ZOOM)
  }
}

watch(() => shipping.stateCode, () => {
  if (isApplyingResolved || !shipping.enterFullAddress) {
    return
  }
  shipping.street = ''
  shipping.city = ''
  shipping.latitude = null
  shipping.longitude = null
  addressSuggestions.value = []
  if (showMap.value && shipping.stateCode) {
    panToState()
  }
})

function revealMap() {
  if (!isMapEnabled.value || showMap.value) {
    return
  }
  showMap.value = true
  armMapChunkTimeout()
}

function toggleMap() {
  if (!isMapEnabled.value) {
    return
  }
  showMap.value = !showMap.value
  if (showMap.value) {
    armMapChunkTimeout()
  } else {
    clearMapChunkTimeout()
    isMapChunkFailed.value = false
  }
}

watch(() => mapRef.value?.isMapReady, (isReady) => {
  if (isReady && showMap.value && !isApplyingResolved && shipping.latitude == null) {
    if (shipping.stateCode) {
      panToState()
    } else {
      recenterMapToCountry()
    }
  }
})

watch(() => shipping.enterFullAddress, (isOn) => {
  submitted.value = false
  if (!isOn) {
    showMap.value = false
    clearMapChunkTimeout()
    isMapChunkFailed.value = false
  }
})

// Build the ship-from origin passed to the estimate API. A selected supplier
// address wins; otherwise the manual ship-from postal (US) is used.
function buildOrigin() {
  // Opened from a warehouse row: rate from the warehouse's own address, which
  // carries its region — no supplier substitution, no postal-only fallback.
  const warehouseAddress = warehouseOrigin.value?.address
  if (warehouseAddress?.postalCode) {
    return {
      postalCode: warehouseAddress.postalCode,
      countryCode: warehouseAddress.countryCode || SHIP_FROM_COUNTRY,
      stateCode: warehouseAddress.regionCode || originStateCode.value || undefined,
      city: warehouseAddress.city || originCity.value || undefined,
      streetLine1: warehouseAddress.streetLine1 ?? undefined,
      streetLine2: warehouseAddress.streetLine2 ?? undefined,
    }
  }
  if (showConfirmSupplierAddress.value && selectedSupplierAddress.value) {
    const address = selectedSupplierAddress.value
    return {
      postalCode: address.postalCode,
      countryCode: address.countryCode,
      stateCode: address.stateCode || originStateCode.value || undefined,
      city: address.city || originCity.value || undefined,
      streetLine1: address.streetLine1 ?? undefined,
      streetLine2: address.streetLine2 ?? undefined,
    }
  }
  const postal = shipFromPostalCode.value.trim()
  if (postal) {
    return {
      postalCode: postal,
      countryCode: SHIP_FROM_COUNTRY,
      // Resolved from the postal code — the user never types a ship-from state.
      stateCode: originStateCode.value || undefined,
      city: originCity.value || undefined,
    }
  }
  return null
}

async function handleGetEstimates() {
  submitted.value = true
  if (!canSubmit.value) return

  // Full-address destination completeness (only when typing a full address).
  if (
    !inbound.value
    && shipping.enterFullAddress
    && (!shipping.street.trim() || !shipping.city.trim() || !shipping.stateCode)
  ) {
    return
  }
  await ensureOriginState()

  const origin = buildOrigin()
  if (!origin) return

  isLoading.value = true
  warnings.value = []

  // Destination: inbound → the fixed MSP01 warehouse; otherwise the Ship To form.
  let destination: {
    postalCode: string
    countryCode: string
    stateCode?: string
    city?: string
  }
  if (inbound.value) {
    const warehouseAddress = inboundWarehouse.value?.address
    if (!warehouseAddress?.postalCode) {
      isLoading.value = false
      toast.add({
        severity: 'error',
        summary: 'Shipping Estimate Failed',
        detail: 'Inbound warehouse MSP01 address is unavailable.',
        life: 5000,
      })
      return
    }
    destination = {
      postalCode: warehouseAddress.postalCode,
      countryCode: warehouseAddress.countryCode ?? 'US',
      stateCode: warehouseAddress.regionCode ?? undefined,
      city: warehouseAddress.city ?? undefined,
    }
  } else {
    const isPostalValid = await validateCurrentPostalCode()
    if (!isPostalValid) {
      estimates.value = []
      hasAttemptedEstimates.value = false
      isLoading.value = false
      return
    }
    destination = {
      postalCode: shipping.postalCode.trim(),
      countryCode: getSelectedCountryCode(),
      stateCode: shipping.stateCode.trim() || undefined,
      city: shipping.city.trim() || undefined,
    }
  }

  const { data, error } = await fetchEstimates({
    shippingCategory: effectiveCategory.value,
    origin,
    weightLb: effectiveWeight.value ?? 0,
    lengthIn: effectiveLength.value,
    widthIn: effectiveWidth.value,
    heightIn: effectiveHeight.value,
    destination,
    options: {
      accessorials: selectedAccessorialCodes.value,
    },
  })

  isLoading.value = false

  if (error) {
    estimates.value = []
    hasAttemptedEstimates.value = false
    toast.add({
      severity: 'error',
      summary: 'Shipping Estimate Failed',
      detail: error.message || 'Failed to fetch shipping estimates.',
      life: 5000,
    })
    return
  }

  estimates.value = data?.estimates ?? []
  warnings.value = data?.warnings ?? []
  hasAttemptedEstimates.value = true
}

async function loadManualSuppliers() {
  const productGroupId = await fetchProductSupplierGroupId()
  const { data, error } = await fetchBusinessPartners({
    relationshipType: 'supplier',
    businessPartnerGroupIds: productGroupId == null ? null : [productGroupId],
    sort: ['name'],
    limit: -1,
    fields: ['id', 'name', 'account_number'],
  })
  if (error) {
    console.error('Failed to load suppliers:', error.message)
    return
  }
  manualSuppliers.value = (data ?? []).map((partner: any) => ({
    id: partner.id,
    name: partner.name,
    accountNumber: partner.account_number ?? null,
  }))
}

// Manual mode: map Parcel/LTL group codes to ids so the Options load per category.
async function loadShippingGroups() {
  const { data, error } = await shippingGroupCrud.fetchMany({
    fields: ['id', 'code'],
    limit: -1,
  })
  if (error) {
    console.error('Failed to load shipping groups:', error.message)
    return
  }
  const byCode = new Map<string, number>(
    (data ?? []).map((group: any) => [group.code, group.id]),
  )
  manualGroupIds.value = {
    parcel: byCode.get('parcel') ?? null,
    ltl: byCode.get('ltl') ?? null,
  }
}

// Exposed so the drawer's footer button can drive submission without owning any
// of the rate logic (see DrawerShippingEstimator).
defineExpose({ handleGetEstimates, canSubmit, isLoading, submitDisabledHint })

function formatCost(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatCostForCopy(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(value)
}
</script>

<template>
  <div :class="['estimator', { 'estimator--manual': isManual }]">
      <!-- Ship From -->
      <div class="estimate-section">
        <div class="ship-to-header">
          <span class="drawer-section__title estimator-sublabel">Ship From</span>
          <span class="ship-to-header__rule" />
          <SelectButton
            v-model="shipFromSource"
            :options="shipFromOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            aria-label="Ship from origin"
            class="method-toggle"
          >
            <template #option="{ option }">
              <AppNavIcon
                :icon="option.icon"
                aria-hidden="true"
              />
              <span>{{ option.label }}</span>
            </template>
          </SelectButton>
        </div>

        <div
          v-if="isWarehouseOrigin"
          :class="['ship-from-grid', { 'ship-from-grid--wide': isManual }]"
        >
          <div class="form-field">
            <label class="form-field__label form-field__label--required" for="estimator-warehouse">
              Warehouse
            </label>
            <Select
              id="estimator-warehouse"
              v-model="shipFromWarehouseId"
              :options="warehouseOptions"
              option-label="label"
              option-value="value"
              placeholder="Select warehouse"
              :filter="warehouseOptions.length > 10"
              panel-class="address-select-panel"
              fluid
            />
          </div>
          <div class="form-field ship-from-grid__address">
            <label class="form-field__label form-field__label--required" for="estimator-warehouse-address">
              Address
            </label>
            <InputText
              id="estimator-warehouse-address"
              :model-value="warehouseOriginAddressLabel"
              disabled
              fluid
            />
          </div>
        </div>

        <div
          v-else
          :class="['ship-from-grid', { 'ship-from-grid--wide': isManual }]"
        >
          <div class="form-field">
            <label class="form-field__label" for="estimator-supplier">
              Supplier
            </label>
            <Select
              id="estimator-supplier"
              v-model="supplierId"
              :options="supplierOptions"
              option-label="label"
              option-value="value"
              placeholder="Select supplier"
              :filter="supplierOptions.length > 10"
              show-clear
              panel-class="address-select-panel"
              fluid
            />
          </div>

          <div
            v-if="showSupplierAddress"
            class="form-field ship-from-grid__address"
          >
            <label class="form-field__label" for="estimator-supplier-address">
              Address
              <span v-if="isSupplierAddressRequired" class="form-field__required">*</span>
            </label>
            <Select
              id="estimator-supplier-address"
              v-model="supplierAddressJunctionId"
              :options="supplierAddressOptions"
              option-label="label"
              option-value="value"
              :placeholder="supplierAddressPlaceholder"
              :disabled="supplierAddressDisabled || isSupplierAddressesLoading"
              :loading="isSupplierAddressesLoading"
              panel-class="address-select-panel"
              fluid
            >
              <template #loadingicon>
                <BaseSpinner size="sm" class="estimator-select__spinner" />
              </template>
            </Select>
          </div>

          <div
            v-if="showShipFromPostal"
            class="form-field"
          >
            <label class="form-field__label" for="estimator-ship-from-postal">
              Postal Code
              <span v-if="isShipFromPostalRequired" class="form-field__required">*</span>
            </label>
            <InputText
              id="estimator-ship-from-postal"
              v-model="shipFromPostalCode"
              v-trim
              fluid
              placeholder="Enter postal code"
              v-bind="AUTOFILL_OFF"
              @blur="handleShipFromPostalBlur"
            />
          </div>

          <div
            v-else-if="showConfirmSupplierAddress"
            class="form-field ship-from-grid__confirm"
          >
            <span class="form-field__label" aria-hidden="true">&nbsp;</span>
            <div class="estimator-info estimator-info--fill">
              <i class="pi pi-info-circle estimator-info__icon" aria-hidden="true" />
              <span>Confirm supplier address.</span>
            </div>
          </div>
        </div>

      </div>

      <!-- Ship To -->
      <div class="estimate-section">
        <div class="ship-to-header">
          <span class="drawer-section__title estimator-sublabel">Ship To</span>
          <span class="ship-to-header__rule" />
          <SelectButton
            v-model="inbound"
            :options="directionOptions"
            option-label="label"
            option-value="value"
            option-disabled="disabled"
            :allow-empty="false"
            aria-label="Shipment direction"
            class="method-toggle"
          >
            <template #option="{ option }">
              <AppNavIcon
                :icon="option.icon"
                aria-hidden="true"
              />
              <span>{{ option.label }}</span>
            </template>
          </SelectButton>
        </div>

        <!-- Inbound always lands at MSP01, so the destination is a locked field
             rather than a choice — shown the same way as the Ship From warehouse
             so both directions read alike. -->
        <div
          v-if="inbound"
          class="ship-to-warehouse"
        >
          <div class="form-field">
            <label
              class="form-field__label form-field__label--required"
              for="estimator-inbound-warehouse"
            >
              Warehouse
            </label>
            <Select
              id="estimator-inbound-warehouse"
              :model-value="inboundWarehouseLabel"
              :options="inboundWarehouseOptions"
              option-label="label"
              option-value="value"
              disabled
              panel-class="address-select-panel"
              fluid
            />
          </div>
        </div>

        <template v-else>
          <!-- Country | Postal | Enter full address — three across on the page,
               stacked in the narrow drawer. -->
          <div class="ship-to-primary">
            <div class="form-field">
              <label class="form-field__label form-field__label--required" for="estimator-country">
                Country
              </label>
              <Select
                id="estimator-country"
                v-model="shipping.country"
                :options="countries"
                :filter="countries.length > 10"
                panel-class="address-select-panel"
                fluid
              />
            </div>
            <div class="form-field">
              <label class="form-field__label form-field__label--required" for="estimator-postal">
                Postal Code
              </label>
              <InputText
                id="estimator-postal"
                v-model="shipping.postalCode"
                v-trim
                fluid
                v-bind="AUTOFILL_OFF"
                @blur="handlePostalCodeBlur"
                @keyup.enter="handleGetEstimates"
              />
              <span v-if="postalLookupError" class="postal-code-hint postal-code-hint--error">
                {{ postalLookupError }}
              </span>
              <Message
                v-if="postalResolvedNote"
                severity="warn"
                :closable="false"
                size="small"
                class="postal-resolved-note"
              >
                {{ postalResolvedNote }}
              </Message>
            </div>
            <div class="form-field ship-to-primary__toggle">
              <span class="form-field__label" aria-hidden="true">&nbsp;</span>
              <div class="full-address-toggle">
                <span>Enter full address</span>
                <InputSwitch v-model="shipping.enterFullAddress" />
              </div>
            </div>
          </div>
          <template v-if="shipping.enterFullAddress">
            <div class="estimate-address-row">
            <div class="form-field">
              <label class="form-field__label form-field__label--required" for="estimator-street">
                Street
              </label>
              <div
                ref="autocompleteWrapperRef"
                class="autocomplete-icon-wrapper"
                :class="{ 'autocomplete-icon-wrapper--has-picker': isMapEnabled }"
              >
                <i
                  v-if="isMapEnabled"
                  class="pi pi-map-marker autocomplete-icon"
                  :class="{ 'autocomplete-icon--active': showMap }"
                  role="button"
                  tabindex="0"
                  aria-label="Toggle map"
                  v-tooltip.top="showMap ? 'Hide map' : 'Pick location on map'"
                  @click="toggleMap"
                  @keydown.enter.space.prevent="toggleMap"
                />
                <AutoComplete
                  id="estimator-street"
                  v-model="shipping.street"
                  :suggestions="addressSuggestions"
                  option-label="label"
                  fluid
                  :delay="300"
                  :min-length="3"
                  :loading="isSearching"
                  :invalid="fullAddressErrors.street"
                  :overlay-style="autocompleteOverlayStyle"
                  :pt="AUTOFILL_OFF_PT"
                  @focus="locationStore.requestLocation()"
                  @complete="onAddressSearch"
                  @option-select="onAddressSelect"
                >
                  <template #option="slotProps">
                    <div class="address-suggestion">
                      <i class="pi pi-map-marker" />
                      <span>{{ slotProps.option.label }}</span>
                    </div>
                  </template>
                </AutoComplete>
              </div>
              <span
                v-if="fullAddressErrors.street"
                class="form-field__error"
              >Street is required</span>
            </div>
            <div class="form-field">
              <label class="form-field__label" for="estimator-unit">Unit/Suite</label>
              <BaseClearableInput
                id="estimator-unit"
                v-model="shipping.unitSuite"
                v-trim
                fluid
                v-bind="AUTOFILL_OFF"
              />
            </div>
            </div>
            <div class="estimate-address-row">
              <div class="form-field">
                <label class="form-field__label form-field__label--required" for="estimator-city">
                  City
                </label>
                <BaseClearableInput
                  id="estimator-city"
                  v-model="shipping.city"
                  v-trim
                  fluid
                  :invalid="fullAddressErrors.city"
                  v-bind="AUTOFILL_OFF"
                />
                <span
                  v-if="fullAddressErrors.city"
                  class="form-field__error"
                >City is required</span>
              </div>
              <div class="form-field">
                <label class="form-field__label form-field__label--required" for="estimator-state">
                  State
                </label>
                <Select
                  id="estimator-state"
                  v-model="shipping.stateCode"
                  :options="regionOptions"
                  option-label="displayLabel"
                  option-value="code"
                  :placeholder="isRegionsLoading ? 'Loading…' : 'Select a state'"
                  :loading="isRegionsLoading"
                  :invalid="fullAddressErrors.state"
                  :filter="regionOptions.length > 10"
                  panel-class="address-select-panel"
                  fluid
                />
                <span
                  v-if="fullAddressErrors.state"
                  class="form-field__error"
                >State is required</span>
              </div>
            </div>
            <div
              v-if="showMap"
              class="estimate-map"
            >
              <LazyBaseMapbox
                ref="mapRef"
                :key="mapInstanceKey"
                :latitude="shipping.latitude"
                :longitude="shipping.longitude"
                @update:latitude="shipping.latitude = $event"
                @update:longitude="shipping.longitude = $event"
                @dragend="handleMarkerDragEnd"
              />
              <div
                v-if="!isMapChunkFailed && !mapRef?.isMapReady && !mapRef?.mapLoadFailed"
                class="estimate-map__loader"
              >
                <BaseSpinner size="md" />
              </div>
              <div
                v-else-if="isMapChunkFailed && !mapRef"
                class="estimate-map__error"
              >
                <i class="pi pi-map-marker estimate-map__error-icon" />
                <span class="estimate-map__error-text">Location unavailable</span>
                <Button
                  label="Retry"
                  severity="secondary"
                  size="small"
                  icon="pi pi-refresh"
                  @click="retryMapChunk"
                />
              </div>
            </div>
          </template>
        </template>
      </div>

      <!-- Shipment -->
      <div
        v-if="isManual || isAccessorialsLoading || accessorialOptions.length"
        class="estimate-section"
      >
        <div class="ship-to-header">
          <span class="drawer-section__title">Shipment</span>
          <span class="ship-to-header__rule" />
          <SelectButton
            v-model="selectedCategory"
            :options="categoryOptions"
            option-label="label"
            option-value="value"
            option-disabled="disabled"
            :allow-empty="false"
            aria-label="Shipping method"
            class="method-toggle"
            @change="handleCategoryChange"
          >
            <template #option="{ option }">
              <img
                v-if="option.iconSrc"
                :src="option.iconSrc"
                alt=""
                aria-hidden="true"
                class="method-toggle__asset-icon"
              >
              <AppNavIcon
                v-else
                :icon="option.icon"
                aria-hidden="true"
              />
              <span>{{ option.label }}</span>
            </template>
          </SelectButton>
        </div>

        <!-- Weight-driven method notes. Over 50 lb LTL is advised and
             auto-selected but Parcel stays available; over 75 lb Parcel is gone
             entirely. Both are telling the user what the weight decided, not
             flagging a problem they have to fix, so both use the same skyblue
             callout as the "Confirm supplier address." note. -->
        <div
          v-if="weightMethodNote"
          class="estimator-info shipment-method-note"
        >
          <i
            class="pi pi-info-circle estimator-info__icon"
            aria-hidden="true"
          />
          <span>{{ weightMethodNote }}</span>
        </div>

        <div class="shipment-grid">
          <div class="form-field">
            <label
              for="estimator-weight"
              class="form-field__label form-field__label--required"
            >
              Weight
            </label>
            <InputNumber
              id="estimator-weight"
              v-model="selectedWeight"
              :min="0"
              :max-fraction-digits="2"
              suffix=" lbs"
              placeholder="Enter weight"
              fluid
              @input="handleWeightInput"
            />
          </div>

          <div
            v-if="isAccessorialsLoading || accessorialOptions.length"
            class="estimate-options"
          >
            <span class="estimate-options__label">Options</span>
            <Transition
              name="estimate-options-fade"
              mode="out-in"
            >
              <div
                :key="accessorialsRenderKey"
                class="estimate-options__grid"
                :aria-busy="isAccessorialsLoading"
              >
                <div
                  v-for="accessorial in accessorialOptions"
                  :key="accessorial.id"
                  class="checkbox-field"
                >
                  <Checkbox
                    v-model="shipping.accessorials"
                    :inputId="`accessorial-shipment-${accessorial.id}`"
                    :value="accessorial.id"
                    :disabled="isAccessorialBlocked(accessorial)"
                  />
                  <label
                    class="checkbox-field__label"
                    :for="`accessorial-shipment-${accessorial.id}`"
                    v-tooltip.top="isAccessorialBlocked(accessorial)
                      ? 'Cannot be combined with the other delivery-location option.'
                      : accessorial.description"
                  >
                    {{ accessorial.name }}
                  </label>
                </div>
                <div
                  v-for="index in (isAccessorialsLoading && !accessorialOptions.length ? ACCESSORIAL_SKELETON_COUNT : 0)"
                  :key="`accessorial-skeleton-${index}`"
                  class="checkbox-field"
                  aria-hidden="true"
                >
                  <span class="skeleton-block estimate-options__skeleton-box" />
                  <span class="skeleton-block estimate-options__skeleton-text estimate-options__skeleton-text--unmeasured" />
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <div
          v-if="isManual"
          class="shipment-actions"
        >
          <span
            v-tooltip.top="submitDisabledHint"
            class="shipment-actions__button-wrap"
          >
            <Button
              class="shipment-actions__submit"
              :disabled="!canSubmit"
              @click="handleGetEstimates"
            >
              <BaseSpinner
                v-if="isLoading"
                size="sm"
                class="shipment-actions__spinner"
              />
              <AppNavIcon
                v-else
                icon="ms:local_shipping"
                aria-hidden="true"
              />
              <span>Get Estimate</span>
            </Button>
          </span>
        </div>
      </div>

      <!-- Estimates -->
      <div class="estimate-section">
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Estimates</span>
        </div>
        <Message
          v-for="warning in warnings"
          :key="warning"
          severity="error"
          :closable="false"
          class="estimate-message"
        >
          {{ warning }}
        </Message>
        <div
          class="estimates-table-wrap"
          :class="{ 'estimates-table-wrap--footer-shadow': hasLoadedEstimates && showFooterShadow }"
        >
        <DataTable
          :key="tableStateKey"
          ref="estimatesTableRef"
          v-bind="columnResizeProps"
          :class="['is-row-hoverable', { 'estimates-table--loading': isLoading }]"
          :value="isLoading ? estimateSkeletonRows : estimates"
          scrollable
          :scroll-height="tableScrollHeight"
          :virtual-scroller-options="tableVirtualScroller"
          :sort-field="hasLoadedEstimates ? 'cost' : null"
          :sort-order="hasLoadedEstimates ? 1 : null"
          :row-class="(rowData) => rowData._skeleton ? 'skeleton-row' : ''"
        >
          <Column field="carrier" header="Carrier" sortable>
            <template #body="{ data: row }">
              <div v-if="row._skeleton" class="skeleton-block" />
              <template v-else>
                {{ row.carrier }}
              </template>
            </template>
          </Column>
          <Column field="method" header="Method" sortable>
            <template #body="{ data: row }">
              <div v-if="row._skeleton" class="skeleton-block" />
              <template v-else>
                {{ row.method }}
              </template>
            </template>
          </Column>
          <Column field="cost" header="Cost" sortable>
            <template #body="{ data: row }">
              <div v-if="row._skeleton" class="skeleton-block" />
              <BaseCopyText
                v-else
                :value="formatCost((row as ShippingEstimate).cost, (row as ShippingEstimate).currency)"
                :copy-value="formatCostForCopy((row as ShippingEstimate).cost)"
                label-color="var(--p-gray-800)"
                class="estimate-cost-copy"
              />
            </template>
          </Column>
          <Column
        v-if="hasStoredColumnWidths"
        class="table-spacer"
      />
          <BaseFrozenColumn
            v-if="!hasLoadedEstimates"
            key="frozen"
            :table-ref="estimatesTableRef"
          />
          <template
            v-if="isEmptyState"
            #footer
          >
            <BaseDataTableFooterLoader
              :show-shadow="showFooterShadow"
              :first-row="firstVisibleRow"
              :last-row="lastVisibleRow"
              :total-records="estimates.length"
              page-label="estimates"
              :empty-msg="emptyEstimatesMessage"
            />
          </template>
        </DataTable>

        <BaseColumnResizeMenu v-bind="columnMenuProps" />
        </div>
      </div>
    </div>
</template>

<style scoped>
.estimator {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-5);
}

.estimate-section {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

/* Heading with a trailing rule (mirrors BasePanel's title divider). Figma
   "Body-md/demibold": 14px / weight 600 / deepblue-900. */
.estimate-section__title {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-semibold);
    line-height: var(--p-spacing-5);
    color: var(--p-deepblue-900);
    white-space: nowrap;
}

.estimate-section__title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--p-surface-200);
}

/* Supplier + (optional) manual ship-from postal / confirm note side by side. */
.ship-from-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-3);

    @media (min-width: 768px) {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: var(--p-spacing-4);
    }
}

/* The "Confirm supplier address." note sits in the second column. A blank label
   spacer lines it up with the Supplier input beside it; the note then fills that
   input's height so both columns read as equal, balanced space. */
.ship-from-grid__confirm {
    min-width: 0;
}

/* Standalone /tools estimator (manual mode) is full page width. The field grid
   fills it in three even columns (Ship From, Ship To) so there's no leftover
   space on the right; two-field rows align to the same columns. The drawer keeps
   its own 2-col layout. */
.ship-from-grid--wide {
    @media (min-width: 768px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

/* Drawer (2-col): Supplier Address spans the full width on its own row below
   Supplier + the postal/confirm, matching the original drawer layout. */
.ship-from-grid:not(.ship-from-grid--wide) .ship-from-grid__address {
    order: 1;

    @media (min-width: 768px) {
        grid-column: 1 / -1;
    }
}

/* Street | Unit and City | State align to the same 3-col grid, so the two fields
   sit in columns 1–2 and match the widths (and column gap) of the rows above. */
.estimator--manual .estimate-address-row {
    @media (min-width: 768px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--p-spacing-4);
    }
}

/* Ship To top row — Country | Postal | Enter full address. Three across on the
   page, stacked in the narrow drawer. */
/* Drawer: Country takes its own row, then Postal Code and the "Enter full address"
   toggle sit side by side beneath it — the toggle belongs with the field it
   expands, not stranded on a row of its own. */
/* Drawer: Country on its own row, then Postal Code and the "Enter full address"
   toggle splitting the row in equal halves. */
.ship-to-primary {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--p-spacing-3);
}

.ship-to-primary > .form-field:first-child {
    grid-column: 1 / -1;
}

/* Manual page keeps all three across from tablet up, and stacked below it. */
.estimator--manual .ship-to-primary {
    grid-template-columns: 1fr;

    @media (min-width: 768px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--p-spacing-4);
        align-items: start;
    }
}

.estimator--manual .ship-to-primary > .form-field:first-child {
    grid-column: auto;
}

/* Inbound's locked Warehouse field. Same grid as .ship-to-primary so the box is
   exactly as wide as the Country field that occupies this slot when outbound —
   switching direction doesn't resize the row. Its single child takes column one;
   the drawer stacks full-width like every other field. */
.ship-to-warehouse {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-3);
}

.estimator--manual .ship-to-warehouse {
    @media (min-width: 768px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--p-spacing-4);
    }
}

/* "Enter full address" has no field of its own: a blank label spacer drops it to
   the input row, then the toggle fills that row and centres on the Country /
   Postal input boxes beside it. */
.ship-to-primary__toggle .full-address-toggle {
    flex: 1;
}

.estimator--manual .ship-to-primary__toggle {
    @media (min-width: 768px) {
        align-self: stretch;
    }
}

.shipment-method-note {
    margin: 0;
}

/* Segmented-control styling is shared — see `.method-toggle` in
   assets/css/modules/button.css. Only the asset-icon variant is shipping-only. */
.method-toggle__asset-icon {
    width: var(--p-spacing-3-5);
    height: auto;
    display: inline-block;
    flex: 0 0 auto;
}

.method-toggle :deep(.p-togglebutton-checked .method-toggle__asset-icon) {
    filter: brightness(0) saturate(100%) invert(50%) sepia(88%) saturate(1716%) hue-rotate(162deg) brightness(95%) contrast(101%);
}

.ship-to-header {
    display: flex;
    width: 100%;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--p-spacing-3);
}

/* Trailing rule that runs from the Ship To heading up to the Inbound toggle
   (mirrors drawer-section__heading::after, which we can't use here because the
   toggle must sit after the rule). */
.ship-to-header__rule {
    flex: 1;
    height: 1px;
    background: var(--p-surface-200);
}

/* Inline info callout — reuses the app's skyblue info highlight (Special Order
   SKU card / cross-scope toast), so no new colour is introduced. */
.estimator-info {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    padding: var(--p-spacing-2) var(--p-spacing-3);
    background: var(--p-skyblue-50);
    border: 1px solid var(--p-skyblue-200);
    /* Match the inputs/selects (borderRadius.xs) so the callouts sit in line. */
    border-radius: var(--p-border-radius-xs);
    color: var(--p-skyblue-600);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-semibold);
}

.estimator-info__icon {
    flex-shrink: 0;
    color: var(--p-skyblue-600);
    font-size: var(--p-font-size-sm);
}

/* Fill the Supplier input's height so the note reads as an equal-weight column
   beside it, with the text comfortably centred. */
.estimator-info--fill {
    flex: 1;
}

.estimator-select__spinner {
    width: var(--p-font-size-base);
    height: var(--p-font-size-base);
}

.estimate-address-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-3);

    @media (min-width: 768px) {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
}

.estimate-address-row > .form-field {
    min-width: 0;
}

/* Street autocomplete (mirrors the Add-Address drawer) */
.autocomplete-icon-wrapper {
    position: relative;
}

.autocomplete-icon {
    position: absolute;
    right: var(--p-spacing-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--p-text-muted-color);
    z-index: 1;
    cursor: pointer;
    transition: color var(--p-transition-duration);
}

.autocomplete-icon:hover,
.autocomplete-icon--active {
    color: var(--p-primary-color);
}

/* Room for the pin toggle — only when it's there (item mode), so the manual-mode
   input keeps PrimeVue's own padding instead of a gap with nothing in it. */
.autocomplete-icon-wrapper--has-picker :deep(.p-autocomplete-input) {
    padding-right: var(--p-spacing-8);
}

.autocomplete-icon-wrapper :deep(.p-autocomplete) {
    width: 100%;
}

.address-suggestion {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    overflow: hidden;
}

.address-suggestion span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.estimate-map {
    position: relative;
    width: 100%;
    min-width: 0;
    height: 200px;
    border-radius: var(--p-border-radius-sm);
    overflow: hidden;
}

.estimate-map__loader,
.estimate-map__error {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--p-surface-100);
}

.estimate-map__error {
    flex-direction: column;
    gap: var(--p-spacing-3);
}

.estimate-map__error-icon {
    font-size: var(--p-font-size-3xl);
    color: var(--p-surface-400);
}

.estimate-map__error-text {
    font-size: var(--p-font-size-sm);
    color: var(--p-surface-500);
}

.estimates-table--loading :deep(.p-datatable-table-container) {
    overflow-y: hidden !important;
}

.estimates-table-wrap {
    position: relative;
}

.estimates-table-wrap::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--p-spacing-2);
    background: linear-gradient(to top, var(--p-shadow-8), transparent);
    opacity: 0;
    transition: opacity var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
    pointer-events: none;
}

.estimates-table-wrap--footer-shadow::after {
    opacity: 1;
}

.estimate-section :deep(.p-datatable-footer) {
    padding: 0;
}

.estimate-section :deep(.infinite-scroll-footer) {
    box-sizing: border-box;
    align-items: end;
    min-height: calc(var(--p-spacing-4) + var(--p-spacing-7));
    padding: var(--p-spacing-4) 0 0;
}

.estimate-section :deep(.footer-spacing) {
    padding-top: 0;
}

.estimate-options {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}

/* Two per row: options 1 & 2 share a line, the third wraps to the next. */
.estimate-options__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--p-spacing-2) var(--p-spacing-4);
}

/* Manual page has a wide Options column, so the checkboxes flow on one line
   (content width) instead of the drawer's fixed two-per-row grid. */
.estimator--manual .estimate-options__grid {
    display: flex;
    flex-wrap: wrap;
    gap: var(--p-spacing-2) var(--p-spacing-5);
}

.estimate-options__label {
    font-size: var(--p-font-size-sm);
    /* Match the field labels (.form-field__label). */
    color: var(--p-gray-800);
}

.estimate-options-fade-enter-active {
    transition: opacity var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.estimate-options-fade-leave-active {
    transition: opacity var(--p-transition-duration-fast) var(--p-transition-timing-ease-in);
}

.estimate-options-fade-enter-from,
.estimate-options-fade-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .estimate-options-fade-enter-active,
    .estimate-options-fade-leave-active {
        transition: none;
    }
}

.estimate-options__skeleton-box {
    /* The checkbox's own footprint. */
    flex: 0 0 auto;
    width: var(--p-checkbox-width);
    height: var(--p-checkbox-height);
    border-radius: var(--p-border-radius-xs);
}
.estimate-options__skeleton-text {
    width: auto;
    height: auto;
    color: transparent;
    cursor: default;
    border-radius: var(--p-border-radius-xs);
}
.estimate-options__skeleton-text--unmeasured {
    width: calc(var(--p-spacing-20) + var(--p-spacing-12));
    height: var(--p-spacing-5);
}

.estimate-cost-copy {
    gap: var(--p-spacing-2);
}

.postal-code-hint {
    font-size: var(--p-font-size-xs);
    color: var(--p-text-muted-color);
    margin-top: var(--p-spacing-1);
}

.postal-code-hint--error {
    color: var(--p-red-500);
}

.postal-resolved-note {
    margin-top: var(--p-spacing-2);
}

.estimate-message {
    color: var(--p-red-700);
}

.full-address-toggle {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    white-space: nowrap;
    font-size: var(--p-font-size-sm);
    /* Match the field labels (.form-field__label). */
    color: var(--p-gray-800);
}

/* Shipment: drawer fields use the same half-width rhythm as the other form rows.
   Manual mode keeps its wider Weight + Options split below. */
.shipment-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--p-spacing-4);
}

.estimator--manual .shipment-grid {
    grid-template-columns: 1fr;

    @media (min-width: 768px) {
        grid-template-columns: 1fr 2fr;
    }
}

.shipment-grid > .estimate-options {
    grid-column: 1 / -1;
}

.estimator--manual .shipment-grid > .estimate-options {
    grid-column: auto;
}

.shipment-actions {
    display: flex;
    /* Get Estimate has spacing/xl (24px) clear above and below in Figma. The
       Shipment section gap (16) above and the inter-section gap (20) below already
       contribute, so top each up to 24. */
    margin-top: var(--p-spacing-2);
    margin-bottom: var(--p-spacing-1);
}

.shipment-actions__button-wrap {
    display: inline-flex;
}

.shipment-actions__submit.p-button {
    display: inline-flex;
    align-items: center;
    gap: var(--p-button-gap);
}

/* AppNavIcon's inline <svg> sizes off the inherited font-size; keep the flex row
   from squeezing it. */
.shipment-actions__submit .app-nav-icon-svg {
    flex-shrink: 0;
}

.shipment-actions__spinner {
    width: var(--p-font-size-sm);
    height: var(--p-font-size-sm);
}
</style>
