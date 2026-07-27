import { defineStore } from 'pinia'
import { useSuppliersFilterStore } from '~/stores/suppliersFilter'
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'
import { useBusinessPartners } from '~/composables/useBusinessPartners'
import { canNavigate, locateCursor, resolveNeighbor, reverseSort } from '~/utils/navWindow'

// Detail-page Next/Prev sequence for the suppliers section. Mirrors
// `customerNavigation.ts` (which see for the full design rationale) — the
// list-page filters are snapshotted on entry, the user can re-scope the
// sequence from the detail toolbar without disturbing the list, and the
// window is extended forward in 20-row chunks.

const CHUNK_SIZE = 20

const PREFETCH_THRESHOLD = 3

const LIST_ROUTE = '/suppliers'

const NAV_ERROR_MESSAGE = 'Failed to load supplier navigation. Please try again.'

interface NavEntry {
  sapId: string
  name: string
}

interface NavSnapshot {
  statuses: string[]
  businessPartnerGroupIds: number[]
  manufacturerIds: number[]
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

interface SuppliersNavigationState {
  detailStatuses: string[]
  detailBusinessPartnerGroupIds: number[]
  detailManufacturerIds: number[]

  snapshot: NavSnapshot | null
  entries: NavEntry[]
  windowStart: number
  totalCount: number | null
  reachedEnd: boolean

  // Tail window — the last suppliers, fetched under the reversed sort and grown
  // backward as the cursor nears it, so wrapping to / navigating around the
  // last supplier is as smooth as the forward direction. Forward order; empty
  // until prefetched and while the head holds the whole sequence (`reachedEnd`).
  tailEntries: NavEntry[]
  tailReachedStart: boolean

  currentSapId: string | null
  cursorIndex: number
  cursorInSet: boolean
  cursorTailIndex: number
  cursorInTail: boolean

  pendingInternalSapId: string | null

  isBuilding: boolean
  isPrefetching: boolean
  isTailPrefetching: boolean

  navErrorMessage: string | null
  navErrorNonce: number
}

function buildSnapshotKey(snapshot: NavSnapshot): string {
  return JSON.stringify({
    s: [...snapshot.statuses].sort(),
    g: [...snapshot.businessPartnerGroupIds].sort((a, b) => a - b),
    m: [...snapshot.manufacturerIds].sort((a, b) => a - b),
    q: snapshot.search,
    f: snapshot.sortField,
    o: snapshot.sortOrder,
  })
}

function buildSuppliersSort(sortField: string | null, sortOrder: number = 1): string[] {
  const primaryField = sortField || 'account_number'
  const primaryToken = sortOrder === -1 ? `-${primaryField}` : primaryField
  if (primaryField === 'account_number') { return [primaryToken] }
  return [primaryToken, 'account_number']
}

let buildToken = 0

export const useSuppliersNavigationStore = defineStore('suppliersNavigation', {
  state: (): SuppliersNavigationState => ({
    detailStatuses: [],
    detailBusinessPartnerGroupIds: [],
    detailManufacturerIds: [],
    snapshot: null,
    entries: [],
    windowStart: 0,
    totalCount: null,
    reachedEnd: false,
    tailEntries: [],
    tailReachedStart: false,
    currentSapId: null,
    cursorIndex: 0,
    cursorInSet: false,
    cursorTailIndex: -1,
    cursorInTail: false,
    pendingInternalSapId: null,
    isBuilding: true,
    isPrefetching: false,
    isTailPrefetching: false,
    navErrorMessage: null,
    navErrorNonce: 0,
  }),

  getters: {
    detailFilterCount: (state): number =>
      state.detailStatuses.length
      + state.detailBusinessPartnerGroupIds.length
      + state.detailManufacturerIds.length,

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
    // supplier, or the unused side of a single-other-supplier set.
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
    enterSupplier(sapId: string): void {
      const isInternalNavigation = this.pendingInternalSapId === sapId
      this.pendingInternalSapId = null
      this.currentSapId = sapId

      if (isInternalNavigation && this.snapshot && this.entries.length > 0) {
        this.recomputeCursor()
        this.maybePrefetch()
        return
      }

      this.rebuildForFreshEntry()
    },

    markInternalNavigation(sapId: string): void {
      this.pendingInternalSapId = sapId
    },

    async rebuildForFreshEntry(): Promise<void> {
      const token = ++buildToken
      this.isBuilding = true

      const filterStore = useSuppliersFilterStore()
      this.detailStatuses = [...filterStore.selectedStatuses]
      this.detailBusinessPartnerGroupIds = [...filterStore.selectedBusinessPartnerGroupIds]
      this.detailManufacturerIds = [...filterStore.selectedManufacturerIds]

      this.snapshot = {
        statuses: [...filterStore.selectedStatuses],
        businessPartnerGroupIds: [...filterStore.selectedBusinessPartnerGroupIds],
        manufacturerIds: [...filterStore.selectedManufacturerIds],
        search: useSearchStore().searchQuery || '',
        sortField: filterStore.sortField,
        sortOrder: filterStore.sortOrder,
      }

      const seeded = this.readListCache()
      const sapInSeed = seeded?.entries.some((entry) => entry.sapId === this.currentSapId) ?? false
      if (seeded && sapInSeed) {
        this.applyWindow(seeded)
        this.recomputeCursor()
        this.isBuilding = false
        this.maybePrefetch()
        return
      }

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

    setDetailBusinessPartnerGroupIds(values: number[]): void {
      this.detailBusinessPartnerGroupIds = [...values]
      this.applyDetailFilters()
    },

    setDetailManufacturerIds(values: number[]): void {
      this.detailManufacturerIds = [...values]
      this.applyDetailFilters()
    },

    clearDetailFilters(): void {
      this.detailStatuses = []
      this.detailBusinessPartnerGroupIds = []
      this.detailManufacturerIds = []
      this.applyDetailFilters()
    },

    async applyDetailFilters(): Promise<void> {
      if (!this.snapshot || !this.currentSapId) { return }

      const nextSnapshot: NavSnapshot = {
        statuses: [...this.detailStatuses],
        businessPartnerGroupIds: [...this.detailBusinessPartnerGroupIds],
        manufacturerIds: [...this.detailManufacturerIds],
        search: this.snapshot.search,
        sortField: this.snapshot.sortField,
        sortOrder: this.snapshot.sortOrder,
      }
      if (buildSnapshotKey(nextSnapshot) === buildSnapshotKey(this.snapshot)) { return }

      const token = ++buildToken
      this.isBuilding = true
      this.snapshot = nextSnapshot

      // Reset the window to row 0 under the new filter and load a single
      // chunk. When the focused account_number doesn't appear in the chunk, the
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
      if (!this.cursorInSet) { this.cursorIndex += chunk.length }
      this.recomputeCursor()
    },

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
          sapId: row.account_number,
          name: row.name ?? '',
        })),
        windowStart: 0,
        totalCount: cached.totalRecords,
        reachedEnd: !cached.hasMore,
      }
    },

    async fetchChunk(offset: number, limit: number): Promise<NavEntry[] | null> {
      const snapshot = this.snapshot
      if (!snapshot || limit <= 0) { return null }

      const { fetchBusinessPartners } = useBusinessPartners()
      const { data, error } = await fetchBusinessPartners({
        relationshipType: 'supplier',
        fields: ['account_number', 'name'],
        sort: buildSuppliersSort(snapshot.sortField, snapshot.sortOrder),
        statusValues: snapshot.statuses.length ? snapshot.statuses : null,
        businessPartnerGroupIds: snapshot.businessPartnerGroupIds.length
          ? snapshot.businessPartnerGroupIds
          : null,
        manufacturerIds: snapshot.manufacturerIds.length ? snapshot.manufacturerIds : null,
        search: snapshot.search || null,
        // Not-yet-synced suppliers (null account_number) can't be a Next/Prev target
        // (/suppliers/null) and sort to the end — keep them out of the sequence.
        requireSapId: true,
        offset,
        limit,
      })
      if (error || !data) { return null }
      return data.map((row: Record<string, any>) => ({ sapId: row.account_number, name: row.name ?? '' }))
    },

    /**
     * Fetches a tail chunk — `limit` suppliers ending `offset` rows from the
     * global end — returned in forward (ascending) order. Implemented by
     * querying the REVERSED sort (so offset 0 yields the last rows) and
     * reversing the page back. Fetches the same lightweight id + name as the
     * forward window, so a tail entry's tooltip shows its name just like a head
     * entry's (no id/name mismatch between the two segments).
     */
    async fetchTailChunk(offset: number, limit: number): Promise<NavEntry[] | null> {
      const snapshot = this.snapshot
      if (!snapshot || limit <= 0) { return null }

      const { fetchBusinessPartners } = useBusinessPartners()
      const { data, error } = await fetchBusinessPartners({
        relationshipType: 'supplier',
        fields: ['account_number', 'name'],
        sort: reverseSort(buildSuppliersSort(snapshot.sortField, snapshot.sortOrder)),
        statusValues: snapshot.statuses.length ? snapshot.statuses : null,
        businessPartnerGroupIds: snapshot.businessPartnerGroupIds.length
          ? snapshot.businessPartnerGroupIds
          : null,
        manufacturerIds: snapshot.manufacturerIds.length ? snapshot.manufacturerIds : null,
        search: snapshot.search || null,
        // Exclude not-yet-synced suppliers — under the reversed sort they'd sort
        // to the FRONT and become the Prev-wrap target with a null account_number.
        requireSapId: true,
        offset,
        limit,
      })
      if (error || !data) { return null }
      // Fetched in descending order; reverse the page into forward order.
      return data
        .map((row: Record<string, any>) => ({ sapId: row.account_number, name: row.name ?? '' }))
        .reverse()
    },

    /**
     * Seeds the tail from the rows the list page pre-warmed (the reversed-sort
     * background fetch stashed in `tableState`), so Previous on the first
     * supplier is instant — zero detail-page requests. Returns null when no
     * usable pre-warm exists (expired, or a different sort / search).
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
        // Drop pre-warmed rows with no account_number — they can't be a Prev target and
        // would otherwise sit at the tail's end as an unroutable wrap target.
        entries: cached.rows
          .filter((row: Record<string, any>) => row.account_number)
          .map((row: Record<string, any>) => ({
            sapId: row.account_number,
            name: row.name ?? '',
          })),
        reachedStart: cached.reachedStart,
      }
    },

    /**
     * Seeds the tail segment so Previous on the first supplier (and landing on /
     * navigating around the last supplier) is smooth instead of waiting on a
     * fetch. Prefers the list page's pre-warmed tail (zero requests); otherwise
     * fetches the last chunk under the reversed sort. No-op once the head holds
     * the whole sequence (`reachedEnd`) or the tail is already seeded. The fetch
     * is dropped if the snapshot changed while in flight.
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
     * Grows the tail backward by one chunk (older suppliers) when the cursor
     * nears the tail's start, so backward navigation through the end stays
     * smooth past the first tail chunk. No-op while one is in flight or the tail
     * already reaches the global first supplier.
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
      const sapId = this.currentSapId
      const located = locateCursor(
        this.entries,
        this.tailEntries,
        (entry) => entry.sapId === sapId,
      )
      this.cursorIndex = located.cursorIndex
      this.cursorInSet = located.cursorInSet
      this.cursorTailIndex = located.cursorTailIndex
      this.cursorInTail = located.cursorInTail
    },

    maybePrefetch(): void {
      if (!this.snapshot) { return }

      // Seed the tail so Previous on the first supplier (and the wrap-around) is
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
