import { updateMe as _updateMe } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'
import { useAuthStore } from '~/stores/auth'

/**
 * Per-user column widths in pixels, keyed by table and then by column field:
 * `{ 'section.contacts': { name: 220 } }`. A table appears only once someone has
 * resized it; until then its columns keep the widths declared on their
 * `<Column>`. From the first drag on, the whole row is recorded rather than the
 * dragged column alone — resizing pins the entire layout, so that's what has to
 * come back on the next visit.
 */
export type ColumnWidthMap = Record<string, Record<string, number>>

// Cast around the SDK's generated schema, which doesn't include the custom
// connect_config field on directus_users. Mirrors the readMe cast in auth.ts.
const updateMe = _updateMe as any

// Widths ride in the same directus_users.connect_config JSON that already
// carries show_page_scrollbar, under this key.
const CONFIG_KEY: string = 'column_widths'

// Per-device mirror, used only when Directus refuses the write — see persist().
const STORAGE_KEY: string = 'connect:column-widths'

// A single drag emits one resize, but "reset all columns" and fit-to-content can
// land in bursts. Collapse them into one round-trip.
const PERSIST_DELAY_MS: number = 600

let persistTimer: ReturnType<typeof setTimeout> | null = null

function readLocalWidths(): ColumnWidthMap {
  if (typeof localStorage === 'undefined') { return {} }
  const { data: stored } = tryCatchSync(() => localStorage.getItem(STORAGE_KEY))
  if (!stored) { return {} }
  const { data: parsed } = tryCatchSync(() => JSON.parse(stored) as ColumnWidthMap)
  return parsed && typeof parsed === 'object' ? parsed : {}
}

function writeLocalWidths(widths: ColumnWidthMap): void {
  if (typeof localStorage === 'undefined') { return }
  tryCatchSync(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(widths)))
}

interface ColumnWidthsState {
  widths: ColumnWidthMap
  isHydrated: boolean
  // Flipped once Directus has refused a write. From then on the widths are kept
  // in localStorage only, so the feature still works for a user whose policy
  // lacks update rights on connect_config.
  isLocalOnly: boolean
}

export const useColumnWidthsStore = defineStore('columnWidths', {
  state: (): ColumnWidthsState => ({
    widths: {},
    isHydrated: false,
    isLocalOnly: false,
  }),

  getters: {
    /** A table's stored widths, or an empty map when nothing has been sized. */
    tableWidths: (state): ((tableKey: string) => Record<string, number>) =>
      (tableKey: string) => state.widths[tableKey] ?? {},
  },

  actions: {
    /**
     * Seed the store from the user's connect_config, falling back to the local
     * mirror. Safe to call from every table on mount — it runs once.
     */
    hydrate(): void {
      if (this.isHydrated) { return }

      // Nothing to read from yet — leave it unhydrated so the next table to
      // mount tries again, rather than locking in an empty set of widths.
      const user = useAuthStore().user
      if (!user) { return }

      this.isHydrated = true

      // A config that's readable but carries no widths means exactly that — the
      // user has none, or has just reset them. Only an unreadable config (a
      // policy without rights to the field) falls back to the local mirror,
      // which is the case that mirror exists for.
      const config = user.connect_config
      const stored = config?.[CONFIG_KEY]
      this.widths = (config
        ? (stored && typeof stored === 'object' ? stored : {})
        : readLocalWidths()) as ColumnWidthMap
    },

    setColumnWidth(tableKey: string, field: string, width: number): void {
      this.setColumnWidths(tableKey, { [field]: width })
    },

    /** Record a whole row of widths in one write — see handleColumnResizeEnd. */
    setColumnWidths(tableKey: string, widths: Record<string, number>): void {
      const rounded = Object.fromEntries(
        Object.entries(widths).map(([field, width]) => [field, Math.round(width)]),
      )
      this.widths[tableKey] = { ...(this.widths[tableKey] ?? {}), ...rounded }
      this.schedulePersist()
    },

    /**
     * Replace a table's widths outright. Unlike setColumnWidths this can shrink
     * the map, which is what resetting a single column needs: pin what stays,
     * drop what goes, in one write.
     */
    replaceTableWidths(tableKey: string, widths: Record<string, number>): void {
      const rounded = Object.fromEntries(
        Object.entries(widths).map(([field, width]) => [field, Math.round(width)]),
      )
      if (Object.keys(rounded).length) {
        this.widths[tableKey] = rounded
      } else {
        delete this.widths[tableKey]
      }
      this.schedulePersist()
    },

    /** Drop one column's override — it returns to its declared width. */
    resetColumn(tableKey: string, field: string): void {
      const table = this.widths[tableKey]
      if (!table || !(field in table)) { return }

      const { [field]: _removed, ...remaining } = table
      if (Object.keys(remaining).length) {
        this.widths[tableKey] = remaining
      } else {
        delete this.widths[tableKey]
      }
      this.schedulePersist()
    },

    /** Drop every override on one table. */
    resetTable(tableKey: string): void {
      if (!this.widths[tableKey]) { return }
      delete this.widths[tableKey]
      this.schedulePersist()
    },

    schedulePersist(): void {
      if (persistTimer) { clearTimeout(persistTimer) }
      persistTimer = setTimeout(() => {
        persistTimer = null
        void this.persist()
      }, PERSIST_DELAY_MS)
    },

    /**
     * Write the widths back to the user's connect_config. A refused write (a
     * policy without update rights on the field) is not an error the user can
     * act on, so it silently demotes to the local mirror instead of toasting on
     * every drag.
     */
    async persist(): Promise<void> {
      const authStore = useAuthStore()
      const snapshot = JSON.parse(JSON.stringify(this.widths)) as ColumnWidthMap

      if (this.isLocalOnly || !authStore.isAuthenticated) {
        writeLocalWidths(snapshot)
        return
      }

      // Spread the existing config so a width save can't drop a preference the
      // app doesn't own here (show_page_scrollbar, and whatever lands next).
      const nextConfig = {
        ...(authStore.user?.connect_config ?? {}),
        [CONFIG_KEY]: snapshot,
      }

      const { error } = await tryCatch(
        useDirectus().request(updateMe({ connect_config: nextConfig })),
      )

      if (error) {
        console.error('Failed to save column widths:', error.message)
        this.isLocalOnly = true
        writeLocalWidths(snapshot)
        return
      }

      // Keep the local copy in step so the next save spreads the config we just
      // wrote rather than the one fetched at login.
      if (authStore.user) {
        authStore.user.connect_config = nextConfig as typeof authStore.user.connect_config
      }
    },
  },
})
