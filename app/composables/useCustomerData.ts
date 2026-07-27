const ACTIVITIES_PAGE_SIZE = 20
const LOOKER_PAGE_SIZE = 20

// SAP card codes are "C" or "V" + 6 digits. The detail route is keyed on the
// Directus id, but legacy/bookmarked links (and anything before a new customer's
// SAP id syncs) may pass the SAP id — so we detect and resolve either form.
const SAP_ID_PATTERN = /^[CV]\d{6}$/i

/**
 * "First Last" for a contact record (name only — matches the Contacts table's
 * name column), falling back to the em dash when there's no contact.
 */
function formatContactLabel(contact: Record<string, any> | null | undefined): string {
  if (!contact) { return '—' }
  const name = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
  return name || '—'
}

type LookerFetcher = (
  accountNumber: string,
  options?: { page?: number, limit?: number },
) => Promise<{ data: Record<string, any>[] | null, error: { message: string } | null }>

/**
 * Creates the reactive state + loaders for a Looker-backed customer section
 * (shipments, quotes, orders, invoices). With `managesTotalCount` (all current
 * sections) the endpoint returns the full dashboard result set on the first
 * load and the section derives `totalCount` from the row count. The paged
 * `loadMore`/`loadAll` paths remain for any future section whose endpoint
 * pages with `LOOKER_PAGE_SIZE` rows and reports its total separately.
 */
function createPagedLookerSection(
  fetcher: LookerFetcher,
  errorLabel: string,
  totalCount: Ref<number>,
  options: { managesTotalCount?: boolean } = {},
) {
  // When `managesTotalCount` is set, the endpoint returns the section's full
  // result set in one call (Looker dashboards 166/167/168/169), so this section
  // owns `totalCount` — deriving it from the loaded rows instead of a count query.
  const { managesTotalCount = false } = options
  const items = ref<Record<string, any>[]>([])
  const isLoading = ref(false)
  const isLoadingMore = ref(false)
  const currentPage = ref(1)
  const allLoaded = ref(false)

  const hasMore = computed(() => {
    if (allLoaded.value) { return false }
    if (totalCount.value > 0) {
      return items.value.length < totalCount.value
    }
    return items.value.length > 0 && items.value.length % LOOKER_PAGE_SIZE === 0
  })

  function reset() {
    items.value = []
    currentPage.value = 1
    allLoaded.value = false
    if (managesTotalCount) {
      totalCount.value = 0
    }
  }

  async function loadFirstPage(accountNumber: string) {
    isLoading.value = true
    currentPage.value = 1
    allLoaded.value = false
    const { data, error } = await fetcher(accountNumber, { page: 1, limit: LOOKER_PAGE_SIZE })
    if (error) {
      console.error(errorLabel, error.message)
      items.value = []
      allLoaded.value = true
      isLoading.value = false
      return
    }
    const rows = Array.isArray(data) ? data : []
    items.value = rows
    if (managesTotalCount) {
      // The endpoint returned the dashboard's full result set — every row is
      // loaded, so the row count IS the total (from the dashboard, no query).
      totalCount.value = rows.length
      allLoaded.value = true
    } else if (rows.length < LOOKER_PAGE_SIZE) {
      allLoaded.value = true
    }
    isLoading.value = false
  }

  async function loadMore(accountNumber: string) {
    if (!hasMore.value || isLoadingMore.value || isLoading.value) {
      return
    }
    isLoadingMore.value = true
    const nextPage = currentPage.value + 1
    const { data, error } = await fetcher(accountNumber, { page: nextPage, limit: LOOKER_PAGE_SIZE })
    if (!error && Array.isArray(data)) {
      items.value = [...items.value, ...data]
      currentPage.value = nextPage
      if (data.length < LOOKER_PAGE_SIZE) {
        allLoaded.value = true
      }
    }
    isLoadingMore.value = false
  }

  async function loadAll(accountNumber: string) {
    if (allLoaded.value || isLoading.value || isLoadingMore.value) {
      return
    }
    isLoadingMore.value = true
    const { data, error } = await fetcher(accountNumber, { limit: -1 })
    if (!error && Array.isArray(data)) {
      items.value = data
      allLoaded.value = true
    }
    isLoadingMore.value = false
  }

  return {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    allLoaded,
    reset,
    loadFirstPage,
    loadMore,
    loadAll,
  }
}

export function useCustomerData() {
  const route = useRoute()
  const { fetchBusinessPartnerByAccountNumber, fetchBusinessPartner, fetchPartnerSyncState, updateBusinessPartner } = useBusinessPartners()
  const {
    fetchCustomerMetrics,
    fetchCustomerQuotes,
    fetchCustomerOrders,
    fetchCustomerInvoices,
    fetchCustomerShipments,
    fetchCustomerQuarterlyChart,
  } = useLooker()
  const { fetchCustomerCards } = useSquare()
  const { fetchActivities, fetchActivityCount } = useActivities()
  const { fetchActivityGroups } = useActivityGroups()

  const isLoading = ref(true)
  const isMetricsLoading = ref(true)
  const isCreditCardsLoading = ref(false)
  const isActivitiesLoading = ref(false)
  const isChartLoading = ref(true)
  const hasLoadError = ref(false)
  const loadError = ref<string | null>(null)

  // Section totals — each is owned by its dashboard-backed section (dashboards
  // 166/167/168/169), derived from the loaded rows rather than a count query.
  const quoteCount = ref(0)
  const orderCount = ref(0)
  const invoiceCount = ref(0)
  const shipmentCount = ref(0)

  // Paged Looker-backed sections (first page on load, append on scroll, full
  // set on in-section search). State + loaders are produced by the factory.
  const shipmentsSection = createPagedLookerSection(
    fetchCustomerShipments,
    'Failed to load customer shipments:',
    shipmentCount,
    // Shipments come from Looker dashboard 169 in one full fetch — this section
    // owns `shipmentCount`, deriving it from the dashboard rows (no count query).
    { managesTotalCount: true },
  )
  const quotesSection = createPagedLookerSection(
    fetchCustomerQuotes,
    'Failed to load customer quotes:',
    quoteCount,
    // Quotes come from Looker dashboard 166 in one full fetch — this section
    // owns `quoteCount`, deriving it from the dashboard rows (no count query).
    { managesTotalCount: true },
  )
  const ordersSection = createPagedLookerSection(
    fetchCustomerOrders,
    'Failed to load customer orders:',
    orderCount,
    // Orders come from Looker dashboard 167 in one full fetch — this section
    // owns `orderCount`, deriving it from the dashboard rows (no count query).
    { managesTotalCount: true },
  )
  const invoicesSection = createPagedLookerSection(
    fetchCustomerInvoices,
    'Failed to load customer invoices:',
    invoiceCount,
    // Invoices come from Looker dashboard 168 in one full fetch — this section
    // owns `invoiceCount`, deriving it from the dashboard rows (no count query).
    { managesTotalCount: true },
  )

  const partnerId = ref<number | null>(null)
  const logoId = ref<string | null>(null)
  const defaultBillingAddressJunctionId = ref<number | null>(null)
  const defaultShippingAddressJunctionId = ref<number | null>(null)
  const defaultSalesContactJunctionId = ref<number | null>(null)
  const defaultBillingContactJunctionId = ref<number | null>(null)
  // Shipping accounts come pre-loaded with the partner so the account drawer
  // doesn't need its own fetch.
  const shippingAccounts = ref<ShippingAccountView[]>([])
  const defaultParcelShippingJunctionId = ref<number | null>(null)
  const defaultLtlShippingJunctionId = ref<number | null>(null)

  const customer = reactive({
    // Directus id — the canonical key the detail route and all related-record
    // edits use. Present from creation, unlike `account` (SAP id), which syncs later.
    id: null as number | null,
    account: '',
    companyName: '',
    status: '',
    customerGroup: '',
    customerGroupId: null as number | null,
    isNationalAccount: false,
    accountNumber: '',
    accountRep: '—',
    accountManagerId: null as string | null,
    primaryContactName: '—',
    primaryContactEmail: '',
    primaryContactTitle: '',
    billingContactName: '—',
    billingContactEmail: '',
    billingContactTitle: '',
    defaultParcelCarrier: '—',
    parcelAccountNumber: '—',
    website: '',
    shopifyLogin: false,
    companyPhone: '—',
    defaultLtlCarrier: '—',
    ltlAccountNumber: '—',
    lifetimeQuoteCount: 0,
    lifetimeQuoteDollars: '$0.00',
    openQuoteCount: 0,
    openQuoteDollars: '$0.00',
    lifetimeOrderCount: 0,
    lifetimeOrderDollars: '$0.00',
    openOrderCount: 0,
    openOrderDollars: '$0.00',
    accountBalance: '$0.00',
    paymentTerms: '—',
    creditLimit: '$0.00',
    accountStanding: '',
    remarks: '',
  })

  const toast = useToast()

  // The partner is loaded (has a Directus id) but the SAP-sync worker hasn't
  // written its `account_number` back yet — a brand-new customer. Drives the "syncing"
  // spinner for the SAP id and keeps the SAP-backed UI in its loading state.
  const isAwaitingSapId = computed(() => customer.id != null && !customer.account)
  // The Service Master reported the SAP sync FAILED for this partner — show the
  // failed state instead of the spinner (and settle metrics/chart to empty).
  const isSapSyncFailed = ref(false)
  // Set to a formatted timestamp when the SAP sync succeeds live this session —
  // drives the "Synced <when>" indicator (info icon + tooltip) next to the
  // account number. Null for records that loaded already-synced.
  const sapSyncedAt = ref<string | null>(null)
  // Human-readable reason for the current failed/unconfirmed sync — the actual
  // Service Master error, the reason the Directus flow stamped on the record, or
  // a context-aware default. Bound to the failed indicator's tooltip so the cause
  // stays visible after the toast dismisses. Null while syncing or once synced.
  const sapSyncError = ref<string | null>(null)

  const contactCount = ref(0)
  const rawContacts = ref<Record<string, any>[] | null>(null)
  const addressCount = ref(0)
  const addresses = ref<Record<string, any>[]>([])
  const partnerPhoneNumbers = ref<Record<string, any>[]>([])
  const activities = ref<Record<string, any>[]>([])
  const activityGroups = ref<Record<string, any>[]>([])
  // Activities load page-by-page (infinite scroll); a search in the section
  // triggers a one-shot full load so client-side filtering covers everything.
  const activityCount = ref(0)
  const activitiesCurrentPage = ref(1)
  const isActivitiesLoadingMore = ref(false)
  const activitiesAllLoaded = ref(false)
  // Mirrors the paged-section pattern above: prefer the known total over a
  // "last page was full" guess so we never fire an empty trailing request.
  const hasMoreActivities = computed(() => {
    if (activitiesAllLoaded.value) { return false }
    if (activityCount.value > 0) {
      return activities.value.length < activityCount.value
    }
    return activities.value.length > 0 && activities.value.length % ACTIVITIES_PAGE_SIZE === 0
  })
  const creditCards = ref<Record<string, any>[]>([])

  // Aliases — expose the paged section state under the names the page/sections
  // already consume.
  const shipments = shipmentsSection.items
  const quotes = quotesSection.items
  const orders = ordersSection.items
  const invoices = invoicesSection.items
  const isShipmentsLoading = shipmentsSection.isLoading
  const isQuotesLoading = quotesSection.isLoading
  const isOrdersLoading = ordersSection.isLoading
  const isInvoicesLoading = invoicesSection.isLoading
  const isShipmentsLoadingMore = shipmentsSection.isLoadingMore
  const isQuotesLoadingMore = quotesSection.isLoadingMore
  const isOrdersLoadingMore = ordersSection.isLoadingMore
  const isInvoicesLoadingMore = invoicesSection.isLoadingMore
  const hasMoreShipments = shipmentsSection.hasMore
  const hasMoreQuotes = quotesSection.hasMore
  const hasMoreOrders = ordersSection.hasMore
  const hasMoreInvoices = invoicesSection.hasMore

  const chartBars = ref<{ label: string, bookedSales: number, orderCount: number }[]>([])

  async function loadCustomerMetrics(accountNumber: string) {
    const { data, error } = await fetchCustomerMetrics(accountNumber)

    if (error) {
      console.error('Failed to load customer metrics:', error.message)
      isMetricsLoading.value = false
      return
    }

    customer.lifetimeQuoteCount = data.lifetimeQuoteCount
    customer.lifetimeQuoteDollars = formatCurrency(data.lifetimeQuoteDollars)
    customer.openQuoteCount = data.openQuoteCount
    customer.openQuoteDollars = formatCurrency(data.openQuoteDollars)
    customer.lifetimeOrderCount = data.lifetimeOrderCount
    customer.lifetimeOrderDollars = formatCurrency(data.lifetimeOrderDollars)
    customer.openOrderCount = data.openOrderCount
    customer.openOrderDollars = formatCurrency(data.openOrderDollars)
    customer.accountBalance = formatCurrency(data.accountBalance)
    customer.creditLimit = formatCurrency(data.creditLimit)
    customer.paymentTerms = data.paymentTerms || '—'
    customer.accountStanding = data.accountStanding
    isMetricsLoading.value = false
  }

  async function loadCustomerCreditCards(referenceId: string) {
    isCreditCardsLoading.value = true
    const { data, error } = await fetchCustomerCards(referenceId)

    if (error) {
      console.error('Failed to load Square credit cards:', error.message)
      creditCards.value = []
      isCreditCardsLoading.value = false
      return
    }

    creditCards.value = data ?? []
    isCreditCardsLoading.value = false
  }

  async function loadCustomerQuarterlyChart(accountNumber: string) {
    isChartLoading.value = true
    const { data, error } = await fetchCustomerQuarterlyChart(accountNumber)

    if (error) {
      console.error('Failed to load customer quarterly chart:', error.message)
      chartBars.value = []
      isChartLoading.value = false
      return
    }

    chartBars.value = data?.rows ?? []
    isChartLoading.value = false
  }

  async function loadCustomerActivities(businessPartnerId: number | string) {
    isActivitiesLoading.value = true
    activitiesCurrentPage.value = 1
    activitiesAllLoaded.value = false

    const [listResult, countResult] = await Promise.all([
      fetchActivities(businessPartnerId, { page: 1, limit: ACTIVITIES_PAGE_SIZE }),
      fetchActivityCount(businessPartnerId),
    ])

    if (listResult.error) {
      console.error('Failed to load customer activities:', listResult.error.message)
      activities.value = []
      activitiesAllLoaded.value = true
      isActivitiesLoading.value = false
      return
    }

    activities.value = mapCustomerActivities(listResult.data)
    if (listResult.data.length < ACTIVITIES_PAGE_SIZE) {
      activitiesAllLoaded.value = true
    }
    if (countResult && !countResult.error) {
      activityCount.value = countResult.data
    }
    isActivitiesLoading.value = false
  }

  /**
   * Append the next page of activities — driven by the section's infinite scroll.
   */
  async function loadMoreActivities() {
    if (
      partnerId.value === null
      || !hasMoreActivities.value
      || isActivitiesLoadingMore.value
      || isActivitiesLoading.value
    ) {
      return
    }

    isActivitiesLoadingMore.value = true
    const nextPage = activitiesCurrentPage.value + 1
    const { data, error } = await fetchActivities(partnerId.value, {
      page: nextPage,
      limit: ACTIVITIES_PAGE_SIZE,
    })

    if (!error && data) {
      activities.value = [...activities.value, ...mapCustomerActivities(data)]
      activitiesCurrentPage.value = nextPage
      if (data.length < ACTIVITIES_PAGE_SIZE) {
        activitiesAllLoaded.value = true
      }
    }
    isActivitiesLoadingMore.value = false
  }

  /**
   * Load every activity in one call — triggered when the section's search is
   * opened so client-side filtering can match the full set, not just the
   * pages scrolled so far. No-op once the full set is already loaded.
   */
  async function loadAllActivities() {
    if (
      partnerId.value === null
      || activitiesAllLoaded.value
      || isActivitiesLoading.value
      || isActivitiesLoadingMore.value
    ) {
      return
    }

    isActivitiesLoadingMore.value = true
    const { data, error } = await fetchActivities(partnerId.value, { limit: -1 })

    if (!error && data) {
      activities.value = mapCustomerActivities(data)
      activityCount.value = data.length
      activitiesAllLoaded.value = true
    }
    isActivitiesLoadingMore.value = false
  }

  async function loadActivityGroups() {
    const { data, error } = await fetchActivityGroups()

    if (error) {
      console.error('Failed to load activity groups:', error.message)
      return
    }

    activityGroups.value = data ?? []
  }

  /**
   * Refetch activities for the current customer — used after an edit/delete.
   * Preserves a fully-expanded (search) view by reloading the whole set;
   * otherwise reloads the first page.
   */
  function reloadActivities() {
    if (partnerId.value === null) {
      return
    }
    if (activitiesAllLoaded.value && activityCount.value > ACTIVITIES_PAGE_SIZE) {
      activitiesAllLoaded.value = false
      loadAllActivities()
    } else {
      loadCustomerActivities(partnerId.value)
    }
  }

  /**
   * Fetch the Directus business-partner record and map it into `customer`,
   * `rawContacts`, and `addresses`. Returns `true` on success. Shared by the
   * full `loadCustomer` and the lighter `reloadPartnerDetails` so both stay in
   * sync without duplicating the mapping.
   */
  async function loadPartnerRecord(routeKey: string, silent: boolean): Promise<boolean> {
    // Resolve by Directus id (the canonical key) or, for legacy/bookmarked
    // links and pre-SAP-sync records, by SAP id. A by-id 404 is treated as
    // "not found" (null) rather than a hard error so the not-found copy shows.
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
      console.error('Failed to load customer:', error.message)
      if (!silent) {
        if (isServerError(error)) {
          hasLoadError.value = true
        } else {
          loadError.value = 'Failed to load customer. Please try again.'
        }
        isLoading.value = false
      }
      return false
    }

    if (!partnerData) {
      if (!silent) {
        loadError.value = `Customer "${route.params.id}" not found.`
        isLoading.value = false
      }
      return false
    }

    logoId.value = partnerData.logo_id || null
    partnerId.value = partnerData.id
    customer.id = partnerData.id
    defaultBillingAddressJunctionId.value = normalizeJunctionId(
      partnerData.default_billing_business_partners_addresses_id,
    )
    defaultShippingAddressJunctionId.value = normalizeJunctionId(
      partnerData.default_shipping_business_partners_addresses_id,
    )

    customer.account = partnerData.account_number || ''
    customer.companyName = partnerData.name || ''
    customer.status = partnerData.status || ''
    const partnerGroup = partnerData.business_partner_groups_id as any
    customer.customerGroupId = partnerGroup?.id || null
    customer.customerGroup = partnerGroup?.name || ''
    customer.isNationalAccount = partnerData.is_national_account || false
    customer.accountNumber = partnerData.account_number || ''
    customer.website = partnerData.website || ''
    customer.shopifyLogin = !!partnerData.shopify_id
    customer.remarks = partnerData.remarks || ''

    // Account Information panel
    // These relations aren't on the BusinessPartner type yet, so read via `any`.
    const partnerRecord = partnerData as any
    const accountManager = partnerRecord.account_manager_id
    customer.accountRep = accountManager
      ? `${accountManager.first_name ?? ''} ${accountManager.last_name ?? ''}`.trim() || '—'
      : '—'
    customer.accountManagerId = accountManager?.id ?? null

    const salesContact = partnerRecord.default_sales_business_partners_contacts_id?.contacts_id
    customer.primaryContactName = formatContactLabel(salesContact)
    customer.primaryContactEmail = salesContact?.email_address || ''
    customer.primaryContactTitle = salesContact?.job_title || ''
    defaultSalesContactJunctionId.value = partnerRecord.default_sales_business_partners_contacts_id?.id ?? null

    const billingContact = partnerRecord.default_billing_business_partners_contacts_id?.contacts_id
    customer.billingContactName = formatContactLabel(billingContact)
    customer.billingContactEmail = billingContact?.email_address || ''
    customer.billingContactTitle = billingContact?.job_title || ''
    defaultBillingContactJunctionId.value = partnerRecord.default_billing_business_partners_contacts_id?.id ?? null

    const parcelAccount = partnerRecord.default_parcel_business_partners_shipping_accounts_id?.shipping_accounts_id
    customer.defaultParcelCarrier = parcelAccount?.shipping_carriers_id?.name || '—'
    customer.parcelAccountNumber = parcelAccount?.account_number || '—'

    const ltlAccount = partnerRecord.default_ltl_business_partners_shipping_accounts_id?.shipping_accounts_id
    customer.defaultLtlCarrier = ltlAccount?.shipping_carriers_id?.name || '—'
    customer.ltlAccountNumber = ltlAccount?.account_number || '—'

    // Full shipping-account list for the account drawer (pre-loaded, no refetch).
    defaultParcelShippingJunctionId.value = partnerRecord.default_parcel_business_partners_shipping_accounts_id?.id ?? null
    defaultLtlShippingJunctionId.value = partnerRecord.default_ltl_business_partners_shipping_accounts_id?.id ?? null
    shippingAccounts.value = (partnerRecord.business_partners_shipping_accounts || []).map((junction: any) =>
      mapShippingAccount(junction, defaultParcelShippingJunctionId.value, defaultLtlShippingJunctionId.value),
    )

    const partnerPhones = partnerData.phone_numbers || []
    const primaryPartnerPhone = partnerPhones.find(
      (junction: any) => (junction.phone_numbers_id as any)?.type === 'general',
    ) || partnerPhones[0]
    customer.companyPhone = primaryPartnerPhone
      ? formatPhoneNumber(primaryPartnerPhone.phone_numbers_id as any)
      : '—'
    partnerPhoneNumbers.value = mapPhoneNumbers(partnerPhones)

    rawContacts.value = partnerData.contacts ?? []
    contactCount.value = rawContacts.value.length
    addressCount.value = partnerData.addresses?.length ?? 0
    addresses.value = mapCustomerAddresses(partnerData.addresses, {
      defaultBillingJunctionId: defaultBillingAddressJunctionId.value,
      defaultShippingJunctionId: defaultShippingAddressJunctionId.value,
    })

    return true
  }

  async function loadCustomer(options = {}) {
    const { silent = false } = options as { silent?: boolean }

    if (!route.params.id) {
      navigateTo('/customers')
      return
    }

    if (!silent) {
      isLoading.value = true
      hasLoadError.value = false
      loadError.value = null
    }

    const routeKey = String(route.params.id)

    // The detail page is keyed on the Directus id, so the partner record loads
    // first — its `account_number` (absent for a freshly-created customer until the
    // SAP sync flow writes it back) is what every Looker/SAP-backed section needs.
    const partnerLoaded = await loadPartnerRecord(routeKey, silent)
    if (!partnerLoaded) {
      return
    }

    if (!silent) {
      isLoading.value = false
    }

    // Reset all SAP/Looker-backed data before (re)loading.
    shipmentsSection.reset()
    quotesSection.reset()
    ordersSection.reset()
    invoicesSection.reset()
    creditCards.value = []
    chartBars.value = []

    // Activities + activity groups come from Directus, keyed on the Directus id,
    // so they load regardless of SAP-sync state.
    activities.value = []
    activityCount.value = 0
    isActivitiesLoading.value = true
    loadCustomerActivities(partnerId.value!)
    loadActivityGroups()

    // SAP/Looker-backed sections (quotes, orders, invoices, shipments, metrics,
    // counts, chart, cards) need the SAP id. A new customer has none until the
    // sync worker writes it back.
    // Reset per-load SAP-sync state so a stale failure/reason from a
    // previously-viewed customer never bleeds into this one — the detail page
    // component is reused across :id changes.
    isSapSyncFailed.value = false
    sapSyncError.value = null
    sapSyncToasted = false
    expectsFreshSync = false

    if (customer.account) {
      stopSapIdWatch()
      loadLookerSections(customer.account)
    } else {
      // Awaiting SAP id: keep the SAP-backed metrics + chart in their loading
      // skeletons so the layout is reserved and doesn't shuffle when the data
      // arrives over the socket. The paged sections settle to empty (a brand-new
      // customer has none yet).
      isMetricsLoading.value = true
      isChartLoading.value = true
      isCreditCardsLoading.value = false
      if (import.meta.client && customer.id !== null) {
        // A sync only fires at CREATE time. If we just created this record, keep
        // the "syncing" state and reserved skeletons and expect a live outcome.
        // On a plain reopen nothing is syncing, so show the not-synced/failed
        // state (with Retry) immediately — we still subscribe so a genuinely
        // in-flight sync can recover it.
        expectsFreshSync = useJustCreatedPartner().consumeJustCreated(customer.id)
        if (!expectsFreshSync) {
          markSapSyncFailed(null, { silent: true })
        }
        watchForSapId(customer.id)
      }
    }
  }

  // Kick off every SAP/Looker-backed section for the given SAP account id.
  // Extracted so the socket subscription can fire it when `account_number` syncs in.
  function loadLookerSections(account: string) {
    isMetricsLoading.value = true
    isChartLoading.value = true
    loadCustomerMetrics(account)
    loadCustomerQuarterlyChart(account)
    shipmentsSection.loadFirstPage(account)
    quotesSection.loadFirstPage(account)
    ordersSection.loadFirstPage(account)
    invoicesSection.loadFirstPage(account)
    loadCustomerCreditCards(account)
  }


  // --- SAP-id sync watch (Service Master) ---
  // A freshly-created customer/supplier has no `account_number` until the Service
  // Master worker syncs it to SAP. The browser opens an SSE to our Nitro relay (which
  // holds the CF-Access'd Service Master WebSocket server-side — the browser
  // can't set CF Access headers on a socket) and reacts to the sync job:
  //   success → stamp the SAP id + load the SAP/Looker sections
  //   failed  → toast + failed state (settle metrics/chart to empty)
  //   queued/processing/retrying → keep the spinner + loading skeletons
  const { subscribe: subscribeSapSync } = useSapSyncSocket()
  let sapSyncUnsubscribe: (() => void) | null = null
  // Toast the failure once per sync attempt-cycle (a retry loop emits multiple
  // failed/retrying transitions); reset on success.
  let sapSyncToasted = false
  // True while we're watching a sync we KNOW is firing (a fresh create or a
  // manual retry). A silence/deadline timeout on such a record is a real problem
  // worth surfacing loudly; on a plain reopen it isn't (see markSapSyncFailed).
  let expectsFreshSync = false

  // Safety net for a record whose sync job the worker no longer tracks (e.g. it
  // failed in a past session): reopening it gets NO status over the socket, which
  // would otherwise spin "syncing" forever. If no status arrives within this
  // window, settle out of the spinner. An actively-tracked sync replays its
  // status within a second or two, well inside this window, and re-arms on every
  // queued/processing tick.
  const SAP_SYNC_SILENCE_MS = 15000
  let sapSyncSilenceTimer: ReturnType<typeof setTimeout> | null = null
  // Absolute backstop: the silence timer re-arms on every queued/processing tick,
  // so a job that keeps emitting heartbeats without ever finishing could still
  // spin forever. This fires ONCE from the start of a watch (never re-armed) to
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
      if (customer.account) { return }
      // A sync we expected to hear about went quiet → confirm the outcome and
      // surface a reason. A plain reopen (no expected sync) settles quietly.
      if (expectsFreshSync) { settleSapSyncUnconfirmed() }
      else { markSapSyncFailed(null, { silent: true }) }
    }, SAP_SYNC_SILENCE_MS)
  }

  function armSapSyncDeadlineTimer() {
    clearSapSyncDeadlineTimer()
    sapSyncDeadlineTimer = setTimeout(() => {
      if (!customer.account) { settleSapSyncUnconfirmed() }
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
    if (customer.account || customer.id == null) { return }

    const { data: syncState } = await fetchPartnerSyncState(customer.id)
    if (customer.account) { return }
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

  // Human-readable sync time for the "Synced <when>" tooltip, e.g.
  // "June 29, 2026 at 1:52 PM".
  function formatSyncedAt(date: Date): string {
    const datePart = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    return `${datePart} at ${timePart}`
  }

  function applySyncedSapId(syncedSapId: unknown): boolean {
    if (!syncedSapId || customer.account) {
      return false
    }
    isSapSyncFailed.value = false
    sapSyncError.value = null
    sapSyncToasted = false
    customer.account = String(syncedSapId)
    customer.accountNumber = String(syncedSapId)
    sapSyncedAt.value = formatSyncedAt(new Date())
    loadLookerSections(customer.account)
    stopSapIdWatch()
    return true
  }

  // Sync failed / unconfirmed: record the reason (kept visible in the failed
  // indicator's tooltip), toast once, drop the spinner, and settle the SAP-backed
  // metrics/chart/counts to empty (no perpetual skeleton). The stream stays open
  // so a Service Master retry that later succeeds still recovers the data.
  //   - failed      → SAP (or the flow) reported an error. Severity: error.
  //   - unconfirmed → we timed out waiting for any outcome. Severity: warn; the
  //     copy points at the likely upstream causes (service down / no SAP licence).
  function markSapSyncFailed(error?: string | null, options: { silent?: boolean, unconfirmed?: boolean } = {}) {
    clearSapSyncSilenceTimer()
    clearSapSyncDeadlineTimer()
    const messages = getSapSyncMessages('account')
    const detail = error || (options.unconfirmed ? messages.unconfirmed : messages.failed)
    sapSyncError.value = detail
    if (!options.silent && !sapSyncToasted) {
      toast.add({
        severity: options.unconfirmed ? 'warn' : 'error',
        summary: options.unconfirmed ? 'Sync Unconfirmed' : 'Sync Failed',
        detail,
        life: 8000,
      })
      sapSyncToasted = true
    }
    isSapSyncFailed.value = true
    sapSyncedAt.value = null
    isMetricsLoading.value = false
    isChartLoading.value = false
    isCreditCardsLoading.value = false
  }

  // "Retry Sync" — re-fire the Directus → Service Master sync by touching the
  // partner record, then drop back into the syncing (spinner) state. The socket
  // subscription stays open through a failure, so it picks up the new outcome.
  async function retrySapSync() {
    if (customer.id == null) {
      return
    }
    isSapSyncFailed.value = false
    sapSyncError.value = null
    sapSyncToasted = false
    sapSyncedAt.value = null
    // A manual retry is a sync we expect to hear back on — arm the loud timeout
    // path (and the deadline backstop) via watchForSapId below.
    expectsFreshSync = true
    isMetricsLoading.value = true
    isChartLoading.value = true
    await updateBusinessPartner(customer.id, { name: customer.companyName })
    watchForSapId(customer.id)
  }

  function handleSapSyncUpdate(update: { status?: string, sapId?: string | null, error?: string | null }) {
    if (update.status === 'success' && update.sapId) {
      applySyncedSapId(update.sapId)
      return
    }
    // retry / fail (and cancelled) → show the failed message.
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
    isMetricsLoading.value = true
    isChartLoading.value = true
    armSapSyncSilenceTimer()
  }

  // Watch the partner's SAP sync job via the Service Master SSE relay (Nitro
  // holds the CF-Access'd upstream WebSocket; the browser consumes the relayed
  // status over an EventSource). The stream auto-reconnects and replays the last
  // known status on (re)subscribe.
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

  onScopeDispose(stopSapIdWatch)

  /**
   * Refetch ONLY the Directus business-partner record (company info, contacts,
   * addresses) after a partner-level edit — contact, address, account note, or
   * account info. Deliberately does NOT touch the Looker-backed sections
   * (quotes, orders, invoices, shipments), metrics, chart, credit cards, or
   * activities: none of those change when editing partner data, so a full
   * `loadCustomer` would refire every Looker request for nothing.
   */
  async function reloadPartnerDetails() {
    if (!route.params.id) {
      return
    }
    await loadPartnerRecord(String(route.params.id), true)
  }

  function loadMoreShipments() {
    if (customer.account) { shipmentsSection.loadMore(customer.account) }
  }
  function loadAllShipments() {
    if (customer.account) { shipmentsSection.loadAll(customer.account) }
  }
  function loadMoreQuotes() {
    if (customer.account) { quotesSection.loadMore(customer.account) }
  }
  function loadAllQuotes() {
    if (customer.account) { quotesSection.loadAll(customer.account) }
  }
  function loadMoreOrders() {
    if (customer.account) { ordersSection.loadMore(customer.account) }
  }
  function loadAllOrders() {
    if (customer.account) { ordersSection.loadAll(customer.account) }
  }
  function loadMoreInvoices() {
    if (customer.account) { invoicesSection.loadMore(customer.account) }
  }
  function loadAllInvoices() {
    if (customer.account) { invoicesSection.loadAll(customer.account) }
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

  return {
    isLoading,
    isAwaitingSapId,
    isSapSyncFailed,
    sapSyncError,
    sapSyncedAt,
    retrySapSync,
    isMetricsLoading,
    isQuotesLoading,
    isOrdersLoading,
    isInvoicesLoading,
    isShipmentsLoading,
    isCreditCardsLoading,
    isActivitiesLoading,
    isChartLoading,
    hasLoadError,
    loadError,
    partnerId,
    logoId,
    defaultBillingAddressJunctionId,
    defaultShippingAddressJunctionId,
    defaultSalesContactJunctionId,
    defaultBillingContactJunctionId,
    shippingAccounts,
    defaultParcelShippingJunctionId,
    defaultLtlShippingJunctionId,
    customer,
    contactCount,
    rawContacts,
    addressCount,
    addresses,
    partnerPhoneNumbers,
    shipments,
    activities,
    activityGroups,
    activityCount,
    hasMoreActivities,
    isActivitiesLoadingMore,
    loadMoreActivities,
    loadAllActivities,
    quotes,
    orders,
    invoices,
    creditCards,
    quoteCount,
    orderCount,
    invoiceCount,
    shipmentCount,
    chartBars,
    hasMoreShipments,
    hasMoreQuotes,
    hasMoreOrders,
    hasMoreInvoices,
    isShipmentsLoadingMore,
    isQuotesLoadingMore,
    isOrdersLoadingMore,
    isInvoicesLoadingMore,
    loadMoreShipments,
    loadAllShipments,
    loadMoreQuotes,
    loadAllQuotes,
    loadMoreOrders,
    loadAllOrders,
    loadMoreInvoices,
    loadAllInvoices,
    loadCustomer,
    reloadPartnerDetails,
    loadCustomerCreditCards,
    reloadActivities,
  }
}
