<script setup lang="ts">
import { useCustomerNavigationStore } from '~/stores/customerNavigation'

const route = useRoute()
const navStore = useCustomerNavigationStore()
const toast = useToast()

const {
  isLoading,
  isAwaitingSapId,
  isSapSyncFailed,
  sapSyncError,
  sapSyncedAt,
  retrySapSync,
  isMetricsLoading,
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
  isQuotesLoading,
  isOrdersLoading,
  isInvoicesLoading,
  isShipmentsLoading,
  isCreditCardsLoading,
  isActivitiesLoading,
  isChartLoading,
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
} = useCustomerData()

// Detail-page title is the semantic identifier (account number); reactive so it
// updates once the record loads. Falls back to 'Customer' before data arrives.
useHead({ title: () => customer.account || 'Customer' })

function reloadCreditCards() {
  if (customer.account) {
    loadCustomerCreditCards(customer.account)
  }
}

// Every edit re-syncs the whole partner to SAP. Reload the record as before, and —
// for an already-synced customer (the initial create-sync owns the first one) —
// watch that follow-up sync and toast only if it fails. Success stays silent.
const { watchPartnerSyncFailure } = useSapSyncFailureWatch()

function handleEditSaved(subject: 'account' | 'address' | 'contact') {
  reloadPartnerDetails()
  if (customer.account) {
    watchPartnerSyncFailure(toValue(partnerId), subject)
  }
}

const { showLoader } = useDeferredLoading(isLoading)
const {
  isLogoProcessing,
  logoSrc,
  logoSrcset,
  handleLogoSelect,
  handleLogoRemove,
} = useEntityLogo(LOGO_COLLECTIONS.businessPartners, partnerId, logoId)
// Loads the customer record and points the Next/Prev navigation at it. The
// nav store decides whether this is a fresh entry (rebuild + reset the detail
// filter) or a Next/Prev step (preserve the detail filter).
function handleCustomerRoute() {
  navStore.enterCustomer(String(route.params.id))
  loadCustomer()
}

const mappedContacts = computed(() => mapCustomerContacts(rawContacts.value))
const mapAddressesWithDefaults = (rawAddresses: Record<string, any>[] | null) => mapCustomerAddresses(rawAddresses, {
  defaultBillingJunctionId: defaultBillingAddressJunctionId.value,
  defaultShippingJunctionId: defaultShippingAddressJunctionId.value,
})

const lookerUrl = computed(() => {
  if (!customer.account) { return null }
  return `https://libertysupply.cloud.looker.com/dashboards/155?Timeframe=9%20quarter&Customer%20Account%20Number=${encodeURIComponent(customer.account)}`
})

// "View in Looker" dashboards for the customer detail tables — each filtered
// to this customer's account. Quotes 166 · Orders 167 · Invoices 168 · Shipments 169.
function buildTableLookerUrl(dashboardId: number, documentStatus: string | null = null): string | null {
  if (!customer.account) { return null }
  const params = [`Account%20Number=${encodeURIComponent(customer.account)}`]
  if (documentStatus) {
    params.push(`Document%20Status=${encodeURIComponent(documentStatus)}`)
  }
  return `https://libertysupply.cloud.looker.com/dashboards/${dashboardId}?${params.join('&')}`
}

const quotesLookerUrl = computed(() => buildTableLookerUrl(166))
const ordersLookerUrl = computed(() => buildTableLookerUrl(167))
const invoicesLookerUrl = computed(() => buildTableLookerUrl(168))
const shipmentsLookerUrl = computed(() => buildTableLookerUrl(169))

// Stat-card deep-links scope the report to the exact figure clicked: Lifetime →
// every document (Open + Closed), Open → Open only. (166 Quotes · 167 Orders.)
const quotesLifetimeLookerUrl = computed(() => buildTableLookerUrl(166, 'Open,Closed'))
const quotesOpenLookerUrl = computed(() => buildTableLookerUrl(166, 'Open'))
const ordersLifetimeLookerUrl = computed(() => buildTableLookerUrl(167, 'Open,Closed'))
const ordersOpenLookerUrl = computed(() => buildTableLookerUrl(167, 'Open'))

// Nav tabs with live counts
const navTabs = computed(() => [
  {
    label: 'Account Information',
    icon: 'pi pi-building',
    sectionId: 'account-info',
  },
  { label: `Shipments (${shipmentCount.value.toLocaleString()})`, icon: 'ms:local_shipping', sectionId: 'shipments' },
  { label: `Activities (${activityCount.value.toLocaleString()})`, icon: 'ms:checklist', sectionId: 'activities' },
  {
    label: `Contacts (${contactCount.value.toLocaleString()})`,
    icon: 'pi pi-user',
    sectionId: 'contacts',
  },
  {
    label: `Addresses (${addressCount.value.toLocaleString()})`,
    icon: 'pi pi-map',
    sectionId: 'addresses',
  },
  { label: `Quotes (${quoteCount.value.toLocaleString()})`, icon: 'ms:request_quote', sectionId: 'quotes' },
  { label: `Orders (${orderCount.value.toLocaleString()})`, icon: 'pi pi-shopping-cart', sectionId: 'orders' },
  { label: `Invoices (${invoiceCount.value.toLocaleString()})`, icon: 'pi pi-receipt', sectionId: 'invoices' },
  {
    label: `Credit Cards (${creditCards.value.length.toLocaleString()})`,
    icon: 'pi pi-credit-card',
    sectionId: 'credit-cards',
  },
])

const accountNoteDrawerVisible = ref(false)
function openAccountNoteDrawer() {
  accountNoteDrawerVisible.value = true
}

const accountInfoDrawerVisible = ref(false)
function openEditAccountInfo() {
  accountInfoDrawerVisible.value = true
}

// The page transition re-creates this component on every Next/Prev, so
// `onMounted` covers in-detail navigation; the route watch covers the case
// where the component is reused instead. Both route through `handleCustomerRoute`.
watch(() => route.params.id, handleCustomerRoute)
onMounted(handleCustomerRoute)

// Surface navigation fetch failures as a toast. The nonce re-fires the watcher
// even when consecutive failures carry the same message.
watch(
  () => navStore.navErrorNonce,
  () => {
    toast.add({
      severity: 'error',
      summary: 'Customer navigation',
      detail: navStore.navErrorMessage ?? 'Something went wrong.',
      life: 4000,
    })
  },
)
</script>

<template>
  <div class="customer-page">
    <BaseLoader
      v-if="showLoader"
      overlay
      label="Loading customer..."
    />

    <!-- Top toolbar — back link + filter / next-prev CTAs -->
    <div
      v-if="!hasLoadError"
      class="customer-page__top"
    >
      <BaseBackButton
        to="/customers"
        label="Back to Customers"
        class="customer-back"
      />
      <CustomerToolbar :show-navigation="true" />
    </div>

    <Error500 v-if="hasLoadError" />

    <Message
      v-if="loadError"
      severity="error"
      :closable="false"
    >
      {{ loadError }}
    </Message>

    <div
      v-if="!isLoading && !hasLoadError && !loadError"
      class="customer-page__content"
    >
      <CustomerProfileHeader
        :customer="customer"
        :tabs="navTabs"
        :chart-bars="chartBars"
        :looker-url="lookerUrl"
        :is-chart-loading="isChartLoading"
        :awaiting-sap-id="isAwaitingSapId"
        :sap-sync-failed="isSapSyncFailed"
        :sap-sync-error="sapSyncError"
        :sap-synced-at="sapSyncedAt"
        :logo-src="logoSrc"
        :logo-srcset="logoSrcset"
        :is-logo-processing="isLogoProcessing"
        @logo-select="handleLogoSelect"
        @logo-remove="handleLogoRemove"
        @logo-error="logoId = null"
        @notes-click="openAccountNoteDrawer"
        @retry-sap-sync="retrySapSync"
      />

      <CustomerStatsRow
        :customer="customer"
        :is-loading="isMetricsLoading"
        :quotes-lifetime-looker-url="quotesLifetimeLookerUrl"
        :quotes-open-looker-url="quotesOpenLookerUrl"
        :orders-lifetime-looker-url="ordersLifetimeLookerUrl"
        :orders-open-looker-url="ordersOpenLookerUrl"
      />

      <CustomerAccountInfoPanel
        :customer="customer"
        :awaiting-sap-id="isAwaitingSapId"
        :sap-sync-failed="isSapSyncFailed"
        :sap-sync-error="sapSyncError"
        :sap-synced-at="sapSyncedAt"
        @edit="openEditAccountInfo"
        @retry-sap-sync="retrySapSync"
      />

      <SectionShipments
        :shipments="shipments"
        :total-count="shipmentCount"
        :collapsed="!shipmentCount"
        :loading="isShipmentsLoading"
        :is-loading-more="isShipmentsLoadingMore"
        :has-more="hasMoreShipments"
        :looker-url="shipmentsLookerUrl"
        @scroll-near-bottom="loadMoreShipments"
        @load-all="loadAllShipments"
      />

      <SectionActivities
        :activities="activities"
        :contacts="mappedContacts"
        :activity-groups="activityGroups"
        :business-partner-id="partnerId"
        :account-manager-id="customer.accountManagerId"
        :account-manager-name="customer.accountRep"
        :loading="isActivitiesLoading"
        :total-count="activityCount"
        :has-more="hasMoreActivities"
        :is-loading-more="isActivitiesLoadingMore"
        :collapsed="!activities.length"
        @saved="reloadActivities"
        @scroll-near-bottom="loadMoreActivities"
        @load-all="loadAllActivities"
      />

      <SectionContacts
        :collapsed="!contactCount"
        :business-partner-id="partnerId"
        :customer-group="customer.customerGroup"
        :addresses="addresses"
        :map-contacts="mapCustomerContacts"
        :initial-contacts="rawContacts"
        :default-sales-contact-junction-id="defaultSalesContactJunctionId"
        :default-billing-contact-junction-id="defaultBillingContactJunctionId"
        @update:count="contactCount = $event"
        @saved="handleEditSaved('contact')"
      />

      <!-- Addresses (paginates from its own API calls; addresses ref on this
           page is still loaded fully for the contact + credit-card pickers) -->
      <SectionAddresses
        :collapsed="!addressCount"
        :business-partner-id="partnerId"
        :business-partner-name="customer.companyName"
        :map-addresses="mapAddressesWithDefaults"
        :default-billing-junction-id="defaultBillingAddressJunctionId"
        :default-shipping-junction-id="defaultShippingAddressJunctionId"
        @update:count="addressCount = $event"
        @saved="handleEditSaved('address')"
      />

      <SectionQuotes
        :quotes="quotes"
        :total-count="quoteCount"
        :collapsed="!quoteCount"
        :loading="isQuotesLoading"
        :is-loading-more="isQuotesLoadingMore"
        :has-more="hasMoreQuotes"
        :looker-url="quotesLookerUrl"
        @scroll-near-bottom="loadMoreQuotes"
        @load-all="loadAllQuotes"
      />

      <SectionOrders
        :orders="orders"
        :total-count="orderCount"
        :collapsed="!orderCount"
        :loading="isOrdersLoading"
        :is-loading-more="isOrdersLoadingMore"
        :has-more="hasMoreOrders"
        :looker-url="ordersLookerUrl"
        @scroll-near-bottom="loadMoreOrders"
        @load-all="loadAllOrders"
      />

      <SectionInvoices
        :invoices="invoices"
        :total-count="invoiceCount"
        :collapsed="!invoiceCount"
        :loading="isInvoicesLoading"
        :is-loading-more="isInvoicesLoadingMore"
        :has-more="hasMoreInvoices"
        :looker-url="invoicesLookerUrl"
        @scroll-near-bottom="loadMoreInvoices"
        @load-all="loadAllInvoices"
      />

      <SectionCreditCards
        :credit-cards="creditCards"
        :contacts="mappedContacts"
        :addresses="addresses"
        :reference-id="customer.account"
        :collapsed="!creditCards.length"
        :loading="isCreditCardsLoading"
        @saved="reloadCreditCards"
      />
    </div>

    <DrawerAccountNote
      v-model:visible="accountNoteDrawerVisible"
      context="Customer"
      :account-code="customer.account || customer.companyName"
      :remarks="customer.remarks"
      :business-partner-id="partnerId"
      @saved="handleEditSaved('account')"
    />
    <DrawerAccountInfo
      v-model:visible="accountInfoDrawerVisible"
      :customer="customer"
      :business-partner-id="partnerId"
      :shipping-accounts="shippingAccounts"
      :default-parcel-junction-id="defaultParcelShippingJunctionId"
      :default-ltl-junction-id="defaultLtlShippingJunctionId"
      :addresses="addresses"
      :contacts="mappedContacts"
      :phone-numbers="partnerPhoneNumbers"
      :default-shipping-address-junction-id="defaultShippingAddressJunctionId"
      :default-billing-address-junction-id="defaultBillingAddressJunctionId"
      :default-sales-contact-junction-id="defaultSalesContactJunctionId"
      :default-billing-contact-junction-id="defaultBillingContactJunctionId"
      @saved="handleEditSaved('account')"
    />
    <PageScrollTop />
  </div>
</template>

<style scoped>
.customer-page {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    padding: 0;

    @media (min-width: 768px) {
        gap: var(--p-spacing-4);
    }
}

/* Top toolbar — back link + filter / next-prev CTAs */
.customer-page__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-3);
    position: relative;
    /* Above the sticky profile tabs (z-index 90) so the filter popover sits over
       them, but below the fixed AppTopNav (z-index 100) so the toolbar scrolls
       UNDER it. (The popover is trapped in this stacking context, so this is what
       sets its ceiling — raising the popover's own z-index can't escape it.) */
    z-index: 95;
}

.customer-page__top > .customer-toolbar {
    margin-left: auto;
}
.customer-page__content {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    margin-top: calc(-1 * var(--p-spacing-8));
    /* Own stacking context below the toolbar so the pulled-up content (and its
       positioned children, e.g. the profile avatar) can't intercept toolbar taps. */
    position: relative;
    z-index: 0;

    @media (min-width: 768px) {
        display: contents;
    }
}

/* Mobile defaults — back button hidden, edit button icon-only */
.customer-back {
    display: none;

    @media (min-width: 768px) {
        display: inline-flex;
    }
}

</style>
