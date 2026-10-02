import type { LocationQuery, LocationQueryRaw, LocationQueryValue } from 'vue-router'

type RawQueryValue = LocationQueryValue | LocationQueryValue[]

/**
 * Binds one URL query key to a piece of reactive filter/sort/page state.
 *
 * `defaultValue` is used when this key disappears from the URL via an
 * external navigation event (e.g. browser back/forward). On the very first
 * mount, an empty URL is treated as "no opinion" and state is taken from
 * the store (localStorage or initial state).
 */
export interface FilterBinding<T = unknown> {
  /** Read the current state value. */
  get: () => T
  /** Apply a value to state. */
  set: (value: T) => void
  /** Value to reset to when this key disappears from the URL externally. */
  defaultValue: T
  /** Parse a URL value to a state value; return undefined to skip applying. */
  parse: (raw: string) => T | undefined
  /** Serialize a state value to a URL string; return null to omit from URL. */
  serialize: (value: T) => string | null
}

interface Options {
  /**
   * History mode for state-driven URL updates after the initial sync.
   * Defaults to `'push'` so discrete filter/sort/page changes produce
   * meaningful browser-history entries. Use `'replace'` for high-frequency
   * sources like debounced search keystrokes.
   *
   * The first state→URL write after mount always uses `replace` so that
   * populating the URL with defaults doesn't add a spurious history entry.
   */
  mode?: 'push' | 'replace'
}

/**
 * Two-way sync between a set of filter/sort/page bindings and the URL query.
 *
 * Loop avoidance: every state→URL push records a snapshot of the owned-key
 * subset that was just written. When the URL watcher fires next, if the URL
 * still matches that snapshot for our owned keys, the change is treated as
 * an echo of our own push and the URL→state path is skipped. Only external
 * URL changes (back/forward, programmatic nav, paste) flow through to state.
 */
export function useUrlSyncedListState(
  bindings: Record<string, FilterBinding>,
  options: Options = {},
): void {
  const route = useRoute()
  const router = useRouter()
  const mode = options.mode ?? 'push'

  let hasWrittenOnce = false
  let lastOwnedSnapshot: Record<string, string | undefined> | null = null

  function normalizeQueryValue(value: RawQueryValue | undefined): string | undefined {
    if (value === undefined || value === null) return undefined
    if (Array.isArray(value)) {
      const first = value[0]
      return first === null || first === undefined ? undefined : first
    }
    return value
  }

  function buildOwnedSnapshot(query: LocationQuery): Record<string, string | undefined> {
    const snapshot: Record<string, string | undefined> = {}
    for (const key of Object.keys(bindings)) {
      snapshot[key] = normalizeQueryValue(query[key])
    }
    return snapshot
  }

  function ownedSnapshotsEqual(
    a: Record<string, string | undefined>,
    b: Record<string, string | undefined>,
  ): boolean {
    for (const key of Object.keys(bindings)) {
      if (a[key] !== b[key]) return false
    }
    return true
  }

  function applyUrlToState(query: LocationQuery, { resetMissing }: { resetMissing: boolean }) {
    for (const [key, binding] of Object.entries(bindings)) {
      const raw = normalizeQueryValue(query[key])
      if (raw === undefined) {
        if (resetMissing) binding.set(binding.defaultValue)
        continue
      }
      const parsed = binding.parse(raw)
      if (parsed !== undefined) {
        binding.set(parsed)
      }
    }
  }

  function pushStateToUrl() {
    const merged: LocationQueryRaw = { ...route.query }
    const owned: Record<string, string | undefined> = {}
    for (const [key, binding] of Object.entries(bindings)) {
      const serialized = binding.serialize(binding.get())
      owned[key] = serialized === null ? undefined : serialized
      if (serialized === null) {
        delete merged[key]
      } else {
        merged[key] = serialized
      }
    }

    lastOwnedSnapshot = owned

    if (queryEquals(merged, route.query)) return

    const useReplace = !hasWrittenOnce || mode === 'replace'
    hasWrittenOnce = true
    const navigate = useReplace ? router.replace : router.push
    navigate.call(router, { query: merged })
  }

  // Initial hydrate
  // Defaults are only re-applied on a hard refresh (initial Nuxt hydration).
  // On SPA navigation back to the page (e.g. customer detail → back), the
  // Pinia store has retained the user's session edits, so missing URL keys
  // must NOT be reset to defaults — otherwise a filter the user cleared
  // would silently come back every time they navigate away and return.
  const isHardRefresh = useNuxtApp().isHydrating
  applyUrlToState(route.query, { resetMissing: isHardRefresh })
  lastOwnedSnapshot = buildOwnedSnapshot(route.query)
  // Then sync the now-canonical state back to the URL so defaults appear.
  nextTick(() => pushStateToUrl())

  watch(
    Object.values(bindings).map((binding) => () => binding.get()),
    pushStateToUrl,
    { deep: true, flush: 'post' },
  )

  // URL → State (back/forward, programmatic nav, paste)
  watch(
    () => route.query,
    (nextQuery) => {
      const nextOwned = buildOwnedSnapshot(nextQuery)
      if (lastOwnedSnapshot && ownedSnapshotsEqual(nextOwned, lastOwnedSnapshot)) {
        return
      }
      lastOwnedSnapshot = nextOwned
      applyUrlToState(nextQuery, { resetMissing: true })
    },
  )
}

function queryEquals(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => String(a[key]) === String(b[key]))
}
