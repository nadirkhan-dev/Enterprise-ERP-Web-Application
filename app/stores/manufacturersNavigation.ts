import { defineStore } from 'pinia'
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'
import { useManufacturers } from '~/composables/useManufacturers'
import { canNavigate, locateCursor, resolveNeighbor, reverseSort } from '~/utils/navWindow'

// Detail-page Next/Prev sequence for the manufacturers section. Mirrors
// `customerNavigation.ts` (which see for the full design rationale).
// Manufacturers have no list-level filters, so this is the simplest variant:
// just sort + search shape the sequence.

const CHUNK_SIZE = 20

const PREFETCH_THRESHOLD = 3

const LIST_ROUTE = '/manufacturers'

const NAV_ERROR_MESSAGE = 'Failed to load manufacturer navigation. Please try again.'

const DEFAULT_SORT_FIELD = 'name'
const DEFAULT_SORT_ORDER = 1

interface NavEntry {
  id: string
  name: string
}

interface NavSnapshot {
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

interface ManufacturersNavigationState {
  snapshot: NavSnapshot | null
  entries: NavEntry[]
  windowStart: number
  totalCount: number | null
  reachedEnd: boolean

  // Tail window — the last manufacturers, fetched under the reversed sort and
  // grown backward as the cursor nears it, so wrapping to / navigating around
  // the last manufacturer is as smooth as the forward direction. Forward order;
  // empty until prefetched and while the head holds the whole sequence.
  tailEntries: NavEntry[]
  tailReachedStart: boolean

  currentId: string | null
  cursorIndex: number
  cursorInSet: boolean
  cursorTailIndex: number
  cursorInTail: boolean

  pendingInternalId: string | null

  isBuilding: boolean
  isPrefetching: boolean
  isTailPrefetching: boolean

  navErrorMessage: string | null
  navErrorNonce: number
}

function buildSnapshotKey(snapshot: NavSnapshot): string {
  return JSON.stringify({
    q: snapshot.search,
    f: snapshot.sortField,
    o: snapshot.sortOrder,
  })
}

function buildManufacturersSort(sortField: string | null, sortOrder: number = 1): string[] {
  const primaryField = sortField || DEFAULT_SORT_FIELD
  const primaryToken = sortOrder === -1 ? `-${primaryField}` : primaryField
  if (primaryField === 'id') { return [primaryToken] }
  return [primaryToken, 'id']
}

let buildToken = 0

export const useManufacturersNavigationStore = defineStore('manufacturersNavigation', {
  state: (): ManufacturersNavigationState => ({
    snapshot: null,
    entries: [],
    windowStart: 0,
    totalCount: null,
    reachedEnd: false,
    tailEntries: [],
    tailReachedStart: false,
    currentId: null,
    cursorIndex: 0,
    cursorInSet: false,
    cursorTailIndex: -1,
    cursorInTail: false,
    pendingInternalId: null,
    isBuilding: true,
    isPrefetching: false,
    isTailPrefetching: false,
    navErrorMessage: null,
    navErrorNonce: 0,
  }),

  getters: {
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
    // manufacturer, or the unused side of a single-other-manufacturer set.
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
    enterManufacturer(id: string): void {
      const isInternalNavigation = this.pendingInternalId === id
      this.pendingInternalId = null
      this.currentId = id

      if (isInternalNavigation && this.snapshot && this.entries.length > 0) {
        this.recomputeCursor()
        this.maybePrefetch()
        return
      }

      this.rebuildForFreshEntry()
    },

    markInternalNavigation(id: string): void {
      this.pendingInternalId = id
    },

    async rebuildForFreshEntry(): Promise<void> {
      const token = ++buildToken
      this.isBuilding = true

      this.snapshot = {
        search: useSearchStore().searchQuery || '',
        sortField: DEFAULT_SORT_FIELD,
        sortOrder: DEFAULT_SORT_ORDER,
      }

      const seeded = this.readListCache()
      const idInSeed = seeded?.entries.some((entry) => entry.id === this.currentId) ?? false
      if (seeded && idInSeed) {
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
          id: String(row.id),
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

      const { fetchManufacturers } = useManufacturers()
      const { data, error } = await fetchManufacturers({
        fields: ['id', 'name'],
        sort: buildManufacturersSort(snapshot.sortField, snapshot.sortOrder),
        search: snapshot.search || null,
        offset,
        limit,
      })
      if (error || !data) { return null }
      return data.map((row: Record<string, any>) => ({
        id: String(row.id),
        name: row.name ?? '',
      }))
    },

    /**
     * Fetches a tail chunk — `limit` manufacturers ending `offset` rows from the
     * global end — returned in forward (ascending) order. Implemented by
     * querying the REVERSED sort (so offset 0 yields the last rows) and
     * reversing the page back. Fetches the same lightweight id + name as the
     * forward window, so a tail entry's tooltip shows its name just like a head
     * entry's (no id/name mismatch between the two segments).
     */
    async fetchTailChunk(offset: number, limit: number): Promise<NavEntry[] | null> {
      const snapshot = this.snapshot
      if (!snapshot || limit <= 0) { return null }

      const { fetchManufacturers } = useManufacturers()
      const { data, error } = await fetchManufacturers({
        fields: ['id', 'name'],
        sort: reverseSort(buildManufacturersSort(snapshot.sortField, snapshot.sortOrder)),
        search: snapshot.search || null,
        offset,
        limit,
      })
      if (error || !data) { return null }
      // Fetched in descending order; reverse the page into forward order.
      return data
        .map((row: Record<string, any>) => ({ id: String(row.id), name: row.name ?? '' }))
        .reverse()
    },

    /**
     * Seeds the tail from the rows the list page pre-warmed (the reversed-sort
     * background fetch stashed in `tableState`), so Previous on the first
     * manufacturer is instant — zero detail-page requests. Returns null when no
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
        entries: cached.rows.map((row: Record<string, any>) => ({
          id: String(row.id),
          name: row.name ?? '',
        })),
        reachedStart: cached.reachedStart,
      }
    },

    /**
     * Seeds the tail segment so Previous on the first manufacturer (and landing
     * on / navigating around the last manufacturer) is smooth instead of waiting
     * on a fetch. Prefers the list page's pre-warmed tail (zero requests);
     * otherwise fetches the last chunk under the reversed sort. No-op once the
     * head holds the whole sequence (`reachedEnd`) or the tail is already seeded.
     * The fetch is dropped if the snapshot changed while in flight.
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
     * Grows the tail backward by one chunk (older manufacturers) when the cursor
     * nears the tail's start, so backward navigation through the end stays
     * smooth past the first tail chunk. No-op while one is in flight or the tail
     * already reaches the global first manufacturer.
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
      const id = this.currentId
      const located = locateCursor(
        this.entries,
        this.tailEntries,
        (entry) => entry.id === id,
      )
      this.cursorIndex = located.cursorIndex
      this.cursorInSet = located.cursorInSet
      this.cursorTailIndex = located.cursorTailIndex
      this.cursorInTail = located.cursorInTail
    },

    maybePrefetch(): void {
      if (!this.snapshot) { return }

      // Seed the tail so Previous on the first manufacturer (and the wrap-around)
      // is ready, and grow it backward when the cursor nears the tail's start.
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
