import type { RouterConfig } from '@nuxt/schema'

/**
 * Custom Vue Router scroll behaviour.
 *
 * List pages sync sort/filter/page state into the URL query string
 * (see `useUrlSyncedListState`). Without this override, Nuxt's default
 * resets window scroll to the top on every query change, so clicking a
 * sortable column header would jump the page up. Query-only changes on the
 * same path keep the current scroll position; real path navigations still
 * restore (back/forward) or scroll to top.
 */
export default <RouterConfig>{
  scrollBehavior(to, from, savedPosition) {
    if (to.path === from.path) {
      return false
    }
    if (savedPosition) {
      return savedPosition
    }
    return { left: 0, top: 0 }
  },
}
