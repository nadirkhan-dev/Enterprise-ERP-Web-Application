<script setup lang="ts">
import { useSuppliersNavigationStore } from '~/stores/suppliersNavigation'

const route = useRoute()
const toast = useToast()
const navStore = useSuppliersNavigationStore()
const { fetchBusinessPartner, fetchBusinessPartnerByAccountNumber, fetchPartnerSyncState, updateBusinessPartner, fetchPartnerManufacturers, reorderPartnerManufacturers, addPartnerManufacturers } = useBusinessPartners()
const { fetchSupplierPerformance, fetchSupplierPurchaseOrders, fetchSupplierQuarterlyChart } = useLooker()
const { getResponsiveUrl } = useAssetUrl()
const { subscribe: subscribeSapSync } = useSapSyncSocket()

const PURCHASE_ORDERS_PAGE_SIZE = 20

// SAP card codes are "C" or "V" + 6 digits. The detail route is keyed on the
// Directus id, but legacy/bookmarked links (and anything before a new supplier's
// SAP id syncs) may pass the SAP id — so we detect and resolve either form.
const SAP_ID_PATTERN = /^[CV]\d{6}$/i

const isLoading = ref(true)
const { showLoader } = useDeferredLoading(isLoading)
const isPerformanceLoading = ref(true)
const isPurchaseOrdersLoading = ref(false)
const hasMorePurchaseOrders = ref(false)
const purchaseOrdersAllLoaded = ref(false)
const hasLoadError = ref(false)
const loadError = ref<string | null>(null)
const logoId = ref<string | null>(null)
const partnerId = ref<number | null>(null)
const logoFileInputRef = ref<HTMLInputElement | null>(null)
const defaultBillingAddressJunctionId = ref<number | null>(null)
const defaultShippingAddressJunctionId = ref<number | null>(null)
const defaultSalesContactJunctionId = ref<number | null>(null)
const defaultBillingContactJunctionId = ref<number | null>(null)
const partnerPhoneNumbers = ref<Record<string, any>[]>([])
const addresses = ref<Record<string, any>[]>([])
const shippingAccounts = ref<ShippingAccountView[]>([])
const defaultParcelShippingJunctionId = ref<number | null>(null)
const defaultLtlShippingJunctionId = ref<number | null>(null)
const accountInfoDrawerVisible = ref(false)

// Upload, FK repoint and deletion of the superseded file all happen in one
// server round-trip — see useFiles.ts for why the delete can't live in the browser.
const {
  isLogoProcessing,
  logoSrc,
  logoSrcset,
  handleLogoSelect,
  handleLogoRemove,
} = useEntityLogo(LOGO_COLLECTIONS.businessPartners, partnerId, logoId)

function triggerLogoUpload() {
  logoFileInputRef.value?.click()
}

const supplier = reactive({
  name: '',
  website: '',
  remarks: '',
  sapId: '',
  status: '',
  groupName: '',
  lifetimePurchaseOrderCount: 0,
  lifetimePurchaseOrderDollars: '$0.00',
  openPurchaseOrderCount: 0,
  openPurchaseOrderDollars: '$0.00',
  accountBalance: '$0.00',
  paymentTerms: 'Cash Basic',
  creditLimit: '$0.00',
  accountStanding: 'Good',
})

// A freshly-created supplier loads by Directus id and has no `account_number` until the
// Service Master sync writes it back — show a spinner in the header meanwhile.
const isAwaitingSapId = computed(() => partnerId.value != null && !supplier.sapId)
const isSapSyncFailed = ref(false)
// Human-readable reason for the current failed/unconfirmed sync — the Service
// Master error, the reason the Directus flow stamped on the record, or a
// context-aware default. Bound to the failed indicator's tooltip so the cause
// stays visible after the toast dismisses. Null while syncing or once synced.
const sapSyncError = ref<string | null>(null)
// Set to a formatted timestamp when the sync succeeds live this session — drives
// the "Synced" indicator tooltip. Null for records that loaded already-synced.
const sapSyncedAt = ref<string | null>(null)

// Detail-page title is the semantic identifier (SAP account number); reactive so
// it updates once the record loads. Falls back to 'Supplier' before data arrives.
useHead({ title: () => supplier.sapId || 'Supplier' })

// Account Information panel/drawer model — shaped like the customer `customer`
// object so the shared CustomerAccountInfoPanel + DrawerAccountInfo components
// can be reused with relationship-type="supplier".
const accountInfo = reactive({
  account: '',
  accountNumber: '',
  companyName: '',
  status: '',
  website: '',
  companyPhone: '—',
  customerGroupId: null as number | null,
  customerGroup: '',
  shopifyLogin: false,
  isNationalAccount: false,
  accountRep: '—',
  // The current account manager's id — forwarded to DrawerAccountInfo so an
  // Operations Manager's reassign Select preselects and diffs against it.
  accountManagerId: null as string | null,
  primaryContactName: '—',
  primaryContactTitle: '',
  primaryContactEmail: '',
  billingContactName: '—',
  billingContactTitle: '',
  billingContactEmail: '',
  defaultParcelCarrier: '—',
  parcelAccountNumber: '—',
  defaultLtlCarrier: '—',
  ltlAccountNumber: '—',
})

/** "First Last" (name only) for a contact record, em dash when absent. */
function formatContactName(contact: Record<string, any> | null | undefined): string {
  if (!contact) { return '—' }
  const name = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
  return name || '—'
}

function openEditAccountInfo() {
  accountInfoDrawerVisible.value = true
}

const contactCount = ref(0)
const rawContacts = ref<Record<string, any>[] | null>(null)
const mappedContacts = computed(() => mapContacts(rawContacts.value))
const addressCount = ref(0)
// Rows are shaped in loadManufacturers to SectionManufacturers' ManufacturerRow
// contract (that component owns the canonical type).
const manufacturers = ref<any[]>([])
// The endpoint returns the dashboard tile's full result set in one call, so
// `allPurchaseOrders` holds every row and `purchaseOrders` is the slice actually
// rendered — grown a page at a time from memory, costing no further requests.
const allPurchaseOrders = ref<Record<string, any>[]>([])
const purchaseOrders = ref<Record<string, any>[]>([])

// Activities — same add/edit UX as customers (CONNECT-546), via the shared
// `useBusinessPartnerActivities` composable. Suppliers rarely have an Account
// Manager, but the "assign to the AM when a follow-up date is set" default still
// applies, so accountManagerId is forwarded all the same.
const accountManagerId = ref<string | null>(null)
const {
  activities,
  activityGroups,
  activityCount,
  isActivitiesLoading,
  isActivitiesLoadingMore,
  hasMoreActivities,
  loadActivities,
  loadMoreActivities,
  loadAllActivities,
  loadActivityGroups,
  reloadActivities,
} = useBusinessPartnerActivities(partnerId)

const chartBars = ref<{ label: string, bookedSales: number, orderCount: number }[]>([])
const isChartLoading = ref(true)

const lookerUrl = computed(() => {
  if (!supplier.sapId) return null
  return `https://libertysupply.cloud.looker.com/dashboards/157?Vendor%20Account%20Number=${encodeURIComponent(supplier.sapId)}&Created%20On%20Date=9%20quarter`
})

// "View in Looker" link for the Purchase Orders table — filtered to this
// supplier's account. Dashboard 170 = Supplier Purchase Orders Data.
function buildPurchaseOrdersLookerUrl(documentStatus: string | null = null): string | null {
  if (!supplier.sapId) return null
  const params = [`Vendor%20Account%20Number=${encodeURIComponent(supplier.sapId)}`]
  if (documentStatus) {
    params.push(`Document%20Status=${encodeURIComponent(documentStatus)}`)
  }
  return `https://libertysupply.cloud.looker.com/dashboards/170?${params.join('&')}`
}

const purchaseOrdersLookerUrl = computed(() => buildPurchaseOrdersLookerUrl())
// Stat-card deep-links scope the report to the exact figure clicked: Lifetime PO →
// every PO (Open + Closed), Open PO → Open only.
const purchaseOrdersLifetimeLookerUrl = computed(() => buildPurchaseOrdersLookerUrl('Open,Closed'))
const purchaseOrdersOpenLookerUrl = computed(() => buildPurchaseOrdersLookerUrl('Open'))

async function loadSupplierQuarterlyChart(cardCode: string) {
  isChartLoading.value = true
  const { data, error } = await fetchSupplierQuarterlyChart(cardCode)

  if (error) {
    console.error('Failed to load supplier quarterly chart:', error.message)
    chartBars.value = []
    isChartLoading.value = false
    return
  }

  chartBars.value = data?.rows ?? []
  isChartLoading.value = false
}

/**
 * Map raw Directus junction contacts to the table-friendly shape.
 */
function mapContacts(rawContacts: Record<string, any>[] | null) {
  if (!rawContacts?.length) {
    return []
  }
  return rawContacts.map((junction) => {
    const contactRecord = junction.contacts_id || {}
    return {
      id: junction.id,
      contactId: contactRecord.id,
      sortOrder: junction.contacts_sort ?? null,
      name: `${contactRecord.first_name || ''} ${contactRecord.last_name || ''}`.trim(),
      firstName: contactRecord.first_name || '',
      lastName: contactRecord.last_name || '',
      jobTitle: contactRecord.job_title || '',
      email: contactRecord.email_address || '',
      phone: formatPhoneNumber(getPrimaryPhone(contactRecord)),
      status: junction.status || 'active',
      notes: junction.remarks || '',
      addressJunctionId: junction.business_partners_addresses_id || null,
      allowTransactionalEmail:
        junction.allow_transactional_email || false,
      allowMarketingEmail: junction.allow_marketing_email || false,
      allowTransactionalSms: junction.allow_transactional_sms || false,
      allowMarketingSms: junction.allow_marketing_sms || false,
      inactiveNote: junction.inactive_note || '',
      phoneNumbers: mapPhoneNumbers(contactRecord.phone_numbers),
    }
  })
}

/**
 * Map raw Directus junction addresses to the table-friendly shape.
 */
function mapAddresses(rawAddresses: Record<string, any>[] | null) {
  if (!rawAddresses?.length) {
    return []
  }
  return rawAddresses.map((junction) => {
    const addressRecord = junction.addresses_id || {}
    const isBilling = junction.is_billing_address || false
    const isShipping = junction.is_shipping_address || false
    const isDefaultBilling = defaultBillingAddressJunctionId.value === junction.id
    const isDefaultShipping = defaultShippingAddressJunctionId.value === junction.id

    return {
      id: junction.id,
      addressId: addressRecord.id,
      sortOrder: junction.addresses_sort ?? null,
      status: junction.status || 'active',
      inactiveNote: junction.inactive_note || '',
      street: addressRecord.street_line_1 || '',
      unitSuite: addressRecord.street_line_2 || '',
      city: addressRecord.city || '',
      state: formatRegionLabel(addressRecord.regions_id),
      postalCode: addressRecord.postal_code || '',
      country: addressRecord.countries_id?.code || '',
      isBilling,
      isShipping,
      type: isBilling && isShipping ? 'Billing / Shipping' : isShipping ? 'Shipping' : isBilling ? 'Billing' : 'Other',
      tags: junction.tags || [],
      tagsDisplay: Array.isArray(junction.tags) ? junction.tags.join(', ') : '',
      remarks: junction.remarks || '',
      latitude: addressRecord.latitude ?? null,
      longitude: addressRecord.longitude ?? null,
      isDefaultBilling,
      isDefaultShipping,
      isDefaultAny: isDefaultBilling || isDefaultShipping,
    }
  })
}

/**
 * Populate the Manufacturers table from the supplier↔manufacturer association
 * (same Directus data the list-page drawer shows). Name + Notes come from
 * Directus; the "LT …" invoice metrics have no source yet (not in Directus, not
 * in the current Looker model), so they render blank until a supplier×
 * manufacturer invoice PDT exists.
 */
async function loadManufacturers(partnerRecordId: number | string) {
  const { data, error } = await fetchPartnerManufacturers(partnerRecordId)
  if (error || !data) {
    manufacturers.value = []
    return
  }
  // `id` is the junction row id — the record reorder/status writes target;
  // `manufacturerId` keys the "open manufacturer" link in the frozen column.
  // name / website / logo come from the linked manufacturer; status / remarks /
  // sort come from the junction row.
  const rows = data.map((manufacturer) => ({
    id: manufacturer.id,
    manufacturerId: manufacturer.manufacturerId,
    name: manufacturer.name,
    website: manufacturer.website,
    logoId: manufacturer.logoId,
    status: manufacturer.status,
    remarks: manufacturer.remarks ?? '',
    sort: manufacturer.sortOrder,
    _logoSrc: null as string | null,
    _logoSrcset: null as string | null,
  }))
  // Resolve each manufacturer logo to a responsive thumbnail (56px), the same
  // size the manufacturer page uses for supplier logos.
  await Promise.all(rows.map(async (row) => {
    const responsive = await getResponsiveUrl(row.logoId, 56)
    row._logoSrc = responsive?.src ?? null
    row._logoSrcset = responsive?.srcset ?? null
  }))
  manufacturers.value = rows
}

// Add existing manufacturer(s) to this supplier — the mirror of the manufacturer
// page's "add suppliers" flow: a picker of manufacturers not yet linked, then
// junction rows for whatever was selected, then reload the section.
const addManufacturerDialogVisible = ref(false)
// The picker excludes what's already linked. Rows are junction records, so it's
// `manufacturerId` (the manufacturers row) that identifies a manufacturer here,
// not `id` (the junction row).
const existingManufacturerIds = computed(() =>
  manufacturers.value.map((manufacturer) => manufacturer.manufacturerId).filter(Boolean),
)

function openAddManufacturer() {
  addManufacturerDialogVisible.value = true
}

async function handleAddManufacturers(manufacturerIds: Array<number | string>) {
  if (!partnerId.value || !manufacturerIds.length) { return }
  const startSort = manufacturers.value.length
  const results = await addPartnerManufacturers(partnerId.value, manufacturerIds, startSort)
  if (results.some((entry) => entry.error)) {
    toast.add({ severity: 'error', summary: 'Failed', detail: 'Could not add some manufacturers.', life: 5000 })
  } else {
    // Singular for one, plural for many — no "(s)" brace form.
    const noun = manufacturerIds.length === 1 ? 'Manufacturer' : 'Manufacturers'
    toast.add({ severity: 'success', summary: 'Added', detail: `${noun} added.`, life: 3000 })
  }
  await loadManufacturers(partnerId.value)
}

// Request a manufacturer that isn't in Connect yet — the picker's "Add New
// Manufacturer" button, mirroring the supplier picker on the manufacturer page.
const requestNewManufacturerVisible = ref(false)

function openRequestNewManufacturer() {
  requestNewManufacturerVisible.value = true
}

// "Back" in the request form returns to the manufacturer picker.
function handleBackToManufacturerPicker() {
  addManufacturerDialogVisible.value = true
}

// Persist a drag-reorder of the manufacturers list. Writes manufacturers_sort on
// each moved junction row (the manufacturer's rank within this supplier — a
// different field from the supplier's rank within a manufacturer), then advances
// the local baseline so the next drop diffs against current positions.
async function handleManufacturerReorder(orderedRows: Array<{ id: number | string, currentSort: number | null }>) {
  const { error } = await reorderPartnerManufacturers(orderedRows)
  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Reorder failed',
      detail: 'The manufacturer order could not be saved. Please try again.',
      life: 4000,
    })
    return
  }
  orderedRows.forEach((orderedRow, index) => {
    const row = manufacturers.value.find((manufacturer) => manufacturer.id === orderedRow.id)
    if (row) { row.sort = index }
  })
}

/**
 * Fetch the Directus business-partner record and map it into `supplier`,
 * `rawContacts`, and the address/contact counts. Returns `true` on success.
 * Shared by the full `loadSupplier` and the lighter `reloadPartnerDetails` so
 * both stay in sync without duplicating the mapping.
 */
async function loadPartnerRecord(routeKey: string, silent: boolean): Promise<boolean> {
  // Resolve by Directus id (the canonical key) or, for legacy/bookmarked links
  // and pre-SAP-sync records, by SAP id. A by-id 404 is treated as "not found"
  // (null) rather than a hard error so the not-found copy shows.
  let partnerData: any = null
  let error: { message: string } | null = null
  if (SAP_ID_PATTERN.test(routeKey)) {
    ({ data: partnerData, error } = await fetchBusinessPartnerByAccountNumber(routeKey))
  } else {
    const result = await fetchBusinessPartner(Number(routeKey))
    partnerData = result.error ? null : result.data
    error = result.error && isServerError(result.error) ? result.error : null
  }

  if (error) {
    if (!silent) {
      if (isServerError(error)) {
        hasLoadError.value = true
      } else {
        loadError.value = 'Failed to load supplier. Please try again.'
      }
      isLoading.value = false
    }
    return false
  }

  if (!partnerData) {
    if (!silent) {
      loadError.value = `Supplier "${route.params.id}" not found.`
      isLoading.value = false
    }
    return false
  }

  logoId.value = partnerData.logo_id || null
  partnerId.value = partnerData.id
  loadManufacturers(partnerData.id)
  loadActivities()
  loadActivityGroups()
  defaultBillingAddressJunctionId.value = normalizeJunctionId(
    partnerData.default_billing_business_partners_addresses_id,
  )
  defaultShippingAddressJunctionId.value = normalizeJunctionId(
    partnerData.default_shipping_business_partners_addresses_id,
  )
  defaultSalesContactJunctionId.value = normalizeJunctionId(
    (partnerData as any).default_sales_business_partners_contacts_id,
  )
  defaultBillingContactJunctionId.value = normalizeJunctionId(
    (partnerData as any).default_billing_business_partners_contacts_id,
  )

  supplier.name = partnerData.name || ''
  supplier.website = partnerData.website || ''
  supplier.remarks = partnerData.remarks || ''
  supplier.sapId = partnerData.account_number || ''
  supplier.status = partnerData.status || ''
  const partnerGroup = (partnerData.business_partner_groups_id as any)
  supplier.groupName = partnerGroup?.name || ''

  const partnerRecord = partnerData as any
  accountInfo.account = partnerData.account_number || ''
  accountInfo.accountNumber = partnerData.account_number || ''
  accountInfo.companyName = partnerData.name || ''
  accountInfo.status = partnerData.status || ''
  accountInfo.website = partnerData.website || ''
  accountInfo.customerGroupId = partnerGroup?.id || null
  accountInfo.customerGroup = partnerGroup?.name || ''

  const accountManager = partnerRecord.account_manager_id
  accountManagerId.value = accountManager?.id ?? null
  accountInfo.accountManagerId = accountManager?.id ?? null
  accountInfo.accountRep = accountManager
    ? `${accountManager.first_name ?? ''} ${accountManager.last_name ?? ''}`.trim() || '—'
    : '—'

  const salesContact = partnerRecord.default_sales_business_partners_contacts_id?.contacts_id
  accountInfo.primaryContactName = formatContactName(salesContact)
  accountInfo.primaryContactTitle = salesContact?.job_title || ''
  accountInfo.primaryContactEmail = salesContact?.email_address || ''
  defaultSalesContactJunctionId.value = partnerRecord.default_sales_business_partners_contacts_id?.id ?? null

  const billingContact = partnerRecord.default_billing_business_partners_contacts_id?.contacts_id
  accountInfo.billingContactName = formatContactName(billingContact)
  accountInfo.billingContactTitle = billingContact?.job_title || ''
  accountInfo.billingContactEmail = billingContact?.email_address || ''
  defaultBillingContactJunctionId.value = partnerRecord.default_billing_business_partners_contacts_id?.id ?? null

  const partnerPhones = partnerData.phone_numbers || []
  const primaryPartnerPhone = partnerPhones.find(
    (junction: any) => (junction.phone_numbers_id as any)?.type === 'general',
  ) || partnerPhones[0]
  accountInfo.companyPhone = primaryPartnerPhone
    ? formatPhoneNumber(primaryPartnerPhone.phone_numbers_id as any)
    : '—'
  partnerPhoneNumbers.value = mapPhoneNumbers(partnerPhones)

  // Default parcel/LTL shipping carriers + their account numbers (panel display).
  const parcelAccount = partnerRecord.default_parcel_business_partners_shipping_accounts_id?.shipping_accounts_id
  accountInfo.defaultParcelCarrier = parcelAccount?.shipping_carriers_id?.name || '—'
  accountInfo.parcelAccountNumber = parcelAccount?.account_number || '—'
  const ltlAccount = partnerRecord.default_ltl_business_partners_shipping_accounts_id?.shipping_accounts_id
  accountInfo.defaultLtlCarrier = ltlAccount?.shipping_carriers_id?.name || '—'
  accountInfo.ltlAccountNumber = ltlAccount?.account_number || '—'

  defaultParcelShippingJunctionId.value = partnerRecord.default_parcel_business_partners_shipping_accounts_id?.id ?? null
  defaultLtlShippingJunctionId.value = partnerRecord.default_ltl_business_partners_shipping_accounts_id?.id ?? null
  shippingAccounts.value = (partnerRecord.business_partners_shipping_accounts || []).map(
    (junction: any) => mapShippingAccount(junction, defaultParcelShippingJunctionId.value, defaultLtlShippingJunctionId.value),
  )

  rawContacts.value = partnerData.contacts ?? []
  contactCount.value = rawContacts.value.length
  addressCount.value = partnerData.addresses?.length ?? 0
  addresses.value = mapAddresses(partnerData.addresses)

  return true
}

async function loadSupplier(options = {}) {
  const { silent = false } = options as { silent?: boolean }

  if (!route.params.id) {
    navigateTo('/suppliers')
    return
  }

  if (!silent) {
    isLoading.value = true
    hasLoadError.value = false
    loadError.value = null
  }

  const routeKey = String(route.params.id)
  const isSapRoute = SAP_ID_PATTERN.test(routeKey)

  // For a SAP-id route we already know the card code, so fire the PDT-backed
  // calls in parallel with the Directus fetch — dodging the browser's per-origin
  // connection cap so they don't queue. A Directus-id route can't: its SAP id
  // (if any) only comes back with the partner record.
  if (isSapRoute) {
    isPerformanceLoading.value = true
    isChartLoading.value = true
    chartBars.value = []
    loadSupplierPerformance(routeKey)
    loadSupplierQuarterlyChart(routeKey)
  }

  const partnerLoaded = await loadPartnerRecord(routeKey, silent)
  if (!partnerLoaded) {
    return
  }

  if (!silent) {
    isLoading.value = false
  }

  // Reset per-load SAP-sync state so a stale failure/reason from a
  // previously-viewed supplier never bleeds into this one — the detail page
  // component is reused across :id changes.
  isSapSyncFailed.value = false
  sapSyncError.value = null
  sapSyncToasted = false
  expectsFreshSync = false

  if (supplier.sapId) {
    stopSapIdWatch()
    // A Directus-id route to an already-synced supplier didn't pre-fire above.
    if (!isSapRoute) {
      loadSupplierPerformance(supplier.sapId)
      loadSupplierQuarterlyChart(supplier.sapId)
    }
    isPurchaseOrdersLoading.value = true
    loadSupplierPurchaseOrders(supplier.sapId)
  } else {
    // Awaiting SAP id: keep the performance stats + chart in their loading
    // skeletons so the layout is reserved and doesn't shuffle when the data
    // arrives over the socket. Purchase orders settle to empty (none yet).
    isPerformanceLoading.value = true
    isChartLoading.value = true
    chartBars.value = []
    allPurchaseOrders.value = []
    purchaseOrders.value = []
    isPurchaseOrdersLoading.value = false
    if (import.meta.client && partnerId.value !== null) {
      // A sync only fires at CREATE time. If we just created this record, keep the
      // "syncing" state and reserved skeletons and expect a live outcome. On a
      // plain reopen nothing is syncing, so show the not-synced/failed state (with
      // Retry) immediately — we still subscribe so a genuinely in-flight sync can
      // recover it.
      expectsFreshSync = useJustCreatedPartner().consumeJustCreated(partnerId.value)
      if (!expectsFreshSync) {
        markSapSyncFailed(null, { silent: true })
      }
      watchForSapId(partnerId.value)
    }
  }
}

// --- SAP-id sync watch (Service Master) ---
// A freshly-created supplier has no `account_number` until the Service Master worker
// syncs it to SAP. The browser consumes the worker's status over the SSE relay
// (useSapSyncSocket → /api/sap-sync/events) and reacts to the sync job:
//   success → stamp the SAP id + load the SAP-backed sections
//   failed/retrying/cancelled → toast + failed state
//   queued/processing → keep the spinner + loading skeletons
let sapSyncUnsubscribe: (() => void) | null = null
// Toast the failure once per attempt-cycle (a retry loop emits multiple
// failed/retrying transitions); reset on success.
let sapSyncToasted = false
// True while we're watching a sync we KNOW is firing (a fresh create or a manual
// retry). A silence/deadline timeout on such a record is a real problem worth
// surfacing loudly; on a plain reopen it isn't (see markSapSyncFailed).
let expectsFreshSync = false

// Safety net for a record whose sync job the worker no longer tracks (e.g. it
// failed in a past session): reopening it gets NO status over the socket, which
// would otherwise spin "syncing" forever. If no status arrives within this
// window, settle out of the spinner. An actively-tracked sync replays its status
// within a second or two, well inside this window, and re-arms on every
// queued/processing tick.
const SAP_SYNC_SILENCE_MS = 15000
let sapSyncSilenceTimer: ReturnType<typeof setTimeout> | null = null
// Absolute backstop: the silence timer re-arms on every queued/processing tick,
// so a job that keeps emitting heartbeats without ever finishing could still spin
// forever. This fires ONCE from the start of a watch (never re-armed) to
// guarantee we always settle within a bounded wait.
const SAP_SYNC_DEADLINE_MS = 60000
let sapSyncDeadlineTimer: ReturnType<typeof setTimeout> | null = null

function clearSapSyncSilenceTimer() {
  if (sapSyncSilenceTimer) {
    clearTimeout(sapSyncSilenceTimer)
    sapSyncSilenceTimer = null
  }
}

function clearSapSyncDeadlineTimer() {
  if (sapSyncDeadlineTimer) {
    clearTimeout(sapSyncDeadlineTimer)
    sapSyncDeadlineTimer = null
  }
}

function armSapSyncSilenceTimer() {
  clearSapSyncSilenceTimer()
  sapSyncSilenceTimer = setTimeout(() => {
    if (supplier.sapId) { return }
    // A sync we expected to hear about went quiet → confirm the outcome and
    // surface a reason. A plain reopen (no expected sync) settles quietly.
    if (expectsFreshSync) { settleSapSyncUnconfirmed() }
    else { markSapSyncFailed(null, { silent: true }) }
  }, SAP_SYNC_SILENCE_MS)
}

function armSapSyncDeadlineTimer() {
  clearSapSyncDeadlineTimer()
  sapSyncDeadlineTimer = setTimeout(() => {
    if (!supplier.sapId) { settleSapSyncUnconfirmed() }
  }, SAP_SYNC_DEADLINE_MS)
}

// The realtime channel never delivered a terminal status for a sync we know
// fired. Before giving up, re-read the record: the SAP id may have landed while
// the socket was dropped (recover silently), or the Directus sync flow may have
// stamped a reason for why it couldn't enqueue (surface it — e.g. a licence
// rejection). Otherwise fall back to a clear, actionable "unconfirmed" message.
async function settleSapSyncUnconfirmed() {
  clearSapSyncSilenceTimer()
  clearSapSyncDeadlineTimer()
  if (supplier.sapId || partnerId.value == null) { return }

  const { data: syncState } = await fetchPartnerSyncState(partnerId.value)
  if (supplier.sapId) { return }
  if (syncState?.account_number) {
    applySyncedSapId(syncState.account_number)
    return
  }
  markSapSyncFailed(syncState?.sync_error || null, { unconfirmed: true })
}

function stopSapIdWatch() {
  clearSapSyncSilenceTimer()
  clearSapSyncDeadlineTimer()
  if (sapSyncUnsubscribe) {
    sapSyncUnsubscribe()
    sapSyncUnsubscribe = null
  }
}

// Kick off the SAP-backed sections (performance, chart, purchase orders) for a
// given SAP card code. Shared by the synced-in path and the socket success.
function loadSapBackedSections(cardCode: string) {
  isPerformanceLoading.value = true
  isChartLoading.value = true
  chartBars.value = []
  loadSupplierPerformance(cardCode)
  loadSupplierQuarterlyChart(cardCode)
  isPurchaseOrdersLoading.value = true
  loadSupplierPurchaseOrders(cardCode)
}

// Human-readable sync time for the "Synced <when>" tooltip, e.g.
// "June 29, 2026 at 1:52 PM".
function formatSyncedAt(date: Date): string {
  const datePart = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${datePart} at ${timePart}`
}

// Apply a synced SAP id once: stamp it, surface the "Synced" indicator, load the
// SAP-backed sections, and stop watching. Returns true when it took effect.
function applySyncedSapId(syncedSapId: unknown): boolean {
  if (!syncedSapId || supplier.sapId) {
    return false
  }
  isSapSyncFailed.value = false
  sapSyncError.value = null
  sapSyncToasted = false
  supplier.sapId = String(syncedSapId)
  accountInfo.account = String(syncedSapId)
  accountInfo.accountNumber = String(syncedSapId)
  sapSyncedAt.value = formatSyncedAt(new Date())
  loadSapBackedSections(supplier.sapId)
  stopSapIdWatch()
  return true
}

// Sync failed / unconfirmed: record the reason (kept visible in the failed
// indicator's tooltip), toast once, drop the spinner, and settle the SAP-backed
// stats/chart skeletons (no perpetual skeleton). The socket stays subscribed so
// a later retry that succeeds still recovers the data.
//   - failed      → SAP (or the flow) reported an error. Severity: error.
//   - unconfirmed → we timed out waiting for any outcome. Severity: warn; the
//     copy points at the likely upstream causes (service down / no SAP licence).
function markSapSyncFailed(error?: string | null, options: { silent?: boolean, unconfirmed?: boolean } = {}) {
  clearSapSyncSilenceTimer()
  clearSapSyncDeadlineTimer()
  const messages = getSapSyncMessages('supplier')
  const detail = error || (options.unconfirmed ? messages.unconfirmed : messages.failed)
  sapSyncError.value = detail
  if (!options.silent && !sapSyncToasted) {
    toast.add({
      severity: options.unconfirmed ? 'warn' : 'error',
      summary: options.unconfirmed ? 'SAP sync unconfirmed' : 'SAP sync failed',
      detail,
      life: 8000,
    })
    sapSyncToasted = true
  }
  isSapSyncFailed.value = true
  sapSyncedAt.value = null
  isPerformanceLoading.value = false
  isChartLoading.value = false
}

// "Retry Sync" — re-fire the Directus → Service Master sync by touching the
// partner record, then drop back into the syncing state. The SSE subscription
// stays open through a failure, so it picks up the new outcome.
async function retrySapSync() {
  if (partnerId.value == null) {
    return
  }
  isSapSyncFailed.value = false
  sapSyncError.value = null
  sapSyncToasted = false
  sapSyncedAt.value = null
  // A manual retry is a sync we expect to hear back on — arm the loud timeout
  // path (and the deadline backstop) via watchForSapId below.
  expectsFreshSync = true
  isPerformanceLoading.value = true
  isChartLoading.value = true
  await updateBusinessPartner(partnerId.value, { name: supplier.name })
  watchForSapId(partnerId.value)
}

function handleSapSyncUpdate(update: { status?: string, sapId?: string | null, error?: string | null }) {
  if (update.status === 'success' && update.sapId) {
    applySyncedSapId(update.sapId)
    return
  }
  if (update.status === 'failed' || update.status === 'retrying' || update.status === 'cancelled') {
    markSapSyncFailed(update.error)
    return
  }
  // queued / processing → still syncing → spinner + loading skeletons. But once
  // this sync cycle has already failed/retried, DON'T bounce back to the spinner
  // for each of the (up to 6) retry attempts — keep the error visible; a later
  // `success` transition clears it automatically (the stream stays subscribed).
  // A manual Retry Sync clears isSapSyncFailed first, so it still shows a spinner.
  if (isSapSyncFailed.value) { return }
  isPerformanceLoading.value = true
  isChartLoading.value = true
  armSapSyncSilenceTimer()
}

// Watch the partner's SAP sync job via the Service Master SSE relay (Nitro holds
// the CF-Access'd upstream WebSocket; the browser consumes the relayed status over
// an EventSource). The stream auto-reconnects and replays the last known status on
// (re)subscribe.
function watchForSapId(targetPartnerId: number) {
  stopSapIdWatch()
  // Arm before subscribing so a synchronous status replay can clear/re-arm it.
  armSapSyncSilenceTimer()
  // Only a sync we expect an outcome for (fresh create / manual retry) gets the
  // absolute deadline — a plain reopen already settled to its failed state and
  // shouldn't nag with a timeout toast.
  if (expectsFreshSync) { armSapSyncDeadlineTimer() }
  sapSyncUnsubscribe = subscribeSapSync(targetPartnerId, handleSapSyncUpdate)
}

onUnmounted(stopSapIdWatch)

/**
 * Refetch ONLY the Directus business-partner record (company info, contacts,
 * addresses) after a partner-level edit — contact, address, or account info.
 * Deliberately does NOT touch the Looker-backed purchase orders, performance
 * metrics, or chart: none of those change when editing partner data, so a full
 * `loadSupplier` would refire every Looker request for nothing.
 */
async function reloadPartnerDetails() {
  if (!route.params.id) {
    return
  }
  await loadPartnerRecord(String(route.params.id), true)
}

// Every edit re-syncs the whole partner to SAP. Reload as before, and — for an
// already-synced supplier (the initial create-sync owns the first one) — watch
// that follow-up sync and toast only if it fails. Success stays silent.
const { watchPartnerSyncFailure } = useSapSyncFailureWatch()

function handleEditSaved() {
  reloadPartnerDetails()
  if (supplier.sapId) {
    watchPartnerSyncFailure(partnerId.value, 'supplier')
  }
}

function normalizeJunctionId(value: unknown): number | null {
  if (typeof value === 'number') {
    return value
  }
  if (value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
    const nestedId = (value as { id?: unknown }).id
    return typeof nestedId === 'number' ? nestedId : null
  }
  return null
}

async function loadSupplierPerformance(cardCode: string) {
  const { data: performance, error } = await fetchSupplierPerformance(cardCode)

  if (error) {
    console.error('Failed to load supplier performance:', error.message)
    isPerformanceLoading.value = false
    return
  }

  supplier.lifetimePurchaseOrderCount = performance.lifetimePoCount
  supplier.lifetimePurchaseOrderDollars = formatCurrency(performance.lifetimePoDollars)
  supplier.openPurchaseOrderCount = performance.openPoCount
  supplier.openPurchaseOrderDollars = formatCurrency(performance.openPoDollars)
  supplier.accountBalance = formatCurrency(performance.accountBalance)
  supplier.creditLimit = formatCurrency(performance.creditLimit)
  isPerformanceLoading.value = false
}

function mapPurchaseOrderRow(order: { id: number; orderNumber: number; docEntry: string | number | null; status: string; createdOn: string; promiseShipBy: string | null; documentTotal: number; requestedBy: string | null }) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    docEntry: order.docEntry,
    status: order.status,
    created_on: order.createdOn,
    promise_ship_by: order.promiseShipBy,
    document_total: formatCurrency(order.documentTotal),
    document_total_raw: order.documentTotal,
    requested_by: order.requestedBy ?? '',
  }
}

/** Renders the first `rowCount` rows of the already-loaded set — no request. */
function showPurchaseOrders(rowCount: number) {
  purchaseOrders.value = allPurchaseOrders.value.slice(0, rowCount)
  hasMorePurchaseOrders.value = purchaseOrders.value.length < allPurchaseOrders.value.length
  purchaseOrdersAllLoaded.value = !hasMorePurchaseOrders.value
}

// One Looker round-trip: the endpoint hands back dashboard 170's whole tile,
// which it fetches unpaged regardless. Every page below is served from that set.
async function loadSupplierPurchaseOrders(cardCode: string) {
  isPurchaseOrdersLoading.value = true
  purchaseOrdersAllLoaded.value = false

  const { data: orders, error } = await fetchSupplierPurchaseOrders(cardCode)

  if (error) {
    console.error('Failed to load supplier purchase orders:', error.message)
    allPurchaseOrders.value = []
    purchaseOrders.value = []
    hasMorePurchaseOrders.value = false
    isPurchaseOrdersLoading.value = false
    return
  }

  allPurchaseOrders.value = (Array.isArray(orders) ? orders : []).map(mapPurchaseOrderRow)
  showPurchaseOrders(PURCHASE_ORDERS_PAGE_SIZE)
  isPurchaseOrdersLoading.value = false
}

function loadMoreSupplierPurchaseOrders() {
  if (!hasMorePurchaseOrders.value || isPurchaseOrdersLoading.value) { return }
  showPurchaseOrders(purchaseOrders.value.length + PURCHASE_ORDERS_PAGE_SIZE)
}

function loadAllSupplierPurchaseOrders() {
  if (purchaseOrdersAllLoaded.value || isPurchaseOrdersLoading.value) { return }
  showPurchaseOrders(allPurchaseOrders.value.length)
}

// Nav tabs with live counts
const navTabs = computed(() => [
  {
    label: `Purchase Orders (${supplier.lifetimePurchaseOrderCount.toLocaleString()})`,
    icon: 'ms:order_approve',
    sectionId: 'purchase-orders',
  },
  {
    label: `Manufacturers (${manufacturers.value.length})`,
    icon: 'ms:precision_manufacturing',
    sectionId: 'manufacturers',
  },
  {
    label: `Contacts (${contactCount.value})`,
    icon: 'pi pi-user',
    sectionId: 'contacts',
  },
  { label: `Activities (${activityCount.value.toLocaleString()})`, icon: 'ms:checklist', sectionId: 'activities' },
  {
    label: `Addresses (${addressCount.value})`,
    icon: 'pi pi-map',
    sectionId: 'addresses',
  },
])

const accountNoteDrawerVisible = ref(false)
function openAccountNoteDrawer() {
  accountNoteDrawerVisible.value = true
}

// Loads the supplier and points the Next/Prev navigation at it. The nav
// store decides whether this is a fresh entry (rebuild + reset the detail
// filter) or a Next/Prev step (preserve the detail filter).
function handleSupplierRoute() {
  navStore.enterSupplier(String(route.params.id))
  loadSupplier()
}

// The page transition re-creates this component on every Next/Prev, so
// `onMounted` covers in-detail navigation; the route watch covers the case
// where the component is reused instead.
watch(() => route.params.id, handleSupplierRoute)
onMounted(handleSupplierRoute)

// Surface navigation fetch failures as a toast. The nonce re-fires the
// watcher even when consecutive failures carry the same message.
watch(
  () => navStore.navErrorNonce,
  () => {
    toast.add({
      severity: 'error',
      summary: 'Supplier navigation',
      detail: navStore.navErrorMessage ?? 'Something went wrong.',
      life: 4000,
    })
  },
)
</script>

<template>
  <div class="supplier-page">
    <BaseLoader v-if="showLoader" overlay label="Loading supplier…" />

    <!-- Top toolbar — back link + filter / next-prev CTAs -->
    <div v-if="!hasLoadError" class="supplier-page__top">
      <BaseBackButton to="/suppliers" label="Back to Suppliers" class="supplier-back" />
      <SuppliersToolbar :show-navigation="true" />
    </div>

    <Error500 v-if="hasLoadError" />

    <Message v-if="loadError" severity="error" :closable="false">
      {{ loadError }}
    </Message>

    <div v-if="!isLoading && !hasLoadError && !loadError" class="supplier-page__content">
      <ProfileCard :tabs="navTabs" :chart-bars="chartBars" :looker-url="lookerUrl" :is-chart-loading="isChartLoading"
        booked-sales-label="Spend" order-count-label="PO Count">
        <template #avatar>
          <input ref="logoFileInputRef" type="file" accept="image/* " class="visually-hidden"
            @change="handleLogoSelect">
          <div class="supplier-avatar"> <img v-if="logoSrc" :src="logoSrc" :srcset="logoSrcset"
              sizes="(min-width: 768px) 150px, 120px" alt="Company logo" class="supplier-avatar__image" width="150"
              height="150" loading="lazy" @error="logoId = null" /> <BasePlaceholderIcon v-else
              category="supplier" class="placeholder-avatar__icon" />
            <div v-if="isLogoProcessing" class="supplier-avatar__processing">
              <BaseSpinner size="md" />
            </div>
          </div>
          <div v-if="!isLogoProcessing" class="supplier-avatar__actions">
            <BaseAvatarEditMenu :has-image="!!logoSrc" @upload="triggerLogoUpload" @delete="handleLogoRemove" />
          </div>
        </template>
        <template #header-left>
          <div class="supplier-profile__header-left">
            <Tag v-if="!isAwaitingSapId && !isSapSyncFailed"
              :value="supplier.status === 'active' ? 'Active' : 'Inactive'"
              :class="supplier.status === 'active' ? 'status-active' : 'status-inactive'" />
            <SapSyncFailedIndicator v-if="isSapSyncFailed" subject="supplier"
              size="lg" :tooltip="sapSyncError || ''" @retry="retrySapSync" />
            <SapSyncingIndicator v-else-if="isAwaitingSapId" size="lg" />
            <BaseCopyText v-else :value="supplier.sapId" :to="`/suppliers/${supplier.sapId}`" icon-position="right" />
          </div>
        </template>
        <template #header-right> <Button link class="supplier-profile__notes-btn" @click="openAccountNoteDrawer"> <i
              v-if="!supplier.remarks" class="pi pi-plus"
              style="margin-right: var(--p-spacing-1); font-size: var(--p-font-size-xs);" /> <span
              class="supplier-profile__notes-label-mobile">Notes</span> <span class="supplier-profile__notes-label"> {{
                supplier.remarks ? 'Supplier Notes' : 'Add Supplier Notes' }} </span> <i v-if="supplier.remarks"
              class="pi pi-ellipsis-h" style="margin-left: var(--p-spacing-1); font-size: var(--p-font-size-xs);" />
          </Button> </template>
        <template #identity>
          <div class="supplier-profile__name-row"> <span class="supplier-profile__name">{{ supplier.name }}</span>
            <BaseWebsiteLink :website="supplier.website" :name="supplier.name" />
          </div>
          <div class="supplier-profile__chips">
            <Tag v-if="supplier.groupName" :value="supplier.groupName" rounded severity="secondary" />
          </div>
        </template>
      </ProfileCard> <!-- Statistics row -->
      <div class="stats-row"> <!-- PO Stats -->
        <div class="stats-card">
          <div class="stats-grid">
            <div class="stat">
              <span class="stat-label">Lifetime PO Count</span>
              <span v-if="isPerformanceLoading" class="skeleton-block skeleton-line skeleton-line--value" />
              <div v-else class="stat-value-row">
                <span class="stat-value">{{ supplier.lifetimePurchaseOrderCount.toLocaleString() }}</span>
                <BaseLookerLink v-if="purchaseOrdersLifetimeLookerUrl" :url="purchaseOrdersLifetimeLookerUrl" icon-only />
              </div>
            </div>
            <div class="stat">
              <span class="stat-label">Lifetime PO Dollars</span>
              <span v-if="isPerformanceLoading" class="skeleton-block skeleton-line skeleton-line--value" />
              <div v-else class="stat-value-row">
                <span class="stat-value">{{ supplier.lifetimePurchaseOrderDollars }}</span>
                <BaseLookerLink v-if="purchaseOrdersLifetimeLookerUrl" :url="purchaseOrdersLifetimeLookerUrl" icon-only />
              </div>
            </div>
            <div class="stat">
              <span class="stat-label">Open PO Count</span>
              <span v-if="isPerformanceLoading" class="skeleton-block skeleton-line skeleton-line--value" />
              <div v-else class="stat-value-row">
                <span class="stat-value">{{ supplier.openPurchaseOrderCount.toLocaleString() }}</span>
                <BaseLookerLink v-if="purchaseOrdersOpenLookerUrl" :url="purchaseOrdersOpenLookerUrl" icon-only />
              </div>
            </div>
            <div class="stat">
              <span class="stat-label">Open PO Dollars</span>
              <span v-if="isPerformanceLoading" class="skeleton-block skeleton-line skeleton-line--value" />
              <div v-else class="stat-value-row">
                <span class="stat-value">{{ supplier.openPurchaseOrderDollars }}</span>
                <BaseLookerLink v-if="purchaseOrdersOpenLookerUrl" :url="purchaseOrdersOpenLookerUrl" icon-only />
              </div>
            </div>
          </div>
        </div> <!-- Financial Stats -->
        <div class="stats-card">
          <div class="stats-grid">
            <div class="stat"> <span class="stat-label">Account Balance</span> <span v-if="isPerformanceLoading"
                class="skeleton-block skeleton-line skeleton-line--value" /> <span v-else class="stat-value">{{
                  supplier.accountBalance }}</span> </div>
            <div class="stat"> <span class="stat-label">Payment Terms</span> <span v-if="isPerformanceLoading"
                class="skeleton-block skeleton-line skeleton-line--value" /> <span v-else class="stat-value">{{
                  supplier.paymentTerms }}</span> </div>
            <div class="stat"> <span class="stat-label">Credit Limit</span> <span v-if="isPerformanceLoading"
                class="skeleton-block skeleton-line skeleton-line--value" /> <span v-else class="stat-value">{{
                  supplier.creditLimit }}</span> </div>
            <div class="stat"> <span class="stat-label">Account Standing</span> <span v-if="isPerformanceLoading"
                class="skeleton-block skeleton-line skeleton-line--value" /> <span v-else-if="supplier.accountStanding"
                class="stat-value standing-good"> <i class="pi pi-check-circle" />{{ supplier.accountStanding }} </span>
            </div>
          </div>
        </div>
      </div> <!-- Account Information -->
      <CustomerAccountInfoPanel
        :customer="accountInfo"
        :is-supplier="true"
        :awaiting-sap-id="isAwaitingSapId"
        :sap-sync-failed="isSapSyncFailed"
        :sap-sync-error="sapSyncError"
        @edit="openEditAccountInfo"
        @retry-sap-sync="retrySapSync"
      />
      <!-- Purchase Orders -->
      <SectionPurchaseOrders :purchase-orders="purchaseOrders" :total-count="supplier.lifetimePurchaseOrderCount"
        :collapsed="!supplier.lifetimePurchaseOrderCount" :loading="isPurchaseOrdersLoading"
        :has-more="hasMorePurchaseOrders" :is-loading-more="false"
        :looker-url="purchaseOrdersLookerUrl" @scroll-near-bottom="loadMoreSupplierPurchaseOrders"
        @load-all="loadAllSupplierPurchaseOrders" />
      <!-- Manufacturers -->
      <SectionManufacturers :manufacturers="manufacturers" :collapsed="!manufacturers.length"
        @reorder="handleManufacturerReorder" @add="openAddManufacturer" /> <!-- Contacts -->
      <SectionContacts :collapsed="!contactCount" :business-partner-id="partnerId" :addresses="addresses"
        :map-contacts="mapContacts"
        :initial-contacts="rawContacts" :default-sales-contact-junction-id="defaultSalesContactJunctionId"
        :default-billing-contact-junction-id="defaultBillingContactJunctionId" @update:count="contactCount = $event"
        @saved="handleEditSaved" /> <!-- Activities -->
      <SectionActivities
        :activities="activities"
        :contacts="mappedContacts"
        :activity-groups="activityGroups"
        :business-partner-id="partnerId"
        :account-manager-id="accountManagerId"
        :account-manager-name="accountInfo.accountRep"
        :loading="isActivitiesLoading"
        :total-count="activityCount"
        :has-more="hasMoreActivities"
        :is-loading-more="isActivitiesLoadingMore"
        :collapsed="!activities.length"
        @saved="reloadActivities"
        @scroll-near-bottom="loadMoreActivities"
        @load-all="loadAllActivities"
      /> <!-- Addresses -->
      <SectionAddresses :collapsed="!addressCount" :business-partner-id="partnerId" :map-addresses="mapAddresses"
        :business-partner-name="supplier.name"
        :default-billing-junction-id="defaultBillingAddressJunctionId"
        :default-shipping-junction-id="defaultShippingAddressJunctionId" :is-supplier="true"
        @update:count="addressCount = $event" @saved="handleEditSaved" />
    </div> <!-- Drawers -->
    <DrawerAccountInfo v-model:visible="accountInfoDrawerVisible" :customer="accountInfo"
      :business-partner-id="partnerId" relationship-type="supplier" :shipping-accounts="shippingAccounts"
      :default-parcel-junction-id="defaultParcelShippingJunctionId"
      :default-ltl-junction-id="defaultLtlShippingJunctionId" :addresses="addresses" :contacts="mappedContacts"
      :phone-numbers="partnerPhoneNumbers" :default-shipping-address-junction-id="defaultShippingAddressJunctionId"
      :default-billing-address-junction-id="defaultBillingAddressJunctionId"
      :default-sales-contact-junction-id="defaultSalesContactJunctionId"
      :default-billing-contact-junction-id="defaultBillingContactJunctionId" @saved="handleEditSaved" />
    <DrawerAccountNote v-model:visible="accountNoteDrawerVisible" context="Supplier"
      :account-code="supplier.sapId || supplier.name" :remarks="supplier.remarks" :business-partner-id="partnerId"
      @saved="handleEditSaved" />
    <DrawerAddManufacturerAssociation v-model:visible="addManufacturerDialogVisible" mode="manufacturers"
      :existing-ids="existingManufacturerIds" :entity-name="supplier.name" @save="handleAddManufacturers"
      @add-new="openRequestNewManufacturer" />
    <DrawerRequestNewCompany v-model:visible="requestNewManufacturerVisible" mode="manufacturer"
      back-to="Manufacturers" :business-partner-id="partnerId" @back="handleBackToManufacturerPicker" />
    <PageScrollTop />
  </div>
</template>
<style scoped>
 /* Skeleton placeholders — share .skeleton-block animation */
 :deep(.skeleton-line) {
   display: inline-block;
   height: var(--p-font-size-sm);
   border-radius: 0;
 }

 :deep(.skeleton-line--value) {
   width: 35%;
   min-width: var(--p-spacing-10);
   height: var(--p-font-size-sm);
   animation: skeleton-pulse var(--p-undertow-duration) ease-in-out infinite;
 }

 .supplier-page {
   display: flex;
   flex-direction: column;
   gap: var(--p-spacing-3);
   padding: 0;

   @media (min-width: 768px) {
     gap: var(--p-spacing-4);
   }
 }

 /* Top toolbar — back link + filter / next-prev CTAs */
 .supplier-page__top {
   display: flex;
   align-items: center;
   justify-content: space-between;
   gap: var(--p-spacing-3);
 }

 .supplier-page__top>.suppliers-toolbar {
   margin-left: auto;
 }

 .supplier-page__content {
   display: flex;
   flex-direction: column;
   gap: var(--p-spacing-3);
   margin-top: calc(-1 * var(--p-spacing-8));

   @media (min-width: 768px) {
     display: contents;
   }
 }

 /* Supplier avatar (ProfileCard #avatar slot) */
 .supplier-avatar {
   position: relative;
   width: 100%;
   height: 100%;
   border-radius: 50%;
   background: var(--p-surface-0);
   border: var(--p-spacing-1) solid var(--p-surface-100);
   display: flex;
   align-items: center;
   justify-content: center;
   overflow: hidden;
 }

 .supplier-avatar__image {
   width: 100%;
   height: 100%;
   object-fit: cover;
   border-radius: 50%;
 }

 .supplier-avatar__actions {
   position: absolute;
   top: 15%;
   left: 85%;
   transform: translate(-50%, -50%);
   z-index: 2;
   display: flex;
   gap: var(--p-spacing-1);
 }

 .supplier-avatar__actions--hover-only {
   top: var(--p-spacing-2);
   left: auto;
   right: var(--p-spacing-2);
   transform: none;
   opacity: 1;
   transition: opacity var(--p-transition-duration);
 }

 :deep(.supplier-avatar__actions .p-button) {
   background: var(--p-surface-0);
 }

 .supplier-avatar__processing {
   position: absolute;
   inset: 0;
   border-radius: 50%;
   background: rgba(255, 255, 255, 0.7);
   display: flex;
   align-items: center;
   justify-content: center;
 }

 /* Supplier profile header (ProfileCard #header-right slot) */
 :deep(.supplier-profile__notes-btn.p-button-link) {
   font-size: var(--p-font-size-xs);
   color: var(--p-primary-500);
   padding: 0 var(--p-spacing-1) 0 0;
   gap: var(--p-spacing-1);
   border-radius: var(--p-border-radius-xs);
   transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);

   @media (min-width: 768px) {
     min-height: var(--p-spacing-8);
     padding: var(--p-spacing-1) var(--p-spacing-3);
   }
 }

 :deep(.supplier-profile__notes-btn.p-button-link:hover),
 :deep(.supplier-profile__notes-btn.p-button-link:focus-visible) {
   background: var(--p-tideblue-50);
   color: var(--p-primary-500);
 }

 .supplier-profile__notes-label {
   display: none;
   white-space: nowrap;

   @container (min-width: 440px) {
     display: inline-flex;
   }
 }

 .supplier-profile__notes-label-mobile {
   font-size: var(--p-font-size-xs);

   @container (min-width: 440px) {
     display: none;
   }
 }

 /* Supplier profile header (ProfileCard #header-left slot) */
 .supplier-profile__header-left {
   display: flex;
   flex-direction: row;
   flex-wrap: wrap;
   align-items: center;
   max-width: 100%;
   min-width: 0;
   row-gap: var(--p-spacing-1);

   @media (min-width: 768px) {
     max-width: none;
     min-width: auto;
     gap: var(--p-spacing-3);
   }
 }

 :deep(.supplier-profile__header-left .base-copy-text__link) {
   font-family: var(--p-mono-family);
   font-size: var(--p-font-size-xs);
 }

 /* Supplier profile identity (ProfileCard #identity slot) */
 .supplier-profile__name-row {
   display: flex;
   align-items: center;
   gap: var(--p-spacing-1);
   margin-top: 0;
   justify-content: center;
   text-align: center;

   @media (min-width: 768px) {
     justify-content: flex-start;
     text-align: left;
   }
 }

 .supplier-profile__name {
   font-size: var(--p-font-size-base);
   font-weight: var(--p-font-weight-bold);
   color: var(--p-deepblue-900);
   background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);
   padding: var(--p-spacing-0) var(--p-spacing-3);
   border-radius: var(--p-border-radius-full);

   @media (min-width: 768px) {
     background: var(--p-surface-0);
   }
 }

 .supplier-profile__name-row :deep(.base-icon-button) {
   background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);

   @media (min-width: 768px) {
     background: var(--p-surface-0);
   }
 }

 .supplier-profile__name-row :deep(.base-icon-button:hover),
 .supplier-profile__name-row :deep(.base-icon-button:focus-visible) {
   background: var(--p-tideblue-50);
 }

 .supplier-profile__chips {
   display: flex;
   gap: var(--p-spacing-2);
   flex-wrap: wrap;
   justify-content: center;

   @media (min-width: 768px) {
     flex-wrap: nowrap;
     justify-content: flex-start;
   }
 }

 .supplier-profile__chips :deep(.p-tag) {
   display: flex;
   padding: var(--p-spacing-1) var(--p-spacing-2);
   flex-direction: column;
   align-items: flex-start;
   gap: var(--p-spacing-2);
   border: 4px solid var(--p-surface-0);
   border-radius: var(--p-border-radius-full);
   color: var(--p-deepblue-900);
   font-weight: var(--p-font-weight-bold);
 }

 .supplier-profile__chip {
   font-size: var(--p-font-size-sm);
   padding: var(--p-spacing-1) var(--p-spacing-3);
   border-radius: var(--p-border-radius-full);
 }

 .supplier-profile__chip--outline {
   border: 1px solid var(--p-surface-300);
   color: var(--p-deepblue-900);
   background: transparent;
 }

 .stats-row {
   display: grid;
   gap: var(--p-spacing-3);

   @media (min-width: 1024px) {
     display: flex;
     gap: var(--p-spacing-4);
   }
 }

 .stats-card {
   flex: 1;
   background: var(--p-surface-0);
   border-radius: var(--p-border-radius-xs);
   box-shadow: var(--p-shadow-sm);
   padding: clamp(var(--p-spacing-4), 2vw, var(--p-spacing-6));
 }

 .stats-grid {
   display: grid;
   grid-template-columns: 1fr 1fr;
   gap: var(--p-spacing-3);

   @media (min-width: 768px) {
     gap: var(--p-spacing-4) var(--p-spacing-4);
   }
 }

 .stat {
   display: flex;
   flex-direction: column;
   gap: var(--p-spacing-2);
 }

 /* Value + Looker deep-link icon on one line. */
 .stat-value-row {
   display: flex;
   align-items: center;
   gap: var(--p-spacing-1);
 }

 .stat-label {
   font-size: var(--p-font-size-sm);
   color: var(--p-gray-800);
 }

 .stat-value {
   font-size: var(--p-font-size-base);
   font-weight: var(--p-font-weight-bold);
   color: var(--p-deepblue-900);
   line-height: 1;
 }

 .stat-value.standing-good,
 .stat-value.standing-bad {
   font-family: var(--p-font-family);
   font-size: var(--p-font-size-base);
   font-style: normal;
   font-weight: var(--p-font-weight-bold);
   line-height: 1;
   letter-spacing: 0;
   font-feature-settings: 'liga' off, 'clig' off;
   display: flex;
   align-items: center;
   gap: var(--p-spacing-2);
 }

 .stat-value.standing-good {
   color: var(--p-vividgreen-500);
 }

 .stat-value.standing-bad {
   color: var(--p-red-500);
 }

 .stat-value.standing-good .pi,
 .stat-value.standing-bad .pi {
   width: var(--p-spacing-3);
   height: var(--p-spacing-3);
   font-size: var(--p-font-size-xs);
 }

 /* Mobile defaults — back button hidden */
 .supplier-back {
   display: none;

   @media (min-width: 768px) {
     display: inline-flex;
   }
 }
</style>
