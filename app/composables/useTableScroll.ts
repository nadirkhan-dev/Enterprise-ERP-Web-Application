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
  let lastMeasuredSignature: string = ''

  function checkScrollable(): void {
    if (isMeasuring) {return}

    const container = getScrollContainer()
    if (!container) {return}

    const table = container.querySelector('table') as HTMLTableElement | null
    if (!table) {return}
    const signature = `${container.clientWidth}|${table.offsetWidth}|${table.rows.length}`
    if (signature === lastMeasuredSignature) {return}
    lastMeasuredSignature = signature

    isMeasuring = true
    // Applied with priority: the column-resize stylesheet holds the table at its
    // panel width with !important, and a plain inline value loses to it — the
    // probe would then read back the container width and never detect overflow.
    const prevWidth = table.style.getPropertyValue('width')
    const prevWidthPriority = table.style.getPropertyPriority('width')
    const prevMinWidth = table.style.getPropertyValue('min-width')
    const prevMinWidthPriority = table.style.getPropertyPriority('min-width')
    table.style.setProperty('width', '1px', 'important')
    table.style.setProperty('min-width', '0', 'important')
    const naturalWidth = table.offsetWidth
    const frozenCol = table.querySelector('.p-datatable-frozen-column') as HTMLElement | null
    const renderedFrozenWidth = frozenCol ? frozenCol.offsetWidth : 0
    if (prevWidth) {
      table.style.setProperty('width', prevWidth, prevWidthPriority)
    } else {
      table.style.removeProperty('width')
    }
    if (prevMinWidth) {
      table.style.setProperty('min-width', prevMinWidth, prevMinWidthPriority)
    } else {
      table.style.removeProperty('min-width')
    }
    isMeasuring = false

    const dataNaturalWidth = naturalWidth - renderedFrozenWidth
    // Two distinct signals. The natural-width probe catches an auto-layout table
    // whose columns are being squeezed to fit (the classic case). The direct
    // scrollWidth check catches a table whose pinned column widths overflow the
    // container outright — including by LESS than the frozen column's width,
    // which the probe's subtraction would otherwise write off as fitting while
    // the last column sits hidden under the frozen overlay with no way to reach
    // it (1px tolerance for sub-pixel rounding).
    const hasRenderedOverflow = container.scrollWidth > container.clientWidth + 1
    isScrollable.value = hasRenderedOverflow || dataNaturalWidth > container.clientWidth
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

    lastMeasuredSignature = ''
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
