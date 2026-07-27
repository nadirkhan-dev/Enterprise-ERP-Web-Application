<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { BREAKPOINT_LAPTOP } from '~/utils/breakpoints'

interface FrozenColumnAction {
  // A static icon class, or a resolver so the icon can vary per row
  // (e.g. swap to a spinner while that row's action is in flight).
  icon: string | ((rowData: Record<string, unknown>) => string)
  color?: string
  handler?: (rowData: Record<string, unknown>) => void
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

const hasActions = computed(() => props.actions.length > 0)

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
  // Re-measure the frozen column — its width is viewport-dependent (clamp).
  const root = teleportTarget.value
  if (root instanceof HTMLElement) {
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

const isMobileActionsOpen = ref(false)
const showMobileToggle = computed(
  () => isBelowLaptop.value && hasActions.value,
)

const teleportTarget = ref<HTMLElement | null>(null)
let headerResizeObserver: ResizeObserver | null = null
let rootMutationObserver: MutationObserver | null = null

function syncToggleOffset(rootEl: HTMLElement): void {
  const header = rootEl.querySelector(':scope > .p-datatable-header') as HTMLElement | null
  const offset = header ? header.offsetHeight : 0
  rootEl.style.setProperty('--frozen-toggle-top', `${offset}px`)
  const frozenCell = rootEl.querySelector('.p-datatable-frozen-column') as HTMLElement | null
  if (frozenCell) {
    rootEl.style.setProperty('--frozen-toggle-width', `${frozenCell.offsetWidth}px`)
  }
}

function attachHeaderObserver(rootEl: HTMLElement): void {
  headerResizeObserver?.disconnect()
  headerResizeObserver = null
  const header = rootEl.querySelector(':scope > .p-datatable-header') as HTMLElement | null
  if (header && typeof ResizeObserver !== 'undefined') {
    headerResizeObserver = new ResizeObserver(() => syncToggleOffset(rootEl))
    headerResizeObserver.observe(header)
  }
}

watch(
  () => props.tableRef,
  (instance) => {
    const dataTableEl = (instance as unknown as ComponentPublicInstance | null)?.$el
    const root = dataTableEl instanceof HTMLElement ? dataTableEl : null
    teleportTarget.value = root

    rootMutationObserver?.disconnect()
    rootMutationObserver = null
    headerResizeObserver?.disconnect()
    headerResizeObserver = null

    if (root) {
      syncToggleOffset(root)
      attachHeaderObserver(root)
      // `.p-datatable-header` is added/removed dynamically when the search
      // slot toggles — re-query and rebind whenever direct children change.
      if (typeof MutationObserver !== 'undefined') {
        rootMutationObserver = new MutationObserver(() => {
          syncToggleOffset(root)
          attachHeaderObserver(root)
        })
        rootMutationObserver.observe(root, { childList: true })
      }
    }
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(() => {
  headerResizeObserver?.disconnect()
  rootMutationObserver?.disconnect()
})

// Toggle a class on the DataTable root when scrolled to the right edge,
// so CSS can suppress the frozen-column shadow (no data hidden behind it).
watch(
  [() => teleportTarget.value, isAtScrollEnd],
  ([root, atEnd]) => {
    if (!(root instanceof HTMLElement)) {return}
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
  if (root instanceof HTMLElement) {
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
        <span
          v-for="(action, actionIndex) in actions"
          :key="actionIndex"
          class="frozen-column-body__action"
          :class="{ 'frozen-column-body__action--loading': resolveIcon(action.icon, slotProps.data).includes('pi-spinner') }"
        >
          <!-- The icon button is unchanged so its width never shifts. While
               loading the resolver returns a spinner icon (hidden via CSS for
               sizing) and BaseSpinner is overlaid on top.
               A `ms:*` icon is a Material Symbol (the side nav's set) — it's an
               inline SVG, so it goes in the button's default slot rather than the
               class-based `icon` prop that PrimeIcons use. -->
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
