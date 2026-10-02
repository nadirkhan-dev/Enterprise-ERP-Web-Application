<script setup lang="ts">
import { useColumnWidthsStore } from '~/stores/columnWidths'
import {
  clearNativeResizeState,
  isElement,
  getColumnWidthsStyleId,
  getRenderedColumnWidths,
  getTableColumnFields,
  MIN_COLUMN_WIDTH_PX,
} from '~/composables/useColumnResize'

interface Props {
  // Matches the key handed to useColumnResize on the same table.
  tableKey: string
  // The DataTable component instance (`tableRef.value`), not the ref.
  tableRef: any
  // False below the laptop breakpoint, where columns aren't resizable at all.
  enabled?: boolean
}

const props = withDefaults(defineProps<Props>(), { enabled: true })

// A column can always be dragged wider than its content; fitting to content
// should never leave a column too wide to sit beside its neighbours.
const MAX_FIT_WIDTH_PX: number = 640

const widthsStore = useColumnWidthsStore()

const menuRef = ref<{ toggle: (event: Event) => void } | null>(null)
const activeField = ref<string | null>(null)

// One entry per sizable column: the header cell's content row, which the
// ellipsis button is teleported into as its last child. That row is the flex
// container holding the label and the sort icon, so the button picks up the
// same gap they use and needs no positioning of its own — the boundary's
// divider stays a separate thing, out at the cell's trailing edge.
const menuTargets = ref<{ field: string, element: HTMLElement }[]>([])

let headerObserver: MutationObserver | null = null
let syncFrameId: number | null = null

function getRootElement(): HTMLElement | null {
  const root = props.tableRef?.$el
  return isElement(root) ? root : null
}

/**
 * The width a cell's content actually wants, independent of the width it has.
 *
 * Measured with a Range rather than by unconstraining the table and reading it
 * back: a probe like that only reports the truth when every surrounding
 * condition is right, and measuring inside a layout the other columns were still
 * shaping is what made fitting the same column twice give two different answers.
 * A Range reports the laid-out content itself, so a clipped cell still gives up
 * its full width and the answer never depends on the current column widths.
 */
function getCellContentWidth(cell: HTMLElement): number {
  const cellStyle = getComputedStyle(cell)
  const padding = parseFloat(cellStyle.paddingLeft) + parseFloat(cellStyle.paddingRight)
  const headerRow = cell.querySelector<HTMLElement>('.p-datatable-column-header-content')

  if (!headerRow) {
    const range = document.createRange()
    range.selectNodeContents(cell)
    return range.getBoundingClientRect().width + padding
  }

  // A header lays its label, sort icon and menu button out in a flex row, and
  // the button's auto margin would stretch a Range across the whole cell — so
  // total the children instead. Icons carry their width on the box rather than
  // in their contents, hence the larger of the two.
  const rowStyle = getComputedStyle(headerRow)
  const gap = parseFloat(rowStyle.columnGap) || 0
  const children = Array.from(headerRow.children)
  const contentWidth = children.reduce((total, child) => {
    const range = document.createRange()
    range.selectNodeContents(child)
    return total + Math.max(
      range.getBoundingClientRect().width,
      child.getBoundingClientRect().width,
    )
  }, 0)

  return contentWidth + gap * Math.max(0, children.length - 1) + padding
}

function syncMenuTargets(): void {
  const root = props.enabled ? getRootElement() : null
  const next = !root
    ? []
    : getTableColumnFields(props.tableRef).flatMap((field, index) => {
      if (!field) { return [] }
      // Falls back to the cell itself: the content row is PrimeVue's, and a
      // header that renders through a slot alone may not have one.
      const headerCell = root.querySelector<HTMLElement>(
        `table > thead > tr > th:nth-child(${index + 1})`,
      )
      const element = headerCell?.querySelector<HTMLElement>('.p-datatable-column-header-content')
        ?? headerCell
      return isElement(element) ? [{ field, element }] : []
    })

  // Teleporting into the header mutates the very subtree the observer below
  // watches, so only publish a genuinely different set — otherwise each sync
  // would trigger the next one.
  const isUnchanged = next.length === menuTargets.value.length
    && next.every((entry, index) =>
      menuTargets.value[index]?.field === entry.field
      && menuTargets.value[index]?.element === entry.element)
  if (isUnchanged) { return }

  menuTargets.value = next
}

function scheduleSync(): void {
  if (syncFrameId !== null) { return }
  syncFrameId = requestAnimationFrame(() => {
    syncFrameId = null
    syncMenuTargets()
    // Re-bind as well as re-resolve: a rebuild that replaces the header row
    // outright leaves the observer watching a detached node, and the buttons
    // would then be gone for good — nothing left to notice the next rebuild.
    attachHeaderObserver()
  })
}

function handleTriggerClick(field: string, event: Event): void {
  activeField.value = field
  menuRef.value?.toggle(event)
}

/**
 * Size the column to its widest cell by letting the browser measure it: a probe
 * stylesheet lifts the pinned width for that column only, the natural cell
 * widths are read back, and the probe is dropped again before anything paints.
 */
function fitToContent(): void {
  const field = activeField.value
  const root = getRootElement()
  if (!field || !root) { return }

  const index = getTableColumnFields(props.tableRef).indexOf(field)
  if (index < 0) { return }

  // Snapshot the layout as it stands BEFORE tearing anything down — measured
  // after the clear, these read as the columns reflow rather than as the user
  // left them.
  const renderedWidths = getRenderedColumnWidths(props.tableRef)

  // Drop the layout PrimeVue pinned on its last drag: those rules are more
  // specific than ours, so the width we're about to store would lose to them.
  clearNativeResizeState(props.tableRef)

  const cells = root.querySelectorAll<HTMLElement>(
    `table > thead > tr > th:nth-child(${index + 1}), table > tbody > tr > td:nth-child(${index + 1})`,
  )
  // Rounded up, not down: these cells are fractional (padding in vw-based
  // clamps, proportional label text), and a width a fraction short of the
  // content trails the last glyph off.
  const naturalWidth = Array.from(cells).reduce(
    (widest, cell) => Math.max(widest, Math.ceil(getCellContentWidth(cell))),
    0,
  )

  if (!naturalWidth) { return }

  // Recorded alongside the layout as it stands, exactly as a drag does: fitting
  // one column shouldn't re-share the width of every other one. The spacer
  // column takes what this column gives up.
  widthsStore.setColumnWidths(props.tableKey, {
    ...renderedWidths,
    [field]: Math.max(MIN_COLUMN_WIDTH_PX, Math.min(naturalWidth, MAX_FIT_WIDTH_PX)),
  })
}
function measureNaturalWidths(): Record<string, number> {
  const styleElement = document.getElementById(getColumnWidthsStyleId(props.tableKey))
  const pinnedRules = styleElement?.textContent ?? ''

  const scope = `[data-column-resize="${props.tableKey}"]`
  const probe = document.createElement('style')
  probe.textContent = `${scope} table > thead > tr > th.table-spacer,`
    + `${scope} table > tbody > tr > td.table-spacer`
    + ' { width: 0 !important; min-width: 0 !important; max-width: 0 !important; }'

  if (styleElement) { styleElement.textContent = '' }
  document.head.appendChild(probe)

  // Reading a rect forces the layout the blanked rules describe.
  const naturalWidths = getRenderedColumnWidths(props.tableRef)

  probe.remove()
  if (styleElement) { styleElement.textContent = pinnedRules }

  return naturalWidths
}

function resetColumn(): void {
  const field = activeField.value
  if (!field || !getRootElement()) { return }

  // Before measuring: a drag leaves `!important` rules of its own behind, and
  // they would describe the layout being reset away.
  clearNativeResizeState(props.tableRef)

  const widths = getRenderedColumnWidths(props.tableRef)
  const naturalWidth = measureNaturalWidths()[field]

  if (naturalWidth) {
    widths[field] = Math.max(MIN_COLUMN_WIDTH_PX, naturalWidth)
  } else {
    // Nothing to measure (a table still rendering): fall back to dropping the
    // override and letting the column find its own width.
    delete widths[field]
  }

  widthsStore.replaceTableWidths(props.tableKey, widths)
}

function resetAllColumns(): void {
  widthsStore.resetTable(props.tableKey)
  clearNativeResizeState(props.tableRef)
}

const menuItems = computed(() => [
  { label: 'Fit to content', icon: 'pi pi-arrows-h', command: fitToContent },
  { separator: true },
  { label: 'Reset this column', icon: 'pi pi-replay', command: resetColumn },
  { label: 'Reset all columns', icon: 'pi pi-replay', command: resetAllColumns },
])

function attachHeaderObserver(): void {
  headerObserver?.disconnect()
  headerObserver = null

  const root = getRootElement()
  if (!root || typeof MutationObserver === 'undefined') { return }

  const observer = new MutationObserver(() => scheduleSync())
  observer.observe(root, { childList: true, subtree: true })
  headerObserver = observer
}

// The column fields are part of the source deliberately: they resolve as the
// DataTable renders, and watching only the table instance meant a first pass
// that found no columns was also the last one — the header came back after a
// reload with no menu buttons at all.
watch(
  () => [
    props.tableRef,
    // `enabled` flips true only after the parent's onMounted has measured the
    // viewport — without it in the sources, a menu that first synced while
    // disabled found no targets and was never asked again.
    props.enabled,
    widthsStore.widths[props.tableKey],
    getTableColumnFields(props.tableRef).join('|'),
  ],
  () => {
    nextTick(() => {
      syncMenuTargets()
      attachHeaderObserver()
    })
  },
  { deep: true, immediate: true },
)

onBeforeUnmount(() => {
  headerObserver?.disconnect()
  if (syncFrameId !== null) { cancelAnimationFrame(syncFrameId) }
})
</script>

<template>
  <Teleport
    v-for="target in menuTargets"
    :key="target.field"
    :to="target.element"
  >
    <Button
      icon="pi pi-ellipsis-v"
      text
      size="small"
      severity="secondary"
      class="column-resize-menu__trigger"
      aria-label="Column options"
      @mousedown.stop
      @keydown.enter.stop
      @keydown.space.stop
      @click.stop="handleTriggerClick(target.field, $event)"
    />
  </Teleport>

  <Menu
    ref="menuRef"
    :model="menuItems"
    popup
    class="column-resize-menu"
  />
</template>

<style scoped>
/* The last item in the header cell's flex row, parked against the trailing edge:
   a column wider than its label leaves the space between the sort icon and this
   button, rather than trailing it along behind the text. A narrow column closes
   that space up to the row's own gap and truncates the label instead — the
   button never shrinks. */
.column-resize-menu__trigger.p-button {
    flex: 0 0 auto;
    margin-inline-start: auto;
    width: var(--p-spacing-4);
    height: var(--p-spacing-4);
    min-width: var(--p-spacing-4);
    padding: 0;
    cursor: pointer;
    color: var(--p-gray-500);
}

.column-resize-menu__trigger.p-button:hover,
.column-resize-menu__trigger.p-button:focus-visible {
    color: var(--p-skyblue-600);
    background: transparent;
}

.column-resize-menu__trigger.p-button :deep(.p-button-icon) {
    font-size: var(--p-font-size-xs);
}
</style>
