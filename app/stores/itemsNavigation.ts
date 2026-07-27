import { defineStore } from 'pinia'
import { useItemsFilterStore } from '~/stores/itemsFilter'
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'
import { useItems } from '~/composables/useItems'
import { canNavigate, locateCursor, resolveNeighbor, reverseSort } from '~/utils/navWindow'

// A list → detail navigation seeds its window from the rows the list already
// loaded; as the user navigates, the window is extended forward in fixed-size
// chunks rather than refetching the whole sequence. Mirrors
// `customerNavigation.ts` — see that file for the full design rationale.

const CHUNK_SIZE = 20

// When the focused item sits within this many rows of either window edge,
// the adjacent chunk is fetched in the background so Next/Prev never blocks
// on a network round-trip. With a 20-row chunk this prefetches around row 17.
const PREFETCH_THRESHOLD = 3

const LIST_ROUTE = '/items'

const NAV_ERROR_MESSAGE = 'Failed to load item navigation. Please try again.'

interface NavEntry {
  sku: string
  description: string
}

interface NavSnapshot {
  statuses: string[]
  manufacturerIds: number[]
  isSpecialOrderOnly: boolean
  search: string
  sortField: string
  sortOrder: number
}

interface NavWindow {
  entries: NavEntry[]
  windowStart: number
  totalCount: number | null
  reachedEnd: boolean
}

interface ItemsNavigationState {
  detailStatuses: string[]
  detailManufacturerIds: number[]
  detailIsSpecialOrderOnly: boolean

  snapshot: NavSnapshot | null
  entries: NavEntry[]
  windowStart: number
  totalCount: number | null
  reachedEnd: boolean

  // Tail window — the last items, fetched under the reversed sort and grown
  // backward as the cursor nears it, so wrapping to / navigating around the
  // last item is as smooth as the forward direction. Forward order; empty until
  // prefetched and while the head holds the whole sequence (`reachedEnd`).
  tailEntries: NavEntry[]
  tailReachedStart: boolean

  currentSku: string | null
  cursorIndex: number
  cursorInSet: boolean
  cursorTailIndex: number
  cursorInTail: boolean

  pendingInternalSku: string | null

  isBuilding: boolean
  isPrefetching: boolean
  isTailPrefetching: boolean

  navErrorMessage: string | null
  navErrorNonce: number
}

function buildSnapshotKey(snapshot: NavSnapshot): string {
  return JSON.stringify({
    s: [...snapshot.statuses].sort(),
    m: [...snapshot.manufacturerIds].sort((a, b) => a - b),
    o: snapshot.isSpecialOrderOnly,
    q: snapshot.search,
    f: snapshot.sortField,
    d: snapshot.sortOrder,
  })
}

function buildItemsFilter(snapshot: NavSnapshot): Record<string, unknown> | null {
  const conditions: Record<string, unknown>[] = []
  if (snapshot.statuses.length) {
    conditions.push({ status: { _in: [...snapshot.statuses] } })
  }
  if (snapshot.manufacturerIds.length) {
    conditions.push({ manufacturers_id: { _in: [...snapshot.manufacturerIds] } })
  }
  // Match /items semantics: unchecked → exclude special-order items
  // (is_standard_sku=true); checked → only special-order items.
  conditions.push({ is_standard_sku: { _eq: !snapshot.isSpecialOrderOnly } })
  return { _and: conditions }
}

function buildItemsSort(sortField: string | null, sortOrder: number = 1): string[] {
  const primaryField = sortField || 'sku'
  const primaryToken = sortOrder === -1 ? `-${primaryField}` : primaryField
  if (primaryField === 'sku') { return [primaryToken] }
  return [primaryToken, 'sku']
}

// Supersedes prior in-flight window builds — only the latest may commit.
let buildToken = 0

export const useItemsNavigationStore = defineStore('itemsNavigation', {
  state: (): ItemsNavigationState => ({
    detailStatuses: [],
    detailManufacturerIds: [],
    detailIsSpecialOrderOnly: false,
    snapshot: null,
    entries: [],
    windowStart: 0,
    totalCount: null,
    reachedEnd: false,
    tailEntries: [],
    tailReachedStart: false,
    currentSku: null,
    cursorIndex: 0,
    cursorInSet: false,
    cursorTailIndex: -1,
    cursorInTail: false,
    pendingInternalSku: null,
    isBuilding: true,
    isPrefetching: false,
    isTailPrefetching: false,
    navErrorMessage: null,
    navErrorNonce: 0,
  }),

  getters: {
    detailFilterCount: (state): number =>
      state.detailStatuses.length
      + state.detailManufacturerIds.length
      + (state.detailIsSpecialOrderOnly ? 1 : 0),

    // Circular Next/Prev targets over the head + tail segments. Wrap-around,
    // the single-other-entity sides, and the empty / lone-current cases all live
    // in `resolveNeighbor` — see `~/utils/navWindow`. A null target can mean the
    // adjacent row isn't loaded yet (a forward chunk, or the tail); the toolbar
    // grows the relevant segment and re-reads.
    previousEntry: (state): NavEntry | null => resolveNeighbor(state, -1),

    nextEntry: (state): NavEntry | null => resolveNeighbor(state, 1),

    // Whether each chevron can move at all. Unlike the *Entry getters these
    // stay true while a wrap/next target is still being fetched, so a button is
    // greyed out ONLY at a genuine dead end: an empty set, the lone current
    // item, or the unused side of a single-other-item set.
    canGoPrevious: (state): boolean => canNavigate(state, -1),

    canGoNext: (state): boolean => canNavigate(state, 1),

    hasMoreForward: (state): boolean => {
      if (state.reachedEnd) { return false }
      if (state.totalCount != null) {
        return state.windowStart + state.entries.length < state.totalCount
      }
      return true
    },

    hasMoreBackward: (state): boolean => state.windowStart > 0,
  },

  actions: {
    enterItem(sku: string): void {
      const isInternalNavigation = this.pendingInternalSku === sku
      this.pendingInternalSku = null
      this.currentSku = sku

      if (isInternalNavigation && this.snapshot && this.entries.length > 0) {
        this.recomputeCursor()
        this.maybePrefetch()
        return
      }

      this.rebuildForFreshEntry()
    },

    markInternalNavigation(sku: string): void {
      this.pendingInternalSku = sku
    },

    async rebuildForFreshEntry(): Promise<void> {
      const token = ++buildToken
      this.isBuilding = true

      const filterStore = useItemsFilterStore()
      this.detailStatuses = [...filterStore.selectedStatuses]
      this.detailManufacturerIds = [...filterStore.selectedManufacturerIds]
      this.detailIsSpecialOrderOnly = filterStore.isSpecialOrderOnly

      this.snapshot = {
        statuses: [...filterStore.selectedStatuses],
        manufacturerIds: [...filterStore.selectedManufacturerIds],
        isSpecialOrderOnly: filterStore.isSpecialOrderOnly,
        search: useSearchStore().searchQuery || '',
        sortField: filterStore.sortField,
        sortOrder: filterStore.sortOrder,
      }

      // Fast path: reuse the rows the list already fetched — but only when
      // the current item is among them. A stale list cache that does not
      // contain this item falls through to a chunk fetch instead of seeding
      // an out-of-place window.
      const seeded = this.readListCache()
      const skuInSeed = seeded?.entries.some((entry) => entry.sku === this.currentSku) ?? false
      if (seeded && skuInSeed) {
        this.applyWindow(seeded)
        this.recomputeCursor()
        this.isBuilding = false
        this.maybePrefetch()
        return
      }

      // No usable list cache — fetch a single chunk around offset 0 to
      // bootstrap the window. Subsequent Next/Prev will pull adjacent
      // chunks via maybePrefetch.
      const chunk = await this.fetchChunk(0, CHUNK_SIZE)
      if (token !== buildToken) { return }
      if (!chunk) {
        this.reportNavError()
        this.applyWindow(this.buildEmptyWindow())
      } else {
        this.applyWindow({
          entries: chunk,
          windowStart: 0,
          totalCount: null,
          reachedEnd: chunk.length < CHUNK_SIZE,
        })
      }
      this.recomputeCursor()
      this.isBuilding = false
      this.maybePrefetch()
    },

    setDetailStatuses(values: string[]): void {
      this.detailStatuses = [...values]
      this.applyDetailFilters()
    },

    setDetailManufacturerIds(values: number[]): void {
      this.detailManufacturerIds = [...values]
      this.applyDetailFilters()
    },

    setDetailSpecialOrderOnly(value: boolean): void {
      this.detailIsSpecialOrderOnly = value
      this.applyDetailFilters()
    },

    clearDetailFilters(): void {
      this.detailStatuses = []
      this.detailManufacturerIds = []
      this.detailIsSpecialOrderOnly = false
      this.applyDetailFilters()
    },

    /**
     * Rebuilds the navigation window from the current detail filter. The
     * list filter and its data are never touched; this fetches just the
     * first chunk under the new filter and lets `maybePrefetch` extend the
     * window as the cursor moves.
     */
    async applyDetailFilters(): Promise<void> {
      if (!this.snapshot || !this.currentSku) { return }

      const nextSnapshot: NavSnapshot = {
        statuses: [...this.detailStatuses],
        manufacturerIds: [...this.detailManufacturerIds],
        isSpecialOrderOnly: this.detailIsSpecialOrderOnly,
        search: this.snapshot.search,
        sortField: this.snapshot.sortField,
        sortOrder: this.snapshot.sortOrder,
      }
      if (buildSnapshotKey(nextSnapshot) === buildSnapshotKey(this.snapshot)) { return }

      const token = ++buildToken
      this.isBuilding = true
      this.snapshot = nextSnapshot

      // Reset the window to row 0 under the new filter and load a single
      // chunk. When the focused sku doesn't appear in the chunk, the
      // cursor lands at position 0 (cursorInSet=false) — Next steps into
      // the filtered set; further chunks are pulled by maybePrefetch.
      const chunk = await this.fetchChunk(0, CHUNK_SIZE)
      if (token !== buildToken) { return }
      if (!chunk) {
        this.reportNavError()
        this.applyWindow(this.buildEmptyWindow())
      } else {
        this.applyWindow({
          entries: chunk,
          windowStart: 0,
          totalCount: null,
          reachedEnd: chunk.length < CHUNK_SIZE,
        })
      }
      this.recomputeCursor()
      this.isBuilding = false
      this.maybePrefetch()
    },

    /**
     * Appends the next forward chunk. No-op while one is already in flight.
     * `silent` suppresses the error toast — used for background prefetch.
     */
    async loadNextChunk(silent: boolean = true): Promise<void> {
      if (this.isPrefetching || !this.snapshot || !this.hasMoreForward) { return }

      const snapshotKey = buildSnapshotKey(this.snapshot)
      const offset = this.windowStart + this.entries.length
      this.isPrefetching = true
      const chunk = await this.fetchChunk(offset, CHUNK_SIZE)
      this.isPrefetching = false

      if (!this.snapshot || buildSnapshotKey(this.snapshot) !== snapshotKey) { return }
      if (!chunk) {
        if (!silent) { this.reportNavError() }
        return
      }
      this.entries = [...this.entries, ...chunk]
      if (chunk.length < CHUNK_SIZE) { this.reachedEnd = true }
      this.recomputeCursor()
    },

    /**
     * Prepends the previous chunk. No-op while one is already in flight.
     * `silent` suppresses the error toast — used for background prefetch.
     */
    async loadPreviousChunk(silent: boolean = true): Promise<void> {
      if (this.isPrefetching || !this.snapshot || this.windowStart <= 0) { return }

      const snapshotKey = buildSnapshotKey(this.snapshot)
      const offset = Math.max(0, this.windowStart - CHUNK_SIZE)
      const limit = this.windowStart - offset
      this.isPrefetching = true
      const chunk = await this.fetchChunk(offset, limit)
      this.isPrefetching = false

      if (!this.snapshot || buildSnapshotKey(this.snapshot) !== snapshotKey) { return }
      if (!chunk) {
        if (!silent) { this.reportNavError() }
        return
      }
      this.entries = [...chunk, ...this.entries]
      this.windowStart = offset
      // Prepending shifts every index; nudge a not-in-set cursor so it tracks.
      if (!this.cursorInSet) { this.cursorIndex += chunk.length }
      this.recomputeCursor()
    },

    /**
     * Seeds the window from the rows the list page already cached, so a
     * list → detail navigation costs zero API calls. Returns null when no
     * usable cache exists (expired, different sort, or different search).
     */
    readListCache(): NavWindow | null {
      const snapshot = this.snapshot
      if (!snapshot) { return null }

      const cached = useTableStateStore().getTableState(LIST_ROUTE)
      if (!cached || !cached.rows.length) { return null }
      if (cached.searchQuery !== snapshot.search) { return null }
      if (cached.sortField !== snapshot.sortField || cached.sortOrder !== snapshot.sortOrder) {
        return null
      }

      return {
        entries: cached.rows.map((row: Record<string, any>) => ({
          sku: row.sku,
          description: row.description ?? '',
        })),
        windowStart: 0,
        totalCount: cached.totalRecords,
        reachedEnd: !cached.hasMore,
      }
    },

    /** Fetches a lightweight (sku + description) chunk at an absolute offset. */
    async fetchChunk(offset: number, limit: number): Promise<NavEntry[] | null> {
      const snapshot = this.snapshot
      if (!snapshot || limit <= 0) { return null }

      const { fetchItems } = useItems()
      const { data, error } = await fetchItems({
        fields: ['sku', 'description'],
        sort: buildItemsSort(snapshot.sortField, snapshot.sortOrder),
        filter: buildItemsFilter(snapshot),
        search: snapshot.search || null,
        offset,
        limit,
      })
      if (error || !data) { return null }
      return data.map((row: Record<string, any>) => ({
        sku: row.sku,
        description: row.description ?? '',
      }))
    },

    /**
     * Fetches a tail chunk — `limit` items ending `offset` rows from the global
     * end — returned in forward (ascending) order. Implemented by querying the
     * REVERSED sort (so offset 0 yields the last rows) and reversing the page
     * back. Fetches the same lightweight sku + description as the forward window,
     * so a tail entry's tooltip shows its description just like a head entry's
     * (no sku/description mismatch between the two segments).
     */
    async fetchTailChunk(offset: number, limit: number): Promise<NavEntry[] | null> {
      const snapshot = this.snapshot
      if (!snapshot || limit <= 0) { return null }

      const { fetchItems } = useItems()
      const { data, error } = await fetchItems({
        fields: ['sku', 'description'],
        sort: reverseSort(buildItemsSort(snapshot.sortField, snapshot.sortOrder)),
        filter: buildItemsFilter(snapshot),
        search: snapshot.search || null,
        offset,
        limit,
      })
      if (error || !data) { return null }
      // Fetched in descending order; reverse the page into forward order.
      return data
        .map((row: Record<string, any>) => ({ sku: row.sku, description: row.description ?? '' }))
        .reverse()
    },

    /**
     * Seeds the tail from the rows the list page pre-warmed (the reversed-sort
     * background fetch stashed in `tableState`), so Previous on the first item is
     * instant — zero detail-page requests. Returns null when no usable pre-warm
     * exists (expired, or a different sort / search).
     */
    readListTailCache(): { entries: NavEntry[], reachedStart: boolean } | null {
      const snapshot = this.snapshot
      if (!snapshot) { return null }

      const cached = useTableStateStore().getTailState(LIST_ROUTE)
      if (!cached || !cached.rows.length) { return null }
      if (cached.searchQuery !== snapshot.search) { return null }
      if (cached.sortField !== snapshot.sortField || cached.sortOrder !== snapshot.sortOrder) {
        return null
      }

      return {
        entries: cached.rows.map((row: Record<string, any>) => ({
          sku: row.sku,
          description: row.description ?? '',
        })),
        reachedStart: cached.reachedStart,
      }
    },

    /**
     * Seeds the tail segment so Previous on the first item (and landing on /
     * navigating around the last item) is smooth instead of waiting on a fetch.
     * Prefers the list page's pre-warmed tail (zero requests); otherwise fetches
     * the last chunk under the reversed sort. No-op once the head holds the whole
     * sequence (`reachedEnd`) or the tail is already seeded. The fetch is dropped
     * if the snapshot changed while in flight.
     */
    async ensureTail(): Promise<void> {
      if (this.reachedEnd || this.tailEntries.length || !this.snapshot) { return }

      const seeded = this.readListTailCache()
      if (seeded) {
        this.tailEntries = seeded.entries
        this.tailReachedStart = seeded.reachedStart
        this.recomputeCursor()
        return
      }

      const snapshotKey = buildSnapshotKey(this.snapshot)
      const chunk = await this.fetchTailChunk(0, CHUNK_SIZE)
      if (!this.snapshot || buildSnapshotKey(this.snapshot) !== snapshotKey) { return }
      if (!chunk) { return }
      this.tailEntries = chunk
      if (chunk.length < CHUNK_SIZE) { this.tailReachedStart = true }
      this.recomputeCursor()
    },

    /**
     * Grows the tail backward by one chunk (older items) when the cursor nears
     * the tail's start, so backward navigation through the end stays smooth past
     * the first tail chunk. No-op while one is in flight or the tail already
     * reaches the global first item.
     */
    async loadMoreTail(): Promise<void> {
      if (this.isTailPrefetching || this.tailReachedStart || !this.snapshot) { return }
      if (!this.tailEntries.length) { return }

      const snapshotKey = buildSnapshotKey(this.snapshot)
      this.isTailPrefetching = true
      const chunk = await this.fetchTailChunk(this.tailEntries.length, CHUNK_SIZE)
      this.isTailPrefetching = false

      if (!this.snapshot || buildSnapshotKey(this.snapshot) !== snapshotKey) { return }
      if (!chunk) { return }
      // Older rows sort before the current tail — prepend them.
      this.tailEntries = [...chunk, ...this.tailEntries]
      if (chunk.length < CHUNK_SIZE) { this.tailReachedStart = true }
      this.recomputeCursor()
    },

    buildEmptyWindow(): NavWindow {
      return { entries: [], windowStart: 0, totalCount: 0, reachedEnd: true }
    },

    applyWindow(navWindow: NavWindow): void {
      this.entries = navWindow.entries
      this.windowStart = navWindow.windowStart
      this.totalCount = navWindow.totalCount
      this.reachedEnd = navWindow.reachedEnd
      // A rebuilt window belongs to a (possibly) new sequence — drop the tail so
      // `ensureTail` refetches it for the new filter/sort.
      this.tailEntries = []
      this.tailReachedStart = false
    },

    recomputeCursor(): void {
      const sku = this.currentSku
      const located = locateCursor(
        this.entries,
        this.tailEntries,
        (entry) => entry.sku === sku,
      )
      this.cursorIndex = located.cursorIndex
      this.cursorInSet = located.cursorInSet
      this.cursorTailIndex = located.cursorTailIndex
      this.cursorInTail = located.cursorInTail
    },

    /** Prefetches the adjacent chunk(s) when the cursor nears a segment edge. */
    maybePrefetch(): void {
      if (!this.snapshot) { return }

      // Seed the tail so Previous on the first item (and the wrap-around) is
      // ready, and grow it backward when the cursor nears the tail's start.
      // Independent of — and safe to run alongside — the forward prefetch.
      this.ensureTail()
      if (this.cursorInTail && this.cursorTailIndex <= PREFETCH_THRESHOLD) {
        this.loadMoreTail()
      }

      if (this.isPrefetching) { return }

      const aheadCount = this.entries.length - 1 - this.cursorIndex
      if (aheadCount <= PREFETCH_THRESHOLD && this.hasMoreForward) {
        this.loadNextChunk()
        return
      }
      if (this.cursorIndex <= PREFETCH_THRESHOLD && this.hasMoreBackward) {
        this.loadPreviousChunk()
      }
    },

    reportNavError(): void {
      this.navErrorMessage = NAV_ERROR_MESSAGE
      this.navErrorNonce += 1
    },
  },
})
