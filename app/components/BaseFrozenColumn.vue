<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { BREAKPOINT_LAPTOP } from '~/utils/breakpoints'

interface FrozenColumnAction {
  // A static icon class, or a resolver so the icon can vary per row
  // (e.g. swap to a spinner while that row's action is in flight).
  icon: string | ((rowData: Record<string, unknown>) => string)
  color?: string
  disabled?: (rowData: Record<string, unknown>) => boolean
  handler?: (rowData: Record<string, unknown>) => void
}

/**
 * A DOM element, safe to ask on the server. `instanceof HTMLElement` throws
 * during server rendering, where the constructor doesn't exist — and the
 * `immediate` watcher below runs there too.
 */
function isElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement
}

function resolveIcon(
  icon: FrozenColumnAction['icon'],
  rowData: Record<string, unknown>,
): string {
  return typeof icon === 'function' ? icon(rowData) : icon
}

// Material Symbols ('ms:local_shipping') render as an inline SVG via AppNavIcon;
// PrimeIcons ('pi pi-file') are a class on the button. Same actions API either way.
function isMaterialIcon(icon: string): boolean {
  return icon.startsWith('ms:')
}

interface Props {
  tableRef: Record<string, unknown>
  actions?: FrozenColumnAction[]
  scrollableOnly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  actions: () => [],
  scrollableOnly: false,
})

const { scrollLeft, scrollRight, isScrollable, isAtScrollEnd } = useTableScroll(
  computed(() => props.tableRef),
)

// Track the same threshold the CSS `@media (min-width: 1024px)` rule uses
// (see `data-table.css` `.scroll-nav`). `window.innerWidth` rounds and on
// some platforms includes the scrollbar — using `matchMedia` keeps the JS
// flip and the CSS flip locked to the exact same pixel, so the mobile
// toggle and the desktop scroll-nav can't be on-screen at once.
const laptopQuery: MediaQueryList | null
  = typeof window !== 'undefined'
    ? window.matchMedia(`(min-width: ${BREAKPOINT_LAPTOP})`)
    : null
const isBelowLaptop = ref(laptopQuery ? !laptopQuery.matches : false)

function handleLaptopChange(event: MediaQueryListEvent | MediaQueryList) {
  isBelowLaptop.value = !event.matches
  const root = teleportTarget.value
  if (isElement(root)) {
    syncToggleOffset(root)
  }
}

onMounted(() => {
  if (!laptopQuery) { return }
  handleLaptopChange(laptopQuery)
  laptopQuery.addEventListener('change', handleLaptopChange)
})
onBeforeUnmount(() => {
  laptopQuery?.removeEventListener('change', handleLaptopChange)
})

const hasActions = computed(() => props.actions.length > 0)

const isMobileActionsOpen = ref(false)
const showMobileToggle = computed(
  () => isBelowLaptop.value && hasActions.value,
)

const teleportTarget = ref<HTMLElement | null>(null)
let layoutResizeObserver: ResizeObserver | null = null
let rootMutationObserver: MutationObserver | null = null

// The element that actually scrolls the rows — `.p-virtualscroller` when the
// table runs `virtualScrollerOptions`, the table container otherwise.
function getScrollHost(rootEl: HTMLElement): HTMLElement | null {
  const container = rootEl.querySelector(
    ':scope > .p-datatable-table-container',
  ) as HTMLElement | null
  if (!container) { return null }
  const scroller = container.querySelector(
    ':scope > .p-virtualscroller',
  ) as HTMLElement | null
  return scroller ?? container
}

function syncToggleOffset(rootEl: HTMLElement): void {
  const header = rootEl.querySelector(':scope > .p-datatable-header') as HTMLElement | null
  const offset = header ? header.offsetHeight : 0
  rootEl.style.setProperty('--frozen-toggle-top', `${offset}px`)

  rootEl.style.setProperty('--frozen-action-count', `${props.actions.length || 1}`)
  const host = getScrollHost(rootEl)
  const gutter = host ? Math.max(0, host.offsetWidth - host.clientWidth) : 0
  rootEl.style.setProperty('--frozen-toggle-right', `${gutter}px`)
}

function attachLayoutObserver(rootEl: HTMLElement): void {
  layoutResizeObserver?.disconnect()
  layoutResizeObserver = null
  if (typeof ResizeObserver === 'undefined') { return }
  const header = rootEl.querySelector(':scope > .p-datatable-header') as HTMLElement | null
  const observed = [header, getScrollHost(rootEl)].filter(
    (element): element is HTMLElement => isElement(element),
  )
  if (!observed.length) { return }
  const observer = new ResizeObserver(() => syncToggleOffset(rootEl))
  observed.forEach(element => observer.observe(element))
  layoutResizeObserver = observer
}

watch(
  () => props.tableRef,
  (instance) => {
    const dataTableEl = (instance as unknown as ComponentPublicInstance | null)?.$el
    const root = isElement(dataTableEl) ? dataTableEl : null
    teleportTarget.value = root

    rootMutationObserver?.disconnect()
    rootMutationObserver = null
    layoutResizeObserver?.disconnect()
    layoutResizeObserver = null

    if (root) {
      syncToggleOffset(root)
      attachLayoutObserver(root)
      // `.p-datatable-header` is added/removed dynamically when the search
      // slot toggles — re-query and rebind whenever direct children change.
      if (typeof MutationObserver !== 'undefined') {
        rootMutationObserver = new MutationObserver(() => {
          syncToggleOffset(root)
          attachLayoutObserver(root)
        })
        rootMutationObserver.observe(root, { childList: true })
      }
    }
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  layoutResizeObserver?.disconnect()
  rootMutationObserver?.disconnect()
})

// Toggle a class on the DataTable root when scrolled to the right edge,
// so CSS can suppress the frozen-column shadow (no data hidden behind it).
watch(
  [() => teleportTarget.value, isAtScrollEnd],
  ([root, atEnd]) => {
    if (!isElement(root)) {return}
    root.classList.toggle('is-scroll-end', atEnd)
  },
  { immediate: true, flush: 'post' },
)

const shouldRenderColumn = computed(() => {
  if (isBelowLaptop.value) {
    return hasActions.value && isMobileActionsOpen.value
  }
  return props.scrollableOnly
    ? isScrollable.value
    : (hasActions.value || isScrollable.value)
})
watch(shouldRenderColumn, () => {
  const root = teleportTarget.value
  if (isElement(root)) {
    nextTick(() => syncToggleOffset(root))
  }
})
</script>

<template>
  <Teleport
    v-if="showMobileToggle && teleportTarget"
    :to="teleportTarget"
  >
    <Button
      icon="pi pi-ellipsis-v"
      text
      size="small"
      severity="primary"
      class="frozen-mobile-toggle"
      :aria-pressed="isMobileActionsOpen"
      aria-label="Toggle row actions"
      @click="isMobileActionsOpen = !isMobileActionsOpen"
    />
  </Teleport>
  <Column
    v-if="shouldRenderColumn"
    frozen
    align-frozen="right"
    style="width: var(--frozen-col-width, 70px)"
  >
    <template #header>
      <div
        v-if="isScrollable && !isBelowLaptop"
        class="scroll-nav"
      >
        <Button
          icon="pi pi-angle-left"
          outlined
          size="small"
          severity="secondary"
          @click="scrollLeft"
        />
        <Button
          icon="pi pi-angle-right"
          outlined
          size="small"
          severity="secondary"
          @click="scrollRight"
        />
      </div>
    </template>
    <template #body="slotProps">
      <div class="frozen-column-body">
        <div
          v-if="slotProps.data?._skeleton"
          class="skeleton-block"
        />
        <span
          v-for="(action, actionIndex) in (slotProps.data?._skeleton ? [] : actions)"
          :key="actionIndex"
          class="frozen-column-body__action"
          :class="{ 'frozen-column-body__action--loading': resolveIcon(action.icon, slotProps.data).includes('pi-spinner') }"
        >
          <Button
            :icon="isMaterialIcon(resolveIcon(action.icon, slotProps.data))
              ? undefined
              : resolveIcon(action.icon, slotProps.data)"
            :class="{
              'p-button-icon-only': isMaterialIcon(resolveIcon(action.icon, slotProps.data)),
            }"
            :style="
              action.color
                ? {'--frozen-action-color': action.color}
                : null
            "
            text
            size="small"
            severity="secondary"
            :disabled="action.disabled?.(slotProps.data)"
            @click="action.handler?.(slotProps.data)"
          >
            <AppNavIcon
              v-if="isMaterialIcon(resolveIcon(action.icon, slotProps.data))"
              :icon="resolveIcon(action.icon, slotProps.data)"
              aria-hidden="true"
            />
          </Button>
          <BaseSpinner
            v-if="resolveIcon(action.icon, slotProps.data).includes('pi-spinner')"
            size="sm"
            class="frozen-column-body__spinner"
          />
        </span>
      </div>
    </template>
  </Column>
</template>
