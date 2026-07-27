import type { TryCatchResult } from '~/types/api'

/**
 * Composable for orders.
 *
 * Currently returns mock data. When the Directus `orders` collection is created,
 * replace the mock internals with:
 *   const orderCrud = useDirectusCrud('orders')
 * and swap mock functions for real SDK calls (same return shape).
 */

interface MockOrder {
  id: number
  order_number: string
  web_order: string
  status: string
  created_on: string
  promise_ship_by: string
  requested_by: string
  document_total: number
  items_count: number
  customer_number: string
}

interface MockOrderItem {
  id: number
  sku: string
  mpn: string
  description: string
  unit_cost: number
  unit_price: number
  image: string | null
}

interface MockOrderShipment {
  id: number
  order_number: string
  order_date: string
  shipment_date: string
  carrier: string
  method: string
  tracking: string
  tracking_url: string | null
}

interface MockCustomerAccount {
  id: number
  account: string
  company_name: string
  status: string
  customer_group: string
  bill_to_city: string
  bill_to_state: string
  contact_name: string
}

interface MockOrderDetail {
  id: number
  order_number: string
  customer_number: string
  posting_date: string
  status: string
  web_order: string
  promise_ship_by: string
  customer_account: MockCustomerAccount
  items: MockOrderItem[]
  shipments: MockOrderShipment[]
}

// Mock data
// Field names match the expected Directus collection schema.

const MOCK_ORDERS: MockOrder[] = [
  { id: 1, order_number: '182379', web_order: 'W5212482', status: 'open', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 2, customer_number: 'C116570' },
  { id: 2, order_number: '182380', web_order: 'W5212483', status: 'open', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 2, customer_number: 'C116570' },
  { id: 3, order_number: '182381', web_order: 'W5212484', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 10, customer_number: 'C101865' },
  { id: 4, order_number: '182382', web_order: 'W5212485', status: 'open', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 8, customer_number: 'C101865' },
  { id: 5, order_number: '182383', web_order: 'W5212486', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 5, customer_number: 'C116570' },
  { id: 6, order_number: '182384', web_order: 'W5212487', status: 'open', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 3, customer_number: 'C116570' },
  { id: 7, order_number: '182385', web_order: 'W5212488', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 5, customer_number: 'C101865' },
  { id: 8, order_number: '182386', web_order: 'W5212489', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 5, customer_number: 'C101865' },
  { id: 9, order_number: '182387', web_order: 'W5212490', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 5, customer_number: 'C116570' },
  { id: 10, order_number: '182388', web_order: 'W5212491', status: 'cancelled', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 6, customer_number: 'C116570' },
  { id: 11, order_number: '182389', web_order: 'W5212492', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 5, customer_number: 'C101865' },
  { id: 12, order_number: '182390', web_order: 'W5212493', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 5, customer_number: 'C101865' },
  { id: 13, order_number: '182391', web_order: 'W5212494', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 5, customer_number: 'C116570' },
  { id: 14, order_number: '182392', web_order: 'W5212495', status: 'closed', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 5, customer_number: 'C116570' },
  { id: 15, order_number: '182393', web_order: 'W5212496', status: 'cancelled', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 6, customer_number: 'C101865' },
  { id: 16, order_number: '182394', web_order: 'W5212497', status: 'cancelled', created_on: '4/29/2025', promise_ship_by: '5/10/2025', requested_by: 'Van Ly', document_total: 35000, items_count: 6, customer_number: 'C101865' },
]

const MOCK_ORDER_DETAIL: MockOrderDetail = {
  id: 100,
  order_number: '1712943',
  customer_number: 'C116570',
  posting_date: '9/19/2025',
  status: 'open',
  web_order: 'W5212482',
  promise_ship_by: '9/19/2025',
  customer_account: {
    id: 1,
    account: 'C101865',
    company_name: 'Puget Sound Naval Shipyard',
    status: 'active',
    customer_group: 'Homeowner',
    bill_to_city: 'Bremerton',
    bill_to_state: 'Washington',
    contact_name: 'Van Ly',
  },
  items: [
    {
      id: 1,
      sku: 'AMC01-0005',
      mpn: '174031MF-013',
      description: 'IS-25 BF 3/4" - 1-1/2" CAST IRON,...',
      unit_cost: 71.29,
      unit_price: 87.95,
      image: null,
    },
    {
      id: 2,
      sku: 'AMC01-0005',
      mpn: '174031MF-013',
      description: 'IS-25 BF 3/4" - 1-1/2" CAST IRON,...',
      unit_cost: 71.29,
      unit_price: 87.95,
      image: null,
    },
  ],
  shipments: [
    {
      id: 1,
      order_number: '1712943',
      order_date: '5/22/2025',
      shipment_date: '5/25/2025',
      carrier: 'UPS',
      method: 'Ground',
      tracking: '1Z46FA300395929003',
      tracking_url: null,
    },
    {
      id: 2,
      order_number: '1712943',
      order_date: '5/22/2025',
      shipment_date: '5/25/2025',
      carrier: 'FedEx',
      method: 'Priority Overnight',
      tracking: '463302934517',
      tracking_url: null,
    },
    {
      id: 3,
      order_number: '1712943',
      order_date: '5/22/2025',
      shipment_date: '5/25/2025',
      carrier: 'R&L Carriers',
      method: 'LTL Standard',
      tracking: 'R&L82707314-4',
      tracking_url: null,
    },
  ],
}

// Simulated async delay for realistic mock
function simulateDelay(ms: number = 300): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface FetchOrdersOptions {
  limit?: number
  page?: number
  search?: string | null
  sort?: string[] | null
}

interface FetchOrderCountOptions {
  search?: string | null
}

interface UseOrdersReturn {
  fetchOrders: (options?: FetchOrdersOptions) => Promise<TryCatchResult<MockOrder[]>>
  fetchOrderCount: (options?: FetchOrderCountOptions) => Promise<TryCatchResult<number>>
  fetchOrderByNumber: (orderNumber: string) => Promise<TryCatchResult<MockOrderDetail>>
}

/**
 * To swap to Directus later:
 *   1. Create the `orders` collection in Directus
 *   2. Replace mock internals with useDirectusCrud('orders') calls
 *   3. The return signatures stay the same — { data, error }
 */
export function useOrders(): UseOrdersReturn {

  async function fetchOrders(options: FetchOrdersOptions = {}): Promise<TryCatchResult<MockOrder[]>> {
    const { limit = 16, page = 1, search = null } = options

    await simulateDelay()

    let filtered: MockOrder[] = [...MOCK_ORDERS]

    if (search) {
      const term = search.toLowerCase()
      filtered = filtered.filter((order) => {
        const searchableValues: string[] = [
          order.order_number,
          order.web_order,
          order.status,
          order.requested_by,
          order.customer_number,
        ]
        return searchableValues.some(
          (value) => value && String(value).toLowerCase().includes(term),
        )
      })
    }

    const start = (page - 1) * limit
    const paged = filtered.slice(start, start + limit)

    return { data: paged, error: null }
  }

  async function fetchOrderCount(options: FetchOrderCountOptions = {}): Promise<TryCatchResult<number>> {
    const { search = null } = options

    await simulateDelay(100)

    if (!search) {
      return { data: MOCK_ORDERS.length, error: null }
    }

    const term = search.toLowerCase()
    const count = MOCK_ORDERS.filter((order) => {
      const searchableValues: string[] = [
        order.order_number,
        order.web_order,
        order.status,
        order.requested_by,
        order.customer_number,
      ]
      return searchableValues.some(
        (value) => value && String(value).toLowerCase().includes(term),
      )
    }).length

    return { data: count, error: null }
  }

  async function fetchOrderByNumber(orderNumber: string): Promise<TryCatchResult<MockOrderDetail>> {
    await simulateDelay()

    // In mock mode, return the detail mock for any order number
    const orderDetail: MockOrderDetail = {
      ...MOCK_ORDER_DETAIL,
      order_number: orderNumber,
    }

    return { data: orderDetail, error: null }
  }

  return {
    fetchOrders,
    fetchOrderCount,
    fetchOrderByNumber,
  }
}
