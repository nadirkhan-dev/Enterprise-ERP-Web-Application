/**
 * UI types — navigation, tabs, status, search.
 */

export interface NavItem {
  key: string
  label: string
  icon: string
  route?: string
  disabled?: boolean
  items?: NavItem[]
}

export interface Tab {
  label: string
  value: string
  icon?: string
  disabled?: boolean
}

export type StatusType = 'active' | 'inactive' | 'draft'

export interface BreadcrumbItem {
  label: string
  route?: string
  icon?: string
}

export interface SearchModule {
  key: string
  label: string
  // Singular, lowercase scope noun used in the "No <singular> results found"
  // toast (e.g. 'customer', 'item').
  singular: string
  listRoute: string
  matchRoutes: string[]
}
