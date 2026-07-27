import type { Ref } from 'vue'

/**
 * Provides scroll navigation and horizontal scrollability detection
 * for a PrimeVue DataTable.
 */
export function useTableScroll(
  tableRef: Ref<any>,
  scrollAmount: number = 200,
): {
  scrollLeft: () => void
  scrollRight: () => void
  isScrollable: Ref<boolean>
  isAtScrollEnd: Ref<boolean>
} {
  const isScrollable = ref(false)
  // True when the container's horizontal scroll position is at (or past) the
  // right edge — i.e. no data hidden behind the frozen action column.
  const isAtScrollEnd = ref(true)
  let resizeObserver: ResizeObserver | null = null
  let rootEl: HTMLElement | null = null

  function getScrollContainer(): HTMLElement | null {
    const el = tableRef.value?.$el
    return el?.querySelector('.p-virtualscroller')
      || el?.querySelector('.p-datatable-table-container')
  }

  let isMeasuring: boolean = false

  function checkScrollable(): void {
    if (isMeasuring) {return}

    const container = getScrollContainer()
    if (!container) {return}

    const table = container.querySelector('table') as HTMLTableElement | null
    if (!table) {return}

    isMeasuring = true
    const prevWidth = table.style.width
    table.style.width = '1px'
    const naturalWidth = table.offsetWidth
    // Measure the frozen action column at the same time. Subtracting it
    // below removes the hysteresis that otherwise makes the frozen col
    // appear at a narrower viewport than it disappears at — its own
    // presence inflates `naturalWidth` and shifts the threshold by its own
    // width, so the appear/disappear transitions land on different pixels.
    const frozenCol = table.querySelector('.p-datatable-frozen-column') as HTMLElement | null
    const frozenWidth = frozenCol?.offsetWidth ?? 0
    table.style.width = prevWidth
    isMeasuring = false

    const dataNaturalWidth = naturalWidth - frozenWidth
    isScrollable.value = dataNaturalWidth > container.clientWidth - frozenWidth
    updateScrollEnd(container)
  }

  function updateScrollEnd(container: HTMLElement): void {
    const remaining =
      container.scrollWidth - container.clientWidth - container.scrollLeft
    // 1px tolerance for sub-pixel rounding.
    isAtScrollEnd.value = remaining <= 1
  }

  function handleScroll(): void {
    const container = getScrollContainer()
    if (container) {updateScrollEnd(container)}
  }

  function setupObserver(): void {
    cleanupObserver()

    const el = tableRef.value?.$el as HTMLElement | undefined
    if (!el) {return}

    rootEl = el
    el.addEventListener('scroll', handleScroll, { capture: true, passive: true })

    resizeObserver = new ResizeObserver(checkScrollable)
    // Observe the root too, so a layout change after async data load
    // (compact → virtualised) re-runs the measurement.
    resizeObserver.observe(el)
    const container = getScrollContainer()
    if (container) {
      resizeObserver.observe(container)
      const table = container.querySelector('table')
      if (table) {resizeObserver.observe(table)}
    }

    checkScrollable()
  }

  function cleanupObserver(): void {
    if (resizeObserver) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    if (rootEl) {
      rootEl.removeEventListener('scroll', handleScroll, { capture: true })
      rootEl = null
    }
  }

  function scrollLeft(): void {
    const container = getScrollContainer()
    if (container) {container.scrollLeft -= scrollAmount}
  }

  function scrollRight(): void {
    const container = getScrollContainer()
    if (container) {container.scrollLeft += scrollAmount}
  }

  watch(tableRef, (newVal: any) => {
    if (newVal) {nextTick(setupObserver)}
  })

  onMounted(() => {
    if (tableRef.value) {nextTick(setupObserver)}
  })

  onUnmounted(cleanupObserver)

  return { scrollLeft, scrollRight, isScrollable, isAtScrollEnd }
}
