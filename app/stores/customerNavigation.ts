import { defineStore } from 'pinia'
import { useCustomerFilterStore } from '~/stores/customerFilter'
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'
import { useBusinessPartners } from '~/composables/useBusinessPartners'
import { buildCustomerSort } from '~/utils/buildCustomerSort'
import { canNavigate, locateCursor, resolveNeighbor, reverseSort } from '~/utils/navWindow'

// A list → detail navigation seeds its window from the rows the list already
// loaded; as the user navigates, the window is extended forward in fixed-size
// chunks rather than refetching the whole sequence.
const CHUNK_SIZE = 20

// When the focused customer sits within this many rows of either window edge,
// the adjacent chunk is fetched in the background so Next/Prev never blocks on
// a network round-trip. With a 20-row chunk this prefetches around row 17.
const PREFETCH_THRESHOLD = 3

const LIST_ROUTE = '/customers'

const NAV_ERROR_MESSAGE = 'Failed to load customer navigation. Please try again.'

/** A single Next/Prev waypoint — just enough to render and route. */
interface NavEntry {
  sapId: string
  name: string
}

/**
 * The filter + sort the current navigation window was built from. Decoupled
 * from the live list filter (`customerFilter`) on purpose: the detail page owns
 * an independent filter, so this is a frozen copy taken whenever the window is
 * (re)built.
 */
interface NavSnapshot {
  statuses: string[]
  accountManagerIds: string[]
  businessPartnerGroupIds: number[]
  isNationalAccountOnly: boolean
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

interface CustomerNavigationState {
  // Detail-page filter — editable, independent of the list filter
  detailStatuses: string[]
  detailAccountManagerIds: string[]
  detailBusinessPartnerGroupIds: number[]
  detailIsNationalAccountOnly: boolean

  snapshot: NavSnapshot | null
  // The loaded slice of the sequence, in order.
  entries: NavEntry[]
  // Absolute index of `entries[0]` within the full filtered dataset.
  windowStart: number
  // Exact total when known; null → use the "short chunk means end" heuristic.
  totalCount: number | null
  // True once a forward fetch returned fewer rows than requested.
  reachedEnd: boolean

  // Tail window — the last customers, mirror of the head
  // The end of the sequence, fetched under the reversed sort and grown backward
  // as the cursor nears it, so wrapping to / navigating around the last
  // customer is as smooth as the forward direction. `tailEntries` is in forward
  // order; empty until prefetched, and left empty once the head reaches the end
  // (`reachedEnd`, where `entries` already holds the tail).
  tailEntries: NavEntry[]
  // True once a reversed fetch returned a short chunk — the tail has reached the
  // global first customer.
  tailReachedStart: boolean

  // Cursor — where the focused customer sits in the two segments
  // The account_number of the customer currently shown on the detail page.
  currentSapId: string | null
  cursorIndex: number
  // False when the focused customer is not in `entries` (filtered out, or it
  // lives in the tail) — `cursorIndex` is then an insertion point.
  cursorInSet: boolean
  // Where the focused customer sits in `tailEntries`, when it lives there.
  cursorTailIndex: number
  cursorInTail: boolean

  // The next detail page is reached via Next/Prev when its account_number matches this.
  // Such an entry preserves the detail filter; any other entry rebuilds it.
  pendingInternalSapId: string | null

  isBuilding: boolean
  isPrefetching: boolean
  // Guards the tail (reversed) prefetch independently of the forward one, so
  // both segments can extend concurrently.
  isTailPrefetching: boolean

  // Error signalling — watched by the detail page to raise a toast
  navErrorMessage: string | null
  navErrorNonce: number
}

/** Serialises a snapshot so stale async results can be detected and dropped. */
function buildSnapshotKey(snapshot: NavSnapshot): string {
  return JSON.stringify({
    s: [...snapshot.statuses].sort(),
    m: [...snapshot.accountManagerIds].sort(),
    g: [...snapshot.businessPartnerGroupIds].sort((a, b) => a - b),
    n: snapshot.isNationalAccountOnly,
    q: snapshot.search,
    f: snapshot.sortField,
    o: snapshot.sortOrder,
  })
}

// Supersedes prior in-flight window builds — only the latest may commit.
let buildToken = 0

export const useCustomerNavigationStore = defineStore('customerNavigation', {
  state: (): CustomerNavigationState => ({
    detailStatuses: [],
    detailAccountManagerIds: [],
    detailBusinessPartnerGroupIds: [],
    detailIsNationalAccountOnly: false,
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
      + state.detailAccountManagerIds.length
      + state.detailBusinessPartnerGroupIds.length
      + (state.detailIsNationalAccountOnly ? 1 : 0),

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
    // customer, or the unused side of a single-other-customer set.
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

    /**
     * Entry point for every customer detail page load. When the customer was
     * reached via this toolbar's Next/Prev (an internal navigation), the detail
     * filter and its window are preserved and only the cursor moves. Any other
     * entry — from the list, a bookmark, a search — rebuilds the window and
     * resets the detail filter to mirror the list filter.
     */
    enterCustomer(sapId: string): void {
      const isInternalNavigation = this.pendingInternalSapId === sapId
      this.pendingInternalSapId = null
      this.currentSapId = sapId

      if (isInternalNavigation && this.snapshot && this.entries.length > 0) {
        // Next/Prev within the current detail-filtered window — keep the
        // filter and window, only move the cursor.
        this.recomputeCursor()
        this.maybePrefetch()
        return
      }

      this.rebuildForFreshEntry()
    },

    /**
     * Flags the next detail-page load as a Next/Prev navigation, so it keeps
     * the current detail filter instead of resetting it. Called by the toolbar
     * immediately before routing.
     */
    markInternalNavigation(sapId: string): void {
      this.pendingInternalSapId = sapId
    },

    /**
     * Rebuilds the navigation window for a fresh detail-page entry. Resets the
     * detail filter to mirror the list filter, then either seeds the window
     * from the rows the list already loaded (zero API calls) or loads the full
     * sequence.
     */
    async rebuildForFreshEntry(): Promise<void> {
      const token = ++buildToken
      this.isBuilding = true

      const filterStore = useCustomerFilterStore()
      // The detail filter is a per-visit scratch space: it starts as a copy of
      // the list filter, then diverges independently from there.
      this.detailStatuses = [...filterStore.selectedStatuses]
      this.detailAccountManagerIds = [...filterStore.selectedAccountManagerIds]
      this.detailBusinessPartnerGroupIds = [...filterStore.selectedBusinessPartnerGroupIds]
      this.detailIsNationalAccountOnly = filterStore.isNationalAccountOnly

      this.snapshot = {
        statuses: [...filterStore.selectedStatuses],
        accountManagerIds: [...filterStore.selectedAccountManagerIds],
        businessPartnerGroupIds: [...filterStore.selectedBusinessPartnerGroupIds],
        isNationalAccountOnly: filterStore.isNationalAccountOnly,
        search: useSearchStore().searchQuery || '',
        sortField: filterStore.sortField,
        sortOrder: filterStore.sortOrder,
      }

      // Fast path: reuse the rows the list already fetched — but only when the
      // current customer is genuinely among them. A direct URL entry can leave
      // a stale list cache that does not contain this customer; that falls
      // through to a full fetch instead of seeding an out-of-place window.
      const seeded = this.readListCache()
      const sapInSeed = seeded?.entries.some((entry) => entry.sapId === this.currentSapId) ?? false
      if (seeded && sapInSeed) {
        this.applyWindow(seeded)
        this.recomputeCursor()
        this.isBuilding = false
        this.maybePrefetch()
        return
      }

      // No usable list cache (direct entry) — load the full filtered sequence.
      const navWindow = await this.loadFullSequence()
      if (token !== buildToken) { return }
      if (!navWindow) { this.reportNavError() }
      this.applyWindow(navWindow ?? this.buildEmptyWindow())
      this.recomputeCursor()
      this.isBuilding = false
      this.maybePrefetch()
    },

    // Public: detail-page filter
    // Each setter rebuilds the navigation window immediately, so the result
    // set updates the moment a filter option is toggled.

    setDetailStatuses(values: string[]): void {
      this.detailStatuses = [...values]
      this.applyDetailFilters()
    },

    setDetailAccountManagerIds(values: string[]): void {
      this.detailAccountManagerIds = [...values]
      this.applyDetailFilters()
    },

    setDetailBusinessPartnerGroupIds(values: number[]): void {
      this.detailBusinessPartnerGroupIds = [...values]
      this.applyDetailFilters()
    },

    setDetailNationalAccountOnly(value: boolean): void {
      this.detailIsNationalAccountOnly = value
      this.applyDetailFilters()
    },

    clearDetailFilters(): void {
      this.detailStatuses = []
      this.detailAccountManagerIds = []
      this.detailBusinessPartnerGroupIds = []
      this.detailIsNationalAccountOnly = false
      this.applyDetailFilters()
    },

    /**
     * Rebuilds the navigation window from the current detail filter. The list
     * filter and its data are never touched; this fires its own request scoped
     * to the detail filter, then re-locates the focused customer within the new
     * result set. A no-op when the filter has not actually changed.
     */
    async applyDetailFilters(): Promise<void> {
      if (!this.snapshot || !this.currentSapId) { return }

      const nextSnapshot: NavSnapshot = {
        statuses: [...this.detailStatuses],
        accountManagerIds: [...this.detailAccountManagerIds],
        businessPartnerGroupIds: [...this.detailBusinessPartnerGroupIds],
        isNationalAccountOnly: this.detailIsNationalAccountOnly,
        search: this.snapshot.search,
        sortField: this.snapshot.sortField,
        sortOrder: this.snapshot.sortOrder,
      }
      if (buildSnapshotKey(nextSnapshot) === buildSnapshotKey(this.snapshot)) { return }

      const token = ++buildToken
      this.isBuilding = true
      this.snapshot = nextSnapshot

      const navWindow = await this.loadFullSequence()
      if (token !== buildToken) { return }
      if (!navWindow) { this.reportNavError() }
      this.applyWindow(navWindow ?? this.buildEmptyWindow())
      this.recomputeCursor()
      this.isBuilding = false
      this.maybePrefetch()
    },

    // Public: chunk loaders (extend a seeded window)

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
          sapId: row.account_number,
          name: row.name,
        })),
        windowStart: 0,
        totalCount: cached.totalRecords,
        reachedEnd: !cached.hasMore,
      }
    },

    /**
     * Loads the full filtered + sorted sequence (account_number + name only). Used on
     * direct entry and whenever the detail filter changes — Directus cannot
     * rank string fields server-side, so an exact position cannot be derived
     * without the full ordered list.
     *
     * Issued as an unlimited (`limit: -1`) request with no `page` parameter;
     * `fetchBusinessPartners` omits pagination for unlimited queries, since
     * `page` alongside `limit: -1` returns an empty set. Returns null on
     * failure; the caller decides whether to surface it (stale builds stay
     * silent).
     */
    async loadFullSequence(): Promise<NavWindow | null> {
      const snapshot = this.snapshot
      if (!snapshot) { return null }

      const { fetchBusinessPartners } = useBusinessPartners()
      const { data, error } = await fetchBusinessPartners({
        relationshipType: 'customer',
        fields: ['account_number', 'name'],
        sort: buildCustomerSort(snapshot.sortField, snapshot.sortOrder),
        statusValues: snapshot.statuses.length ? snapshot.statuses : null,
        accountManagerIds: snapshot.accountManagerIds.length ? snapshot.accountManagerIds : null,
        businessPartnerGroupIds: snapshot.businessPartnerGroupIds.length
          ? snapshot.businessPartnerGroupIds
          : null,
        isNationalAccountOnly: snapshot.isNationalAccountOnly,
        search: snapshot.search || null,
        // Keep not-yet-synced customers (null account_number) out of the Next/Prev
        // sequence — they can't be routed to and sort to the end.
        requireSapId: true,
        limit: -1,
      })
      if (error || !data) { return null }

      const entries: NavEntry[] = data.map((row: Record<string, any>) => ({
        sapId: row.account_number,
        name: row.name,
      }))
      return {
        entries,
        windowStart: 0,
        totalCount: entries.length,
        reachedEnd: true,
      }
    },

    /** Fetches a lightweight (account_number + name) chunk at an absolute offset. */
    async fetchChunk(offset: number, limit: number): Promise<NavEntry[] | null> {
      const snapshot = this.snapshot
      if (!snapshot || limit <= 0) { return null }

      const { fetchBusinessPartners } = useBusinessPartners()
      const { data, error } = await fetchBusinessPartners({
        relationshipType: 'customer',
        fields: ['account_number', 'name'],
        sort: buildCustomerSort(snapshot.sortField, snapshot.sortOrder),
        statusValues: snapshot.statuses.length ? snapshot.statuses : null,
        accountManagerIds: snapshot.accountManagerIds.length ? snapshot.accountManagerIds : null,
        businessPartnerGroupIds: snapshot.businessPartnerGroupIds.length
          ? snapshot.businessPartnerGroupIds
          : null,
        isNationalAccountOnly: snapshot.isNationalAccountOnly,
        search: snapshot.search || null,
        requireSapId: true,
        offset,
        limit,
      })
      if (error || !data) { return null }
      return data.map((row: Record<string, any>) => ({ sapId: row.account_number, name: row.name }))
    },

    /**
     * Fetches a tail chunk — `limit` customers ending `offset` rows from the
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
        relationshipType: 'customer',
        fields: ['account_number', 'name'],
        sort: reverseSort(buildCustomerSort(snapshot.sortField, snapshot.sortOrder)),
        statusValues: snapshot.statuses.length ? snapshot.statuses : null,
        accountManagerIds: snapshot.accountManagerIds.length ? snapshot.accountManagerIds : null,
        businessPartnerGroupIds: snapshot.businessPartnerGroupIds.length
          ? snapshot.businessPartnerGroupIds
          : null,
        isNationalAccountOnly: snapshot.isNationalAccountOnly,
        search: snapshot.search || null,
        // Under the reversed sort, null-account_number customers sort to the front and
        // would become the Prev-wrap target — exclude them.
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
     * customer is instant — zero detail-page requests. Returns null when no
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
     * Seeds the tail segment so Previous on the first customer (and landing on /
     * navigating around the last customer) is smooth instead of waiting on a
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
     * Grows the tail backward by one chunk (older customers) when the cursor
     * nears the tail's start, so backward navigation through the end stays
     * smooth past the first tail chunk. No-op while one is in flight or the tail
     * already reaches the global first customer.
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

    /**
     * Recomputes where the focused customer sits across the head and tail
     * segments. Prefers an exact head match; falls back to the tail; when in
     * neither (e.g. filtered out) the cursor falls to the front so Next steps
     * into the filtered set.
     */
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

    /** Prefetches the adjacent chunk(s) when the cursor nears a segment edge. */
    maybePrefetch(): void {
      if (!this.snapshot) { return }

      // Seed the tail so Previous on the first customer (and the wrap-around)
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

    /** Flags a navigation fetch failure for the detail page to surface. */
    reportNavError(): void {
      this.navErrorMessage = NAV_ERROR_MESSAGE
      this.navErrorNonce += 1
    },
  },
})
