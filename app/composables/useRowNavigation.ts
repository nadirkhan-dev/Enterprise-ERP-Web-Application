import type { Ref } from 'vue'

interface RowEvent {
  originalEvent: Event
  data: Record<string, unknown>
}

interface ContextMenuItem {
  label: string
  icon?: string
  command: () => void
}

/**
 * Composable for DataTable row navigation with new-tab support.
 *
 * Handles:
 *   - Normal click -> navigateTo (same tab)
 *   - Ctrl+click / Cmd+click -> window.open (new tab)
 *   - Right-click (via @row-contextmenu) -> PrimeVue ContextMenu with "Open in new tab"
 */
export function useRowNavigation(
  getRowUrl: (rowData: Record<string, unknown>) => string,
): {
  handleRowClick: (event: RowEvent) => void
  handleRowContextMenu: (event: RowEvent) => void
  contextMenuRef: Ref<any>
  contextMenuItems: Ref<ContextMenuItem[]>
} {
  const contextMenuRef: Ref<any> = ref(null)
  const searchStore = useSearchStore()
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

  function handleRowClick({ originalEvent, data: rowData }: RowEvent): void {
    // Ignore clicks that land on an interactive control inside the row (action
    // icons, links, form fields, the row-reorder handle) — those run their own
    // handlers. Only a click on the row's plain area should navigate. Without
    // this, tables whose row actions do something other than navigate (edit,
    // download, external link) would fire both the action and the navigation.
    const eventTarget = originalEvent.target as HTMLElement | null
    if (eventTarget?.closest(
      'button, a, input, select, textarea, [role="button"], .p-datatable-reorderable-row-handle',
    )) {
      return
    }
    const url = getRowUrl(rowData)
    const mouseEvent = originalEvent as MouseEvent
    if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
      window.open(url, '_blank')
    } else {
      searchStore.markClearOnNavigate()
      navigateTo(url)
    }
  }

  function handleRowContextMenu({ originalEvent, data: rowData }: RowEvent): void {
    pendingUrl = getRowUrl(rowData)
    contextMenuRef.value.show(originalEvent)
  }

  return {
    handleRowClick,
    handleRowContextMenu,
    contextMenuRef,
    contextMenuItems,
  }
}
