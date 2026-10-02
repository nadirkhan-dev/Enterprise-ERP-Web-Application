import { defineStore } from 'pinia'

const MAX_AGE_MS: number = 5 * 60 * 1000

export interface TableStateEntry {
  rows: Record<string, any>[]
  currentPage: number
  hasMore: boolean
  totalRecords: number
  sortField: string
  sortOrder: number
  scrollTop: number
  searchQuery: string
  savedAt: number
}

/**
 * A list page's pre-warmed TAIL: the last rows of the sequence (forward order),
 * fetched in the background under the reversed sort while the user browses the
 * list. The detail-page navigation stores seed their tail segment from this on
 * entry, so Previous on the first entity (the wrap to the last) is instant
 * instead of waiting on a round-trip. Shares the head cache's lifecycle — both
 * are dropped together whenever the list's filter / sort / search changes.
 */
export interface TailCacheEntry {
  rows: Record<string, any>[]
  // True when the prefetch returned a short page — the tail already spans the
  // whole sequence back to the first entity.
  reachedStart: boolean
  sortField: string
  sortOrder: number
  searchQuery: string
  savedAt: number
}

interface TableStateState {
  cache: Record<string, TableStateEntry>
  tailCache: Record<string, TailCacheEntry>
}

export const useTableStateStore = defineStore('tableState', {
  state: (): TableStateState => ({
    cache: {},
    tailCache: {},
  }),

  actions: {
    saveTableState(routePath: string, stateObj: Omit<TableStateEntry, 'savedAt'>): void {
      this.cache[routePath] = {
        ...stateObj,
        savedAt: Date.now(),
      }
    },

    getTableState(routePath: string): TableStateEntry | null {
      const entry = this.cache[routePath]
      if (!entry) { return null }
      if (Date.now() - entry.savedAt > MAX_AGE_MS) {
        delete this.cache[routePath]
        return null
      }
      return entry
    },

    clearTableState(routePath: string): void {
      delete this.cache[routePath]
      // The head and the pre-warmed tail describe the same filtered sequence, so
      // a filter/sort/search change that invalidates one invalidates both.
      delete this.tailCache[routePath]
    },

    saveTailState(routePath: string, entry: Omit<TailCacheEntry, 'savedAt'>): void {
      this.tailCache[routePath] = {
        ...entry,
        savedAt: Date.now(),
      }
    },

    getTailState(routePath: string): TailCacheEntry | null {
      const entry = this.tailCache[routePath]
      if (!entry) { return null }
      if (Date.now() - entry.savedAt > MAX_AGE_MS) {
        delete this.tailCache[routePath]
        return null
      }
      return entry
    },

    clearTailState(routePath: string): void {
      delete this.tailCache[routePath]
    },
  },
})
