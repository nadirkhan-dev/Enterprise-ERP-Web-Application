// Shared Next/Prev resolution for the detail-page navigation stores
// (`customerNavigation`, `itemsNavigation`, `suppliersNavigation`,
// `manufacturersNavigation`). Those stores load the filtered + sorted sequence
// as TWO windows that grow toward each other, and this module turns them into
// the circular (wrap-around) Next/Prev behaviour and button states, so the four
// near-identical stores share one audited implementation of the edge cases.
//
// Two segments, both prefetched in the background so navigation never waits on a
// round-trip near either edge:
//   • HEAD (`entries`) — grows FORWARD from the global first entity in 20-row
//     chunks as the user moves Next. `entries[0]` is always the first entity of
//     the filtered set (the head stays anchored at the global start).
//   • TAIL (`tailEntries`) — the mirror image: the last rows of the sequence,
//     fetched under the REVERSED sort and grown BACKWARD as the user moves Prev
//     near the end. `tailEntries[len - 1]` is always the last entity.
//
// For a small set the head simply reaches the end (`reachedEnd`) and holds
// everything; the tail is then unused. For a large set the two segments stay
// disjoint with an unloaded gap in the middle, and the cursor sits in whichever
// segment contains the current entity. The wrap-around hops between the two
// segments' outer ends: Next on the last entity → head[0]; Previous on the
// first entity → tail[last].

/** Just enough of the two-segment window's state to resolve Next/Prev. */
export interface NavWindowView<TEntry> {
  // Head segment (forward, anchored at the global first entity)
  entries: TEntry[]
  // Where the focused entity sits in `entries`; an insertion point when the
  // focused entity is in neither segment (`cursorInSet === false`).
  cursorIndex: number
  cursorInSet: boolean
  // True once a forward fetch returned a short chunk — `entries` holds the
  // whole sequence and the tail is unused.
  reachedEnd: boolean

  // Tail segment (the last rows, grown backward under the reversed sort)
  tailEntries: TEntry[]
  // Where the focused entity sits in `tailEntries` when it lives in the tail.
  cursorTailIndex: number
  cursorInTail: boolean
  // True once a reversed fetch returned a short chunk — the tail has grown all
  // the way back to the global first entity (`tailEntries[0]` is that entity).
  tailReachedStart: boolean

  // Exact size of the filtered set when known; null falls back to a heuristic.
  totalCount: number | null
}

/**
 * Total entities in the active filtered set, or null when the exact total
 * isn't known yet because more rows exist beyond the loaded segments (which,
 * for navigation purposes, always means "many" — comfortably more than one).
 */
export function getNavigableCount<TEntry>(view: NavWindowView<TEntry>): number | null {
  if (view.totalCount != null) { return view.totalCount }
  if (view.reachedEnd) { return view.entries.length }
  return null
}

/**
 * Entities reachable FROM the current one — the navigable count minus the
 * current entity itself when it is part of the set (in either segment). This
 * single figure drives both the disabled state and the wrap behaviour:
 *
 *   0    → nowhere to go: an empty filtered set, or the lone current entity.
 *          BOTH chevrons are disabled.
 *   1    → exactly one other entity. It is shown on ONE side only (the side
 *          matching its sort position) — never as both Prev and Next.
 *   ≥ 2  → circular navigation: both sides live, with wrap-around at the ends.
 *   null → many (exact total not yet known) — treated like the ≥ 2 case.
 */
export function getOtherCount<TEntry>(view: NavWindowView<TEntry>): number | null {
  const total = getNavigableCount(view)
  if (total == null) { return null }
  const cursorInSequence = view.cursorInSet || view.cursorInTail
  return cursorInSequence ? total - 1 : total
}

/**
 * Resolves the circular Next (`direction = 1`) / Previous (`direction = -1`)
 * target from the two loaded segments.
 *
 * Returns null when there is no target to route to on this side right now:
 *  • the set is empty or holds only the current entity (`otherCount === 0`);
 *  • exactly one other entity exists and it belongs on the opposite side
 *    (see `resolveLoneOther`);
 *  • the next/wrap target isn't loaded yet — the caller grows the relevant
 *    segment (a forward chunk, or a backward tail chunk) and re-reads.
 */
export function resolveNeighbor<TEntry>(
  view: NavWindowView<TEntry>,
  direction: 1 | -1,
): TEntry | null {
  const otherCount = getOtherCount(view)

  // Edge case — empty set or the lone current entity: nothing on either side.
  if (otherCount === 0) { return null }

  // Edge case — a single other entity: shown on one side only. Only reachable
  // for a fully-loaded set (`reachedEnd`), so it lives entirely in the head.
  if (otherCount === 1) { return resolveLoneOther(view, direction) }

  // Two or more others → full circular navigation, both sides live.
  return direction === 1 ? resolveNext(view) : resolvePrevious(view)
}

function resolveNext<TEntry>(view: NavWindowView<TEntry>): TEntry | null {
  const { entries, tailEntries, reachedEnd } = view

  if (view.cursorInTail) {
    const index = view.cursorTailIndex + 1
    if (index < tailEntries.length) { return tailEntries[index] ?? null }
    // At the global last entity → wrap to the global first (head is anchored
    // at the start, so `entries[0]` is always the first entity).
    return entries[0] ?? null
  }

  // In the head (or filtered out, where `cursorIndex` is the insertion point so
  // the row already sitting there is the one after the current entity).
  const index = view.cursorInSet ? view.cursorIndex + 1 : view.cursorIndex
  if (index < entries.length) { return entries[index] ?? null }
  // Past the head's loaded end. If the head holds the whole sequence, Next on
  // the last entity wraps to the first; otherwise more rows exist and the
  // caller loads the next forward chunk before re-reading.
  return reachedEnd ? (entries[0] ?? null) : null
}

function resolvePrevious<TEntry>(view: NavWindowView<TEntry>): TEntry | null {
  const { entries, tailEntries, reachedEnd } = view

  if (view.cursorInTail) {
    const index = view.cursorTailIndex - 1
    if (index >= 0) { return tailEntries[index] ?? null }
    // At the tail's loaded start. If the tail has grown back to the global
    // first entity, this IS that entity → Previous wraps to the global last
    // (the tail's far end). Otherwise older rows exist and the caller grows the
    // tail backward before re-reading.
    if (view.tailReachedStart) { return tailEntries[tailEntries.length - 1] ?? null }
    return null
  }

  // In the head (or filtered out at the front).
  const index = view.cursorIndex - 1
  if (index >= 0) { return entries[index] ?? null }
  // At the global head: Previous wraps to the last entity. Once the head holds
  // the whole sequence it's the head's last row; otherwise it's the tail's far
  // end (null until the tail prefetch lands, so the button fills in then).
  if (reachedEnd) { return entries[entries.length - 1] ?? null }
  return tailEntries[tailEntries.length - 1] ?? null
}

/**
 * The single-other-entity edge case. Exactly one entity is navigable, so it is
 * shown on ONE side only — never as both Prev and Next pointing at the same
 * row. The side matches its sort position relative to the current entity:
 * before → Previous, after → Next. Only reached for a fully-loaded set, so it
 * works entirely off the head segment.
 *
 * When the current entity is in the set, its index reveals the side directly.
 * When the current entity is filtered out, the window cannot reveal where it
 * would sort (its sort key isn't loaded), so the survivor defaults to the Next
 * side — consistent with the stores' "Next steps into the filtered set"
 * convention for a filtered-out cursor.
 */
function resolveLoneOther<TEntry>(
  view: NavWindowView<TEntry>,
  direction: 1 | -1,
): TEntry | null {
  const { entries, cursorIndex, cursorInSet } = view
  if (!cursorInSet) {
    return direction === 1 ? (entries[0] ?? null) : null
  }
  const hasBefore = cursorIndex - 1 >= 0
  const side = hasBefore ? -1 : 1
  if (direction !== side) { return null }
  return (hasBefore ? entries[cursorIndex - 1] : entries[cursorIndex + 1]) ?? null
}

/**
 * Whether a chevron can navigate at all — there is a target on that side now
 * or after an on-demand fetch. Unlike `resolveNeighbor`, this does NOT go false
 * merely because a wrap/next target hasn't been loaded yet, so a button is
 * greyed out ONLY at a genuine dead end: an empty set, the lone current entity,
 * or the unused side of a single-other-entity set. This keeps disabled buttons
 * off the screen during normal navigation.
 */
export function canNavigate<TEntry>(view: NavWindowView<TEntry>, direction: 1 | -1): boolean {
  const otherCount = getOtherCount(view)
  if (otherCount === 0) { return false }
  if (otherCount === 1) {
    if (!view.cursorInSet) { return direction === 1 }
    const hasBefore = view.cursorIndex - 1 >= 0
    return direction === (hasBefore ? -1 : 1)
  }
  return true
}

/** Where the focused entity sits across the two segments. */
export interface CursorLocation {
  cursorIndex: number
  cursorInSet: boolean
  cursorTailIndex: number
  cursorInTail: boolean
}

/**
 * Locates the focused entity across the head and tail segments, preferring the
 * head when the entity appears in both (which can happen for a medium-sized set
 * whose segments overlap — the head copy then drives forward navigation and the
 * tail is ignored). Returns the front insertion point (`cursorIndex 0`, not in
 * either set) when the entity is in neither.
 */
export function locateCursor<TEntry>(
  entries: TEntry[],
  tailEntries: TEntry[],
  matches: (entry: TEntry) => boolean,
): CursorLocation {
  const headIndex = entries.findIndex(matches)
  if (headIndex >= 0) {
    return { cursorIndex: headIndex, cursorInSet: true, cursorTailIndex: -1, cursorInTail: false }
  }
  const tailIndex = tailEntries.findIndex(matches)
  if (tailIndex >= 0) {
    return { cursorIndex: 0, cursorInSet: false, cursorTailIndex: tailIndex, cursorInTail: true }
  }
  return { cursorIndex: 0, cursorInSet: false, cursorTailIndex: -1, cursorInTail: false }
}

/**
 * Inverts a Directus sort spec (`['name', 'sku']` ⇄ `['-name', '-sku']`) so a
 * query walks the sequence from the END. The tail segment is fetched and grown
 * with this reversed sort, then reversed back into forward order.
 */
export function reverseSort(sort: string[]): string[] {
  return sort.map((token) => (token.startsWith('-') ? token.slice(1) : `-${token}`))
}

/**
 * How many trailing rows the LIST pages pre-warm in the background (under the
 * reversed sort) and hand to the detail-page nav stores. Two chunks' worth, so
 * the tail segment lands seeded and the Previous wrap is instant on first
 * landing without an extra detail-page request.
 */
export const TAIL_PREFETCH_SIZE = 40

