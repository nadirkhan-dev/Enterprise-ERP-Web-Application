import type { Ref } from 'vue'

/**
 * Wires up infinite-scroll on a PrimeVue DataTable: attaches a scroll
 * listener to the table's virtual-scroller (or table-container) and fires
 * `onNearBottom` when the user scrolls within 100px of the end, gated by
 * `shouldLoadMore` so it doesn't fire while a request is in flight or when
 * there's nothing more to load. Re-attaches when `virtualScrollerOptions`
 * toggles (scrollable mode appears/disappears as the dataset grows).
 *
 * The listener is detached on unmount and before each re-attach to avoid
 * leaks.
 */
export function useTableInfiniteScroll(
  tableRef: Ref<any>,
  virtualScrollerOptions: Ref<unknown>,
  shouldLoadMore: () => boolean,
  onNearBottom: () => void,
): void {
  let scrollContainer: HTMLElement | null = null

  function handleScroll(event: Event) {
    const container = event.target as HTMLElement
    const threshold = 100
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < threshold
    if (nearBottom && shouldLoadMore()) {
      onNearBottom()
    }
  }

  function findScrollContainer(): HTMLElement | null {
    const tableEl = tableRef.value?.$el
    if (!tableEl) { return null }
    return (
      tableEl.querySelector('.p-virtualscroller')
      || tableEl.querySelector('.p-datatable-table-container')
    )
  }

  function attachScrollListener() {
    detachScrollListener()
    const container = findScrollContainer()
    if (container) {
      scrollContainer = container
      container.addEventListener('scroll', handleScroll, { passive: true })
    }
  }

  function detachScrollListener() {
    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', handleScroll)
      scrollContainer = null
    }
  }

  watch(virtualScrollerOptions, async () => {
    detachScrollListener()
    await nextTick()
    attachScrollListener()
  })

  onMounted(() => {
    nextTick(attachScrollListener)
  })

  onBeforeUnmount(() => {
    detachScrollListener()
  })
}
