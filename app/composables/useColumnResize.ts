import type { Ref } from 'vue'
import { BREAKPOINT_LAPTOP } from '~/utils/breakpoints'
import { useColumnWidthsStore } from '~/stores/columnWidths'

export interface UseColumnResizeOptions {
  // Stable identity for this table's stored widths, e.g. 'section.contacts'.
  // It keys the user's connect_config, so it must not change between releases.
  tableKey: string
  tableRef: Ref<any>
}

/**
 * A DOM element, safe to ask on the server.
 *
 * `instanceof HTMLElement` throws during server rendering, where the constructor
 * doesn't exist — and an immediate watcher runs there too, so the check has to
 * survive it rather than assume a browser.
 */
export function isElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement
}

/** Read a column's prop by either casing, the way PrimeVue's own columnProp does. */
function getColumnProp(column: any, name: string): unknown {
  const props = column?.props
  if (!props) { return undefined }
  const kebabName = name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
  return Object.prototype.hasOwnProperty.call(props, kebabName) ? props[kebabName] : props[name]
}

/**
 * The field behind each rendered column, in render order, with `null` for the
 * ones a user can't size. Read from the live DataTable rather than declared per
 * table: `instance.columns` is the same ordered list PrimeVue renders the cells
 * from, so the index maths can't drift out of step with the markup.
 *
 * A column qualifies when it has a `field` to store the width under and a header
 * of some kind — a string, or a slot for the ones that dress their label up (the
 * MOQ column renders its abbreviation with a tooltip). Row-reorder columns are
 * excluded whatever they declare: they carry a drag handle, not data, and a
 * `field` only so the table can sort by the manual order. Columns with no field
 * at all — the default-star, the frozen actions column — are excluded already.
 */
export function getTableColumnFields(table: any): (string | null)[] {
  const columns = table?.columns
  if (!Array.isArray(columns)) { return [] }

  return columns.map((column: any) => {
    const field = getColumnProp(column, 'field')
    if (typeof field !== 'string' || !field.length) { return null }
    // Valueless in the template (`<Column row-reorder>`), which reaches the vnode
    // as an empty string — falsy, so presence is what counts, not truthiness.
    const rowReorder = getColumnProp(column, 'rowReorder')
    if (rowReorder !== undefined && rowReorder !== null && rowReorder !== false) { return null }

    const header = getColumnProp(column, 'header')
    const hasHeader = (typeof header === 'string' && header.trim().length > 0)
      || !!column?.children?.header
    return hasHeader ? field : null
  })
}

/**
 * Every sizable column's width as it currently stands, keyed by field.
 *
 * Used to freeze the layout on screen the first time a table is sized. Until
 * then its columns share the panel between them, so pinning one would re-share
 * the rest; recording them all as they stand means a resize moves the one column
 * asked for and the spacer column answers for the difference.
 */
export function getRenderedColumnWidths(table: any): Record<string, number> {
  const root = table?.$el
  if (!isElement(root)) { return {} }

  const fields = getTableColumnFields(table)
  const headerCells = Array.from(
    root.querySelectorAll<HTMLElement>('table > thead > tr > th'),
  )
  const widths: Record<string, number> = {}

  headerCells.forEach((cell, index) => {
    const field = fields[index]
    if (field) { widths[field] = Math.round(cell.getBoundingClientRect().width) }
  })
  return widths
}

export function getColumnWidthsStyleId(tableKey: string): string {
  return `column-widths-${tableKey.replace(/[^a-z0-9-]/gi, '-')}`
}

/** Below this a column is a sliver with no room for its own header. */
export const MIN_COLUMN_WIDTH_PX: number = 48

export function clearNativeResizeState(table: any): void {
  table?.destroyStyleElement?.()

  const root = table?.$el
  if (!isElement(root)) { return }
  // A virtual-scrolled table gets the same width written onto its body as well
  // as the table, so both have to go.
  root.querySelectorAll('table, table > tbody').forEach((element) => {
    if (!(isElement(element))) { return }
    element.style.removeProperty('width')
    element.style.removeProperty('min-width')
  })
}
const HEADER_CELL_TRIGGERS = [
  '.p-datatable-sort-icon',
  '.p-datatable-column-resizer',
  '.column-resize-menu__trigger',
  'button',
  'a',
  '[role="button"]',
].join(', ')
function handleHeaderClickCapture(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target?.closest('th.p-datatable-sortable-column')) { return }
  if (target.closest(HEADER_CELL_TRIGGERS)) { return }

  event.stopPropagation()
}

export function useColumnResize(options: UseColumnResizeOptions) {
  const { tableKey, tableRef } = options
  const widthsStore = useColumnWidthsStore()

  const laptopQuery: MediaQueryList | null
    = typeof window !== 'undefined'
      ? window.matchMedia(`(min-width: ${BREAKPOINT_LAPTOP})`)
      : null
  const isResizeEnabled = ref(false)

  function handleLaptopChange(event: MediaQueryListEvent | MediaQueryList): void {
    isResizeEnabled.value = event.matches
  }

  const styleElementId = getColumnWidthsStyleId(tableKey)
  let styleElement: HTMLStyleElement | null = null

  function buildStyleRules(): string {
    const scope = `[data-column-resize="${tableKey}"]`
    const widths = widthsStore.tableWidths(tableKey)
    const columns = getTableColumnFields(tableRef.value)

    // Only a table with sized columns gets any table-level rule at all — an
    // untouched one is left byte-for-byte as it was before this feature. With
    // widths present, the table is held at its panel width so the spacer column
    // absorbs what a resize changes; the pinned cells' own min-widths still
    // push it wider than the panel when they outgrow it, which is what hands
    // the overflow to the horizontal scroll (arrows on desktop).
    const rules: string[] = Object.keys(widths).length
      ? [`${scope} table { width: 100% !important; min-width: 100% !important; }`]
      : []

    columns.forEach((field, index) => {
      const nth = index + 1
      const selector = `${scope} table > thead > tr > th:nth-child(${nth}),`
        + `\n${scope} table > tbody > tr > td:nth-child(${nth})`

      if (!field) {
        // PrimeVue puts a resizer on every non-frozen column; the ones carrying
        // no data of their own — the reorder handle, the star, the spacer — are
        // not the user's to size.
        rules.push(
          `${scope} table > thead > tr > th:nth-child(${nth}) .p-datatable-column-resizer { display: none; }`,
        )
        return
      }

      const width = widths[field]
      if (!width) { return }

      // Rigid on all three properties: `width` alone is a preference the table
      // may overrule while distributing its own width, which is how a sized
      // column used to drift back to something else.
      rules.push(
        `${selector} { width: ${width}px !important; min-width: ${width}px !important;`
        + ` max-width: ${width}px !important; }`,
      )
    })

    return rules.join('\n')
  }

  function syncStyleElement(): void {
    if (typeof document === 'undefined') { return }

    if (!isResizeEnabled.value) {
      removeStyleElement()
      return
    }

    if (!styleElement) {
      styleElement = document.createElement('style')
      styleElement.id = styleElementId
      document.head.appendChild(styleElement)
    }
    styleElement.textContent = buildStyleRules()
  }

  function removeStyleElement(): void {
    styleElement?.remove()
    styleElement = null
  }

  /**
   * Record the width the drag asked for.
   *
   * Worked out from the drag's own delta against the width captured when it
   * started, rather than measured afterwards: measuring reads the width back
   * through whatever the layout allowed — the column's own rigid pin among it —
   * and hands back the width it already had, which is how a column could be
   * widened but never narrowed.
   *
   * Only the dragged column is stored. In expand mode nothing else moves; the
   * spacer column gives up or takes back the difference.
   */
  function handleColumnResizeEnd(event: { element?: HTMLElement, delta?: number }): void {
    const drag = dragState
    dragState = null
    if (!drag || !isResizeEnabled.value) { return }

    const delta = typeof event?.delta === 'number' ? event.delta : 0
    if (!delta) { return }

    // The rules PrimeVue writes during a drag pin every column by index, which
    // would hold the spacer at whatever width it happened to have.
    clearNativeResizeState(tableRef.value)

    widthsStore.setColumnWidths(tableKey, {
      // Freeze the layout the user is looking at. Before the first resize the
      // columns share the panel between them, so sizing one would otherwise
      // re-share the rest — recording them all as they stand means the drag
      // moves one column and the spacer alone answers for it.
      ...getRenderedColumnWidths(tableRef.value),
      [drag.field]: Math.max(MIN_COLUMN_WIDTH_PX, Math.round(drag.width + delta)),
    })
  }

  // A drag that starts and ends inside the same header cell still fires a click
  // on it, and PrimeVue reads a header click as "sort this column" — so every
  // small resize would reorder the table. Remember that the gesture began on a
  // resizer and swallow the click before it reaches the cell.
  let isResizerGesture = false

  /**
   * Lift the column's declared minimum as a drag begins.
   *
   * A `<Column style="min-width: 290px">` puts that minimum inline on the header
   * cell AND on every body cell, and it blocks narrowing twice over: PrimeVue
   * reads the header's to decide whether the drag is even allowed, and the body
   * cells' floor what the column can render afterwards — so a narrowed column
   * measured back at its old width and the new size was lost. Relaxing the whole
   * column here hands the floor to the stored width, which the generated
   * stylesheet then applies as a real `min-width`.
   */
  // What the current drag started from: which columns move, and the widths they
  // had when the pointer went down.
  let dragState: { field: string, width: number } | null = null

  // Cells whose declared minimum is lifted for the current drag, each with the
  // inline value to hand back when it ends.
  let relaxedCells: { cell: HTMLElement, minWidth: string }[] = []

  /**
   * Put the declared minimums back once the drag is over.
   *
   * The lift has to end with the gesture. A column the user sized carries its
   * own floor from the generated stylesheet, which outranks anything inline —
   * but a column they reset has nothing left, and would sit below the minimum
   * its <Column> declares for the rest of the session.
   */
  function restoreColumnMinWidths(): void {
    relaxedCells.forEach(({ cell, minWidth }) => {
      if (minWidth) {
        cell.style.minWidth = minWidth
      } else {
        cell.style.removeProperty('min-width')
      }
    })
    relaxedCells = []
  }

  function handleRootMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement | null
    const resizer = target?.closest?.('.p-datatable-column-resizer')
    isResizerGesture = !!resizer
    if (!resizer) { return }

    const headerCell = resizer.closest('th')
    const root = tableRef.value?.$el
    if (!(isElement(headerCell)) || !isElement(root)) { return }

    const siblings = headerCell.parentElement?.children
    const index = siblings ? Array.prototype.indexOf.call(siblings, headerCell) : -1
    if (index < 0) { return }

    restoreColumnMinWidths()

    const draggedField = getTableColumnFields(tableRef.value)[index] ?? null
    dragState = draggedField
      ? { field: draggedField, width: headerCell.getBoundingClientRect().width }
      : null

    const nth = index + 1
    const selector = `table > thead > tr > th:nth-child(${nth}),`
      + ` table > tbody > tr > td:nth-child(${nth})`

    root.querySelectorAll<HTMLElement>(selector).forEach((cell) => {
      relaxedCells.push({ cell, minWidth: cell.style.minWidth })
      cell.style.minWidth = `${MIN_COLUMN_WIDTH_PX}px`
    })

    // Registered after PrimeVue's own document listener, so its resize lands
    // before the minimums come back.
    document.addEventListener('mouseup', restoreColumnMinWidths, { once: true })
  }

  function handleRootClickCapture(event: MouseEvent): void {
    if (!isResizerGesture) { return }
    isResizerGesture = false
    event.stopPropagation()
  }

  watch(
    () => tableRef.value?.$el,
    (root, previousRoot) => {
      if (isElement(previousRoot)) {
        previousRoot.removeEventListener('mousedown', handleRootMouseDown)
        previousRoot.removeEventListener('click', handleRootClickCapture, true)
      }
      if (isElement(root)) {
        root.addEventListener('mousedown', handleRootMouseDown)
        root.addEventListener('click', handleRootClickCapture, true)
      }
    },
    { immediate: true, flush: 'post' },
  )

  // PrimeVue's column list is built from slot children, and reading it registers
  // no reactive dependency a watcher can wake on — so a stylesheet built before
  // the table had rendered its header stayed empty until something else happened
  // to rebuild it, which is why saved widths only appeared after a resize. Watch
  // the DOM instead, which does announce itself.
  let headerObserver: MutationObserver | null = null
  let syncFrameId: number | null = null

  function scheduleStyleSync(): void {
    if (syncFrameId !== null) { return }
    syncFrameId = requestAnimationFrame(() => {
      syncFrameId = null
      syncStyleElement()
      attachHeaderObserver()
    })
  }

  function attachHeaderObserver(): void {
    headerObserver?.disconnect()
    headerObserver = null

    const root = tableRef.value?.$el
    if (!isElement(root) || typeof MutationObserver === 'undefined') { return }

    // Full subtree for the same reason as the menu component: the virtual
    // scroller replaces the <table> wholesale when late-arriving rows land, and
    // an observer bound to a replaced node never fires again.
    const observer = new MutationObserver(() => scheduleStyleSync())
    observer.observe(root, { childList: true, subtree: true })
    headerObserver = observer
  }

  onMounted(() => {
    widthsStore.hydrate()
    if (laptopQuery) {
      handleLaptopChange(laptopQuery)
      laptopQuery.addEventListener('change', handleLaptopChange)
    }
    syncStyleElement()
    attachHeaderObserver()
  })

  onBeforeUnmount(() => {
    laptopQuery?.removeEventListener('change', handleLaptopChange)
    headerObserver?.disconnect()
    if (syncFrameId !== null) { cancelAnimationFrame(syncFrameId) }
    document.removeEventListener('mouseup', restoreColumnMinWidths)
    const root = tableRef.value?.$el
    if (isElement(root)) {
      root.removeEventListener('mousedown', handleRootMouseDown)
      root.removeEventListener('click', handleRootClickCapture, true)
    }
    removeStyleElement()
  })

  // The stylesheet has to track the table, not one moment in its life. Column
  // fields are read off the live DataTable, which resolves them as it renders —
  // building the rules only in `onMounted` meant a table whose columns weren't
  // ready yet (or one that re-rendered later) kept an empty stylesheet, so the
  // saved widths were fetched and then never applied. Watching the fields
  // themselves rebuilds whenever they appear or change.
  watch(
    () => [
      widthsStore.widths[tableKey],
      isResizeEnabled.value,
      getTableColumnFields(tableRef.value).join('|'),
    ],
    () => syncStyleElement(),
    { deep: true, flush: 'post' },
  )

  const tableProps = computed(() => ({
    resizableColumns: isResizeEnabled.value,
    // Only the sort icon sorts — see handleHeaderClickCapture.
    pt: { thead: { onClickCapture: handleHeaderClickCapture } },
    // `expand`: a drag changes the dragged column and nothing else. It would
    // ordinarily resize the table too, but the rules above hold the table at its
    // panel width and let the spacer column absorb the difference.
    columnResizeMode: 'expand' as const,
    'data-column-resize': tableKey,
    onColumnResizeEnd: handleColumnResizeEnd,
  }))

  const menuProps = computed(() => ({
    tableKey,
    tableRef: tableRef.value,
    enabled: isResizeEnabled.value,
  }))

  // Whether this table has any user-sized column. Gates the trailing spacer
  // column in the template: until something is sized (and again after a reset)
  // the spacer isn't rendered at all, so the table lays out exactly as it did
  // before this feature existed — full width, columns sharing the panel.
  const hasStoredWidths = computed(
    () => Object.keys(widthsStore.tableWidths(tableKey)).length > 0,
  )

  return { isResizeEnabled, tableProps, menuProps, hasStoredWidths }
}
