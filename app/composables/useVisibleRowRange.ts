import type { Ref, ComputedRef } from 'vue'

/**
 * Tracks which rows are currently visible in a DataTable's scroll viewport.
 * Returns 1-indexed first/last row numbers that update on scroll and resize.
 *
 * For tables with a virtual scroller, uses itemSize for scroll offset math.
 * Counts actual DOM rows whose top edge is within the viewport for accuracy.
 */
export function useVisibleRowRange(
  tableRef: Ref<any>,
  totalCount: Ref<number> | ComputedRef<number>,
  itemSize: number = 46,
): {
  firstVisibleRow: Ref<number>
  lastVisibleRow: Ref<number>
} {
  const firstVisibleRow = ref(0)
  const lastVisibleRow = ref(0)
  let resizeObserver: ResizeObserver | null = null
  let scrollContainer: HTMLElement | null = null
  let rafId: number | null = null

  function getScrollContainer(): HTMLElement | null {
    const el = tableRef.value?.$el
    return el?.querySelector('.p-virtualscroller')
      || el?.querySelector('.p-datatable-table-container')
  }

  function updateRange(): void {
    if (!scrollContainer) { return }

    const count = unref(totalCount)
    if (count === 0) {
      firstVisibleRow.value = 0
      lastVisibleRow.value = 0
      return
    }

    // The sticky header lives inside the scroll viewport, so it eats into
    // clientHeight but not into a row's scroll offset. Measuring it only when
    // it's actually inside the scroll container keeps the row count honest
    // whether or not the header scrolls with the body. `scrollTop` already
    // measures from the body's row 0 (the header offset cancels out), so `first`
    // needs no header correction — only the visible-row count does.
    const header = scrollContainer.querySelector('.p-datatable-thead')
    const headerHeight = header ? header.getBoundingClientRect().height : 0

    // Both `first` and the visible span are derived from the same scroll-offset
    // math so they can't disagree — and the per-row height comes from the scroll
    // container's own geometry: (scrollable content − header) ÷ row count. For a
    // virtualized table that content height IS the scroller's spacer (count ×
    // its itemSize), so this math always agrees with the scrollbar and the range
    // lands exactly on `count` at the bottom. Measuring a live DOM row instead
    // drifts: the scroller sizes its spacer from a separately-measured, rounded
    // itemSize, and a ~2px disagreement compounds over thousands of rows — the
    // footer read "1,782-1,784 of 1,852" at the very bottom of a fully-loaded
    // table. For non-virtualized tables this is the mean real row height, which
    // also absorbs the odd taller wrapped row.
    const contentHeight = scrollContainer.scrollHeight - headerHeight
    const rowHeight = contentHeight > 0 ? contentHeight / count : itemSize

    const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight
    const clampedScrollTop = Math.min(scrollContainer.scrollTop, Math.max(0, maxScrollTop))

    const bodyViewport = Math.max(scrollContainer.clientHeight - headerHeight, rowHeight)
    const visibleRowCount = Math.max(1, Math.round(bodyViewport / rowHeight))

    const first = Math.min(Math.round(clampedScrollTop / rowHeight) + 1, count)
    const last = Math.min(first + visibleRowCount - 1, count)

    firstVisibleRow.value = first
    lastVisibleRow.value = Math.max(last, first)
  }

  function scheduleUpdate(): void {
    if (rafId !== null) { return }
    rafId = requestAnimationFrame(() => {
      rafId = null
      updateRange()
    })
  }

  function setup(): void {
    cleanup()

    scrollContainer = getScrollContainer()
    if (!scrollContainer) { return }

    resizeObserver = new ResizeObserver(scheduleUpdate)
    resizeObserver.observe(scrollContainer)

    scrollContainer.addEventListener('scroll', scheduleUpdate, { passive: true })

    // Delay initial measurement to let virtual scroller finish layout
    setTimeout(updateRange, 150)
  }

  function cleanup(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (scrollContainer) {
      scrollContainer.removeEventListener('scroll', scheduleUpdate)
      scrollContainer = null
    }
  }

  watch(tableRef, (newVal: any) => {
    if (newVal) { nextTick(setup) }
  })

  watch(totalCount, () => {
    nextTick(setup)
  })

  onMounted(() => {
    if (tableRef.value) { nextTick(setup) }
  })

  onUnmounted(cleanup)

  return { firstVisibleRow, lastVisibleRow }
}
