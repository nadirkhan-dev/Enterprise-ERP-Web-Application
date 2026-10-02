import type { Ref } from 'vue'
import { resolveSearchModule } from '~/config/searchModules'

interface RowEvent {
  originalEvent: Event
  data: Record<string, unknown>
}

interface ContextMenuItem {
  label: string
  icon?: string
  command: () => void
}

export function useRowNavigation(
  getRowUrl: (rowData: Record<string, unknown>) => string,
): {
  navigateToRow: (rowData: Record<string, unknown>, newTab?: boolean) => void
  handleRowClick: (event: RowEvent) => void
  handleRowContextMenu: (event: RowEvent) => void
  contextMenuRef: Ref<any>
  contextMenuItems: Ref<ContextMenuItem[]>
} {
  const contextMenuRef: Ref<any> = ref(null)
  const searchStore = useSearchStore()
  const route = useRoute()
  let pendingUrl: string | null = null

  const contextMenuItems: Ref<ContextMenuItem[]> = ref([
    {
      label: 'Open in new tab',
      icon: 'pi pi-external-link',
      command: () => {
        if (pendingUrl) {
          window.open(pendingUrl, '_blank')
        }
        pendingUrl = null
      },
    },
  ])
  function isListRowIntoOwnDetail(url: string): boolean {
    const targetModule = resolveSearchModule(url)
    return targetModule != null && route.path === targetModule.listRoute
  }

  function navigateToRow(rowData: Record<string, unknown>, newTab: boolean = false): void {
    const url = getRowUrl(rowData)
    if (newTab) {
      window.open(url, '_blank')
      return
    }
    if (!isListRowIntoOwnDetail(url)) {
      searchStore.markClearOnNavigate()
    }
    navigateTo(url)
  }

  function handleRowClick({ originalEvent, data: rowData }: RowEvent): void {
    const eventTarget = originalEvent.target as HTMLElement | null
    if (eventTarget?.closest(
      'button, a, input, select, textarea, [role="button"], .p-datatable-reorderable-row-handle',
    )) {
      return
    }
    const mouseEvent = originalEvent as MouseEvent
    navigateToRow(rowData, mouseEvent.ctrlKey || mouseEvent.metaKey)
  }

  function handleRowContextMenu({ originalEvent, data: rowData }: RowEvent): void {
    pendingUrl = getRowUrl(rowData)
    contextMenuRef.value.show(originalEvent)
  }

  return {
    navigateToRow,
    handleRowClick,
    handleRowContextMenu,
    contextMenuRef,
    contextMenuItems,
  }
}
