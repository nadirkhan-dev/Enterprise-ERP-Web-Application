/**
 * Sidebar navigation manifest.
 * Single source of truth for the sidebar nav structure (groups, leaves, icons, routes).
 */

export interface NavLeafItem {
  key: string
  label: string
  icon: string
  route: string
  disabled?: boolean
}

export interface NavGroupItem {
  key: string
  label: string
  icon: string
  items: NavLeafItem[]
  /** Landing route used when the group collapses to a single icon (e.g. Tools). */
  route?: string
}

export type NavItem = NavLeafItem | NavGroupItem

export const NAV_ITEMS: NavItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: 'pi pi-th-large',
    route: '/dashboard',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    icon: 'pi pi-barcode',
    items: [
      {
        key: 'items',
        label: 'Items',
        icon: 'ms:barcode_scanner',
        route: '/items',
      },
      {
        key: 'manufacturers',
        label: 'Manufacturers',
        icon: 'ms:precision_manufacturing',
        route: '/manufacturers',
      },
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    icon: 'pi pi-shopping-cart',
    items: [
      {
        key: 'customers',
        label: 'Customers',
        icon: 'pi pi-users',
        route: '/customers',
      },
      {
        key: 'quotes',
        label: 'Quotes',
        icon: 'ms:request_quote',
        route: '/quotes',
      },
      {
        key: 'orders',
        label: 'Orders',
        icon: 'pi pi-shopping-cart',
        route: '/orders',
      },
      {
        key: 'shipments',
        label: 'Shipments',
        icon: 'ms:local_shipping',
        route: '/shipments',
      },
      {
        key: 'invoices',
        label: 'Invoices',
        icon: 'pi pi-receipt',
        route: '/invoices',
      },
    ],
  },
  {
    key: 'procurement',
    label: 'Procurement',
    icon: 'pi pi-box',
    items: [
      {
        key: 'suppliers',
        label: 'Suppliers',
        icon: 'pi pi-box',
        route: '/suppliers',
      },
      {
        key: 'purchase-orders',
        label: 'Purchase Orders',
        icon: 'ms:order_approve',
        route: '/procurement/purchase-orders',
      },
    ],
  },
  {
    key: 'tools',
    label: 'Tools',
    icon: 'pi pi-wrench',
    // `route` is the landing shown when the group is collapsed to a single icon
    // (and the bare /tools empty state); expanded, the three children below take
    // over and the header just toggles.
    route: '/tools',
    items: [
      {
        key: 'special-sku-lookup',
        label: 'Special SKU',
        icon: 'pi pi-search',
        route: '/tools/special-sku-lookup',
      },
      {
        key: 'document-downloader',
        label: 'Downloader',
        icon: 'pi pi-file-pdf',
        route: '/tools/document-downloader',
      },
      {
        key: 'shipping-estimator',
        label: 'Estimator',
        icon: 'ms:local_shipping',
        route: '/tools/shipping-estimator',
      },
    ],
  },
]

// Top-level leaves (no children) — rendered as flat links above the grouped
// nav in the sidebar. Currently just Dashboard.
export const topLeafItems = NAV_ITEMS.filter(
  (navItem): navItem is NavLeafItem => !('items' in navItem),
)

export const groupItems = NAV_ITEMS.filter(
  (navItem): navItem is NavGroupItem => 'items' in navItem,
)

// Collapsed icon rail: top-level leaves render themselves; groups flatten to
// their children — except a group with its own `route` (Tools), which collapses
// to a single icon linking to that landing.
export const leafItems: NavLeafItem[] = NAV_ITEMS.flatMap((navItem) => {
  if (!('items' in navItem)) {
    return [navItem]
  }
  if (navItem.route) {
    return [{
      key: navItem.key,
      label: navItem.label,
      icon: navItem.icon,
      route: navItem.route,
    }]
  }
  return navItem.items
})
export function resolveNavLabel(routePath: string): string | null {
  const match = leafItems
    .filter((leaf) => routePath === leaf.route || routePath.startsWith(`${leaf.route}/`))
    .sort((a, b) => b.route.length - a.route.length)[0]
  return match?.label ?? null
}
