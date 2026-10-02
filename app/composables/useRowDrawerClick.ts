interface RowEvent {
  originalEvent: Event
  data: Record<string, any>
}

/**
 * Row-click handler for tables whose row opens something in place — a drawer,
 * side panel, or document viewer — rather than navigating to a URL (the
 * counterpart to `useRowNavigation`). Clicks that land
 * on an interactive control inside the row (action icons, links, form fields, the
 * reorder handle) are ignored so those run their own handlers.
 *
 * @param open - Called with the clicked row's data when a plain-area click lands.
 */
export function useRowDrawerClick(
  open: (rowData: Record<string, any>) => void,
): { handleRowClick: (event: RowEvent) => void } {
  function handleRowClick({ originalEvent, data: rowData }: RowEvent): void {
    const eventTarget = originalEvent.target as HTMLElement | null
    if (eventTarget?.closest(
      'button, a, input, select, textarea, [role="button"], .p-datatable-reorderable-row-handle',
    )) {
      return
    }
    open(rowData)
  }

  return { handleRowClick }
}
