import type { Ref, ComputedRef } from 'vue'

/**
 * Detects whether a DataTable's scroll container is vertically scrollable
 * and whether the user has scrolled to the bottom. Returns a reactive boolean
 * suitable for toggling a footer shadow class.
 */
export function useTableFooterShadow(
  tableRef: Ref<any>,
  totalCount: Ref<number> | ComputedRef<number> | null = null,
): {
  showFooterShadow: ComputedRef<boolean>
} {
  const isScrollable = ref(false)
  const isScrolledToBottom = ref(false)
  let resizeObserver: ResizeObserver | null = null
  let scrollContainer: HTMLElement | null = null
  let rafId: number | null = null

  function getScrollContainer(): HTMLElement | null {
    const el = tableRef.value?.$el
    return el?.querySelector('.p-virtualscroller')
      || el?.querySelector('.p-datatable-table-container')
  }

  function checkScroll(): void {
    if (!scrollContainer) { return }

    isScrollable.value = scrollContainer.scrollHeight > scrollContainer.clientHeight
    isScrolledToBottom.value =
      scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 1
  }

  function scheduleCheck(): void {
    if (rafId !== null) { return }
    rafId = requestAnimationFrame(() => {
      rafId = null
      checkScroll()
    })
  }

  function setup(): void {
    cleanup()

    scrollContainer = getScrollContainer()
    if (!scrollContainer) { return }

    resizeObserver = new ResizeObserver(scheduleCheck)
    resizeObserver.observe(scrollContainer)

    scrollContainer.addEventListener('scroll', scheduleCheck, { passive: true })

    checkScroll()
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
      scrollContainer.removeEventListener('scroll', scheduleCheck)
      scrollContainer = null
    }
  }

  watch(tableRef, (newVal: any) => {
    if (newVal) { nextTick(setup) }
  })

  if (totalCount) {
    watch(totalCount, () => {
      nextTick(setup)
    })
  }

  onMounted(() => {
    if (tableRef.value) { nextTick(setup) }
  })

  onUnmounted(cleanup)

  const showFooterShadow = computed(() => isScrollable.value && !isScrolledToBottom.value)

  return { showFooterShadow }
}
