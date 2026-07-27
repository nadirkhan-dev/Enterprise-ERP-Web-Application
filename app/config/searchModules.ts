import type { SearchModule } from '~/types/ui'

interface SearchModuleConfig {
  label: string
  singular: string
  listRoute: string
  matchRoutes: string[]
}

/**
 * Route-to-search-module mapping.
 * Each module defines which routes belong to it and where its list page lives.
 */
const SEARCH_MODULES: Record<string, SearchModuleConfig> = {
  suppliers: {
    label: 'Suppliers',
    singular: 'supplier',
    listRoute: '/suppliers',
    matchRoutes: ['/suppliers'],
  },
  customers: {
    label: 'Customers',
    singular: 'customer',
    listRoute: '/customers',
    matchRoutes: ['/customers'],
  },
  items: {
    label: 'Items',
    singular: 'item',
    listRoute: '/items',
    matchRoutes: ['/items'],
  },
  manufacturers: {
    label: 'Manufacturers',
    singular: 'manufacturer',
    listRoute: '/manufacturers',
    matchRoutes: ['/manufacturers'],
  },
}

/**
 * Resolve which search module the current route belongs to.
 */
export function resolveSearchModule(routePath: string): SearchModule | null {
  for (const [key, module] of Object.entries(SEARCH_MODULES)) {
    if (module.matchRoutes.some((prefix) => routePath.startsWith(prefix))) {
      return { key, ...module }
    }
  }
  return null
}

/**
 * All search modules as a flat list — used to fan a query out across every
 * scope (the cross-scope "results in other scopes" search).
 */
export function getSearchModules(): SearchModule[] {
  return Object.entries(SEARCH_MODULES).map(([key, module]) => ({ key, ...module }))
}
