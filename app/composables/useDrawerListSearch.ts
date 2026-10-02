import type { Ref } from 'vue'

interface DrawerListSearchOptions<T> {
  /** External query ref to bind (e.g. one declared early for other logic to read).
   *  A fresh internal ref is created when omitted. */
  search?: Ref<string>
  /** Extra gate on top of the overflow rule — e.g. `() => !isDetailView.value`. */
  enabled?: () => boolean
  /** Reactive values that should ALSO re-trigger the overflow measurement (e.g. a
   *  loading flag or the drawer's visibility), beyond the item-count change. */
  watch?: () => unknown[]
  /** Name accessor used by the filter (defaults to `item.name`). */
  name?: (item: T) => string
}

/**
 * Drawer list search — a name filter that only surfaces once the list is taller
 * than the drawer viewport (or a search is active), so short lists stay
 * uncluttered. One place to tweak the filter, the overflow rule, or the trigger
 * cadence for every drawer that uses it.
 *
 * Usage:
 *   const { search, displayItems, showSearch, contentRef } = useDrawerListSearch(
 *     listItems, { search: listSearch, enabled: () => !isDetailView.value }
 *   )
 * Bind `search` to a `<BaseDrawerSearch>`, render `displayItems`, gate the field
 * with `showSearch`, and attach `contentRef` to the scrollable list element — it
 * measures the enclosing `.p-drawer-content`.
 */
export function useDrawerListSearch<T extends Record<string, any>>(
  items: Ref<T[]>,
  options: DrawerListSearchOptions<T> = {},
) {
  const getName = options.name ?? ((item: T) => String(item?.name ?? ''))
  const search = options.search ?? ref('')
  const contentRef = ref<HTMLElement | null>(null)
  const isOverflowing = ref(false)

  const displayItems = computed<T[]>(() => {
    const term = search.value.trim().toLowerCase()
    if (!term) { return items.value }
    return items.value.filter((item) => getName(item).toLowerCase().includes(term))
  })

  // Kept visible while a search is active so the field doesn't vanish as filtering
  // shrinks the list back within the viewport.
  const showSearch = computed(() =>
    (options.enabled ? options.enabled() : true)
    && (isOverflowing.value || !!search.value.trim()),
  )

  function checkOverflow(): void {
    const container = contentRef.value?.closest('.p-drawer-content') as HTMLElement | null
    isOverflowing.value = !!container && container.scrollHeight > container.clientHeight + 1
  }

  let timer: ReturnType<typeof setTimeout> | null = null
  function scheduleCheck(): void {
    if (timer) { clearTimeout(timer) }
    timer = setTimeout(() => { nextTick(checkOverflow) }, 0)
  }

  watch(
    () => [items.value.length, ...(options.watch ? options.watch() : [])],
    scheduleCheck,
  )
  onMounted(() => window.addEventListener('resize', scheduleCheck, { passive: true }))
  onBeforeUnmount(() => {
    window.removeEventListener('resize', scheduleCheck)
    if (timer) { clearTimeout(timer) }
  })

  function clear(): void { search.value = '' }

  return { search, displayItems, showSearch, contentRef, isOverflowing, scheduleCheck, checkOverflow, clear }
}
