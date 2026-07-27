import type { Ref } from 'vue'
import { useSearchStore } from '~/stores/search'
import { useTableStateStore } from '~/stores/tableState'

interface TableRefs {
  rows: Ref<Record<string, any>[]>
  currentPage: Ref<number>
  hasMore: Ref<boolean>
  totalRecords: Ref<number>
  sortField: Ref<string>
  sortOrder: Ref<number>
  isLoading: Ref<boolean>
}

/**
 * Composable for saving and restoring DataTable state across navigation.
 *
 * Checks for a cached snapshot on setup and restores refs if valid.
 * Provides helpers to save state before route leave and restore scroll position after mount.
 */
export function useTableStateRestore(
  routePath: string,
  tableRefs: TableRefs,
  tableRef: Ref<any>,
): {
  hasCachedState: Ref<boolean>
  saveBeforeLeave: () => void
  restoreScrollPosition: () => void
} {
  const tableStateStore = useTableStateStore()
  const searchStore = useSearchStore()

  const hasCachedState = ref(false)

  const cached = tableStateStore.getTableState(routePath)

  if (cached && cached.searchQuery === searchStore.searchQuery) {
    tableRefs.rows.value = cached.rows
    tableRefs.currentPage.value = cached.currentPage
    tableRefs.hasMore.value = cached.hasMore
    tableRefs.totalRecords.value = cached.totalRecords
    tableRefs.sortField.value = cached.sortField
    tableRefs.sortOrder.value = cached.sortOrder
    tableRefs.isLoading.value = false
    hasCachedState.value = true
  }

  function getScrollContainer(): HTMLElement | null {
    return tableRef.value?.$el?.querySelector('.p-virtualscroller')
      || tableRef.value?.$el?.querySelector('.p-datatable-table-container')
  }

  function saveBeforeLeave(): void {
    const container = getScrollContainer()
    const scrollTop = container?.scrollTop ?? 0

    tableStateStore.saveTableState(routePath, {
      rows: tableRefs.rows.value,
      currentPage: tableRefs.currentPage.value,
      hasMore: tableRefs.hasMore.value,
      totalRecords: tableRefs.totalRecords.value,
      sortField: tableRefs.sortField.value,
      sortOrder: tableRefs.sortOrder.value,
      scrollTop,
      searchQuery: searchStore.searchQuery,
    })
  }

  function restoreScrollPosition(): void {
    if (!cached) { return }
    nextTick(() => {
      setTimeout(() => {
        const container = getScrollContainer()
        if (container) {
          container.scrollTop = cached.scrollTop
        }
      }, 150)
    })
  }

  return {
    hasCachedState,
    saveBeforeLeave,
    restoreScrollPosition,
  }
}
