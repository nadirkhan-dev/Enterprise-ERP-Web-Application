import type { SearchModule } from '~/types/ui'
import { resolveSearchModule } from '~/config/searchModules'
import { resolveNavLabel } from '~/config/navigation'

export interface CrossScopeResult {
  key: string
  label: string
  listRoute: string
  count: number
}

interface SearchState {
  searchQuery: string
  inputQuery: string
  filterText: string
  activeModuleKey: string | null
  activeModule: SearchModule | null
  scopeLabel: string | null
  resultCount: number
  // Other scopes that DO have results for the current query, shown in the
  // persistent cross-scope message after the active scope comes back empty.
  crossScopeResults: CrossScopeResult[]
  crossScopeQuery: string
  _pendingClear: boolean
  _urlInitialized: boolean
}

export const useSearchStore = defineStore('search', {
  state: (): SearchState => ({
    searchQuery: '',
    inputQuery: '',
    filterText: '',
    activeModuleKey: null,
    activeModule: null,
    scopeLabel: null,
    resultCount: 0,
    crossScopeResults: [],
    crossScopeQuery: '',
    _pendingClear: false,
    _urlInitialized: false,
  }),

  getters: {
    placeholder: (state): string => {
      const label = state.activeModule?.label ?? state.scopeLabel
      return label ? `Search ${label}` : 'Search'
    },

    hasActiveModule: (state): boolean => state.activeModule !== null,

    hasSearchQuery: (state): boolean => state.searchQuery.length > 0,
    hasResults: (state): boolean => state.resultCount > 0,
  },

  actions: {
    /**
     * Sync the active search module based on the current route path.
     * Clears the search query when the module changes, unless URL state
     * is being initialized (so the URL-provided query is preserved).
     */
    syncModule(routePath: string): void {
      const resolved = resolveSearchModule(routePath)
      const newKey = resolved?.key ?? null
      this.scopeLabel = resolveNavLabel(routePath)

      if (newKey !== this.activeModuleKey) {
        if (!this._urlInitialized) {
          this.searchQuery = ''
          this.inputQuery = ''
          this.filterText = ''
        }
        this.activeModuleKey = newKey
        this.activeModule = resolved
      } else if (this._pendingClear) {
        this.searchQuery = ''
        this.inputQuery = ''
        this.filterText = ''
      }

      this.resultCount = 0
      // A scope/route change supersedes any cross-scope message.
      this.clearCrossScopeResults()
      this._pendingClear = false
      this._urlInitialized = false
    },

    /**
     * Initialize store state from URL query params on page load or navigation.
     * Always writes both fields (including empty strings) so stale state is
     * cleared when the URL has no params (e.g. browser back to unfiltered list).
     * Filter is only set when a search query is also present.
     * Call this before syncModule so the query is not wiped.
     */
    initFromUrl(query: Record<string, string>): void {
      const searchQuery = (query.q ?? '').trim()
      const filterText = searchQuery ? (query.filter ?? '').trim() : ''
      this._urlInitialized = searchQuery.length > 0
      this.searchQuery = searchQuery
      this.inputQuery = searchQuery
      this.filterText = filterText
      this.resultCount = 0
      this.clearCrossScopeResults()
    },

    /**
     * Signal that the next syncModule call should clear search.
     * Call this before programmatic navigation (e.g. sidebar clicks).
     */
    markClearOnNavigate(): void {
      this._pendingClear = true
    },

    /**
     * Set the search query (consumed by list page watchers).
     * Trimmed so leading/trailing whitespace can't break exact matching.
     */
    setSearchQuery(query: string): void {
      this.searchQuery = query.trim()
      this.inputQuery = this.searchQuery
      this.filterText = ''
      this.resultCount = 0
      // A fresh query invalidates the previous cross-scope message.
      this.clearCrossScopeResults()
    },
    setInputQuery(text: string): void {
      this.inputQuery = text.trim()
    },

    /**
     * Set the client-side filter text for narrowing current page results.
     * Trimmed so stray whitespace can't hide otherwise-matching rows.
     */
    setFilterText(text: string): void {
      this.filterText = text.trim()
    },
    setResultCount(count: number): void {
      this.resultCount = count
    },

    /**
     * Record the scopes (other than the active one) that have results for the
     * given query. Drives the persistent cross-scope message.
     */
    setCrossScopeResults(query: string, results: CrossScopeResult[]): void {
      this.crossScopeQuery = query
      this.crossScopeResults = results
    },

    /**
     * Dismiss the cross-scope message (X, click-outside, or a new search).
     */
    clearCrossScopeResults(): void {
      this.crossScopeResults = []
      this.crossScopeQuery = ''
    },

    /**
     * Reset search query and filter text to empty.
     */
    clearSearch(): void {
      this.searchQuery = ''
      this.inputQuery = ''
      this.filterText = ''
      this.resultCount = 0
      this.clearCrossScopeResults()
    },
  },
})
