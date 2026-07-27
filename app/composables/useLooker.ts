import type { TryCatchResult } from '~/types/api'

export interface CustomerMetrics {
  lifetimeQuoteCount: number
  lifetimeQuoteDollars: number
  openQuoteCount: number
  openQuoteDollars: number
  lifetimeOrderCount: number
  lifetimeOrderDollars: number
  openOrderCount: number
  openOrderDollars: number
  accountBalance: number
  creditLimit: number
  paymentTerms: string | null
  accountStanding: string
}

export interface CustomerQuarterlyChartRow {
  label: string
  bookedSales: number
  orderCount: number
}

export interface CustomerQuarterlyChartResponse {
  rows: CustomerQuarterlyChartRow[]
}

export interface SupplierPerformance {
  lifetimePoCount: number
  lifetimePoDollars: number
  openPoCount: number
  openPoDollars: number
  accountBalance: number
  creditLimit: number
}

export interface SupplierPurchaseOrder {
  id: number
  orderNumber: number
  docEntry: string | number | null
  status: string
  createdOn: string
  promiseShipBy: string | null
  documentTotal: number
  ownerCode: number | null
  requestedBy: string | null
}

export interface DocumentSummary {
  docEntry: string
  number: string | number
}

export interface ItemInventoryRow {
  warehouse: string
  binLocation: string
  available: number
  unitCost: number | null
}

export interface ItemPricingAvailability {
  baseCost: number | null
  offerPrice: number | null
  // Looker's `item_price.c_gross_margin` as a raw decimal fraction (e.g. 0.24 = 24%).
  grossMargin: number | null
  // Looker's "List" price-list row (`item_price.price`).
  manufacturerListPrice: number | null
  // Looker's `item.min_ordr_qty` (SAP Planning Data minimum order qty).
  minOrderQty: number | null
  inventory: ItemInventoryRow[]
}

export interface LookerPageOptions {
  /** 1-based page number. Defaults to 1. Ignored when limit is -1. */
  page?: number
  /** Rows per page. Pass -1 to fetch the full set in one call. Defaults to -1. */
  limit?: number
}

interface UseLookerReturn {
  fetchCustomerMetrics: (accountNumber: string) => Promise<TryCatchResult<CustomerMetrics>>
  fetchCustomerQuotes: (accountNumber: string, options?: LookerPageOptions) => Promise<TryCatchResult<Record<string, any>[]>>
  fetchCustomerOrders: (accountNumber: string, options?: LookerPageOptions) => Promise<TryCatchResult<Record<string, any>[]>>
  fetchCustomerInvoices: (accountNumber: string, options?: LookerPageOptions) => Promise<TryCatchResult<Record<string, any>[]>>
  fetchCustomerShipments: (accountNumber: string, options?: LookerPageOptions) => Promise<TryCatchResult<Record<string, any>[]>>
  fetchCustomerQuarterlyChart: (accountNumber: string) => Promise<TryCatchResult<CustomerQuarterlyChartResponse>>
  fetchSupplierPerformance: (cardCode: string) => Promise<TryCatchResult<SupplierPerformance>>
  // Always returns the dashboard tile's full set — the client paginates in memory.
  fetchSupplierPurchaseOrders: (cardCode: string) => Promise<TryCatchResult<SupplierPurchaseOrder[]>>
  fetchSupplierQuarterlyChart: (cardCode: string) => Promise<TryCatchResult<CustomerQuarterlyChartResponse>>
  fetchManufacturerQuarterlyChart: (manufacturerName: string) => Promise<TryCatchResult<CustomerQuarterlyChartResponse>>
  fetchItemQuarterlyChart: (itemCode: string) => Promise<TryCatchResult<CustomerQuarterlyChartResponse>>
  fetchItemPricingAvailability: (itemCode: string) => Promise<TryCatchResult<ItemPricingAvailability>>
  fetchDocumentsByType: (type: string) => Promise<TryCatchResult<DocumentSummary[]>>
}

/**
 * Composable for Looker-backed reads.
 *
 * Each method returns a normalized `{ data, error }` shape via `tryCatch` and proxies
 * a Nuxt server endpoint under `/api/looker/*`. The server endpoints encapsulate the
 * Looker SDK (see `server/utils/looker.ts`), so the client stays unaware of LookML
 * field names.
 */
export function useLooker(): UseLookerReturn {
  function fetchLooker<T>(path: string, query: Record<string, string>): Promise<TryCatchResult<T>> {
    return tryCatch($fetch<T>(`/api/looker/${path}`, { query })) as Promise<TryCatchResult<T>>
  }

  function buildPageQuery(accountNumber: string, options: LookerPageOptions = {}): Record<string, string> {
    const query: Record<string, string> = { accountNumber }
    if (options.limit !== undefined) {
      query.limit = String(options.limit)
    }
    if (options.page !== undefined) {
      query.page = String(options.page)
    }
    return query
  }

  return {
    fetchCustomerMetrics: accountNumber =>
      fetchLooker<CustomerMetrics>('customer-metrics', { accountNumber }),
    fetchCustomerQuotes: (accountNumber, options) =>
      fetchLooker<Record<string, any>[]>('customer-quotes', buildPageQuery(accountNumber, options)),
    fetchCustomerOrders: (accountNumber, options) =>
      fetchLooker<Record<string, any>[]>('customer-orders', buildPageQuery(accountNumber, options)),
    fetchCustomerInvoices: (accountNumber, options) =>
      fetchLooker<Record<string, any>[]>('customer-invoices', buildPageQuery(accountNumber, options)),
    fetchCustomerShipments: (accountNumber, options) =>
      fetchLooker<Record<string, any>[]>('customer-shipments', buildPageQuery(accountNumber, options)),
    fetchCustomerQuarterlyChart: accountNumber =>
      fetchLooker<CustomerQuarterlyChartResponse>('customer-quarterly-chart', { accountNumber }),
    fetchSupplierPerformance: cardCode =>
      fetchLooker<SupplierPerformance>('supplier-performance', { cardCode }),
    fetchSupplierPurchaseOrders: cardCode =>
      fetchLooker<SupplierPurchaseOrder[]>('supplier-purchase-orders', { cardCode }),
    fetchSupplierQuarterlyChart: cardCode =>
      fetchLooker<CustomerQuarterlyChartResponse>('supplier-quarterly-chart', { cardCode }),
    fetchManufacturerQuarterlyChart: manufacturerName =>
      fetchLooker<CustomerQuarterlyChartResponse>('manufacturer-quarterly-chart', { manufacturerName }),
    fetchItemQuarterlyChart: itemCode =>
      fetchLooker<CustomerQuarterlyChartResponse>('item-quarterly-chart', { itemCode }),
    fetchItemPricingAvailability: itemCode =>
      fetchLooker<ItemPricingAvailability>('item-pricing-availability', { itemCode }),
    fetchDocumentsByType: type =>
      fetchLooker<DocumentSummary[]>('documents', { type }),
  }
}
