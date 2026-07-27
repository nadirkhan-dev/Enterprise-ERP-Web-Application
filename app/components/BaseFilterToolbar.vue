<script setup lang="ts">
import { useIsMobile } from '~/composables/useIsMobile'
import { FILTER_COLLAPSE_KEY, useFilterCollapse } from '~/composables/useFilterCollapse'

interface Props {
  filterCount?: number
  ariaLabel?: string
  drawerClass?: string
  inline?: boolean
  /** Filter button icon. Defaults to the funnel; the detail-page nav toolbars
   *  pass the older sliders icon. */
  icon?: string
}

const props = withDefaults(defineProps<Props>(), {
  filterCount: 0,
  ariaLabel: 'Filter',
  drawerClass: '',
  inline: false,
  icon: 'pi pi-filter',
})

const emit = defineEmits<{
  (e: 'clear-all'): void
  (e: 'open', event: Event): void
  (e: 'show'): void
  (e: 'hide'): void
}>()

const { isMobile } = useIsMobile()
const popoverRef = ref<any>(null)
const isDrawerVisible = ref(false)

// Inline (detail-page) filter: a custom dropdown positioned as a real child of the
// trigger button instead of PrimeVue's teleported, JS-aligned popover. Being a
// `position: absolute` child of a `position: relative` anchor means it tracks the
// button on any resize/scroll automatically and the arrow is centred with pure CSS —
// no stale positions, no viewport-edge overflow drift. The full (list) filter keeps
// the PrimeVue popover.
const inlineAnchorRef = ref<HTMLElement | null>(null)
const inlinePopBodyRef = ref<HTMLElement | null>(null)
const isInlineOpen = ref(false)

// CONNECT-574 — auto-collapse the lowest-priority filter sections when the panel
// would overflow the viewport height. The controller is provided to the slotted
// BaseFilterSections; we drive a reflow whenever a panel opens or the viewport
// resizes. The mobile drawer scrolls internally, so it needs no auto-fit.
const { controller: collapseController, reflow } = useFilterCollapse()
provide(FILTER_COLLAPSE_KEY, collapseController)

function getPopoverBody(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.filter-toolbar__popover .filter-toolbar__popover-body')
}

function scheduleReflow(getPanelBody: () => HTMLElement | null) {
  requestAnimationFrame(() => { reflow(getPanelBody) })
}

function isBadgeClick(event: Event): boolean {
  return !!(event.target as HTMLElement | null)?.closest('.p-badge')
}

function handleBadgeClick(event: MouseEvent) {
  if (!isBadgeClick(event)) { return }
  event.stopPropagation()
  emit('clear-all')
}

function handleInlineOutsideClick(event: MouseEvent) {
  if (inlineAnchorRef.value && !inlineAnchorRef.value.contains(event.target as Node)) {
    closeInline()
  }
}

function handleInlineKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { closeInline() }
}

function handleInlineResize() {
  scheduleReflow(() => inlinePopBodyRef.value)
}

function openInline() {
  if (isInlineOpen.value) { return }
  isInlineOpen.value = true
  emit('show')
  // Defer binding so this same opening click doesn't immediately close it.
  nextTick(() => {
    document.addEventListener('click', handleInlineOutsideClick, true)
    document.addEventListener('keydown', handleInlineKeydown)
    window.addEventListener('resize', handleInlineResize, { passive: true })
    scheduleReflow(() => inlinePopBodyRef.value)
  })
}

function closeInline() {
  if (!isInlineOpen.value) { return }
  isInlineOpen.value = false
  document.removeEventListener('click', handleInlineOutsideClick, true)
  document.removeEventListener('keydown', handleInlineKeydown)
  window.removeEventListener('resize', handleInlineResize)
  emit('hide')
}

function handleFilterButtonClick(event: Event) {
  emit('open', event)
  if (isMobile.value) {
    isDrawerVisible.value = true
  } else if (props.inline) {
    if (isInlineOpen.value) { closeInline() } else { openInline() }
  } else {
    popoverRef.value?.toggle(event)
  }
}

function handleScrollClose(event: Event) {
  const popoverEl = document.querySelector('.filter-toolbar__popover')
  if (popoverEl && popoverEl.contains(event.target as Node)) { return }
  popoverRef.value?.hide()
}

// PrimeVue re-positions the popover only when it (re)opens, and its built-in
// resize handler closes the panel only on non-touch devices. On a touch screen a
// resize/rotation therefore leaves the panel open but stale — anchored to where
// the button used to be, so the arrow detaches. Close it on resize for everyone so
// it always reopens correctly aligned (matches PrimeVue's own desktop behaviour).
function handleResizeClose() {
  popoverRef.value?.hide()
}

function handlePopoverShow() {
  window.addEventListener('scroll', handleScrollClose, { passive: true, capture: true })
  window.addEventListener('resize', handleResizeClose, { passive: true })
  emit('show')
  scheduleReflow(getPopoverBody)
}

function handlePopoverHide() {
  window.removeEventListener('scroll', handleScrollClose, true)
  window.removeEventListener('resize', handleResizeClose)
  emit('hide')
}

watch(isDrawerVisible, (visible) => {
  if (visible) {
    emit('show')
  } else {
    emit('hide')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', handleScrollClose, true)
  window.removeEventListener('resize', handleResizeClose)
  window.removeEventListener('resize', handleInlineResize)
  document.removeEventListener('click', handleInlineOutsideClick, true)
  document.removeEventListener('keydown', handleInlineKeydown)
})

defineExpose({
  hide: () => {
    popoverRef.value?.hide()
    isDrawerVisible.value = false
    closeInline()
  },
})
</script>

<template>
  <Teleport
    to="#top-nav-filter-slot"
    defer
    :disabled="props.inline"
  >
    <span
      ref="inlineAnchorRef"
      :class="['filter-toolbar__anchor', { 'filter-toolbar__anchor--inline': props.inline }]"
    >
      <OverlayBadge
        :value="props.filterCount"
        severity="danger"
        :class="[
          'filter-toolbar__filter-badge',
          {
            'filter-toolbar__filter-badge--inline': props.inline,
            'filter-toolbar__filter-badge--hidden': props.filterCount === 0,
          },
        ]"
        @click="handleBadgeClick"
      >
        <Button
          outlined
          size="small"
          :icon="props.icon"
          :class="['filter-toolbar__filter-btn', { 'filter-toolbar__filter-btn--inline': props.inline }]"
          :aria-label="props.ariaLabel"
          @click="handleFilterButtonClick"
        />
      </OverlayBadge>

      <!-- Inline (detail-page) dropdown: arrow + panel are positioned children of the
           button anchor (a sibling pair, not nested), so the panel stays glued to the
           button and the arrow is centred on it (`left: 50%` of the button) via CSS. -->
      <template v-if="props.inline && !isMobile">
        <Transition name="filter-toolbar__inline-arrow-fade">
          <span
            v-if="isInlineOpen"
            class="filter-toolbar__inline-arrow"
          />
        </Transition>
        <Transition name="filter-toolbar__inline-popover">
          <div
            v-if="isInlineOpen"
            class="filter-toolbar__inline-pop"
          >
            <div
              ref="inlinePopBodyRef"
              class="filter-toolbar__popover-body"
            >
              <slot />
            </div>
          </div>
        </Transition>
      </template>
    </span>
  </Teleport>

  <Popover
    v-if="!props.inline && !isMobile"
    ref="popoverRef"
    class="filter-toolbar__popover"
    @show="handlePopoverShow"
    @hide="handlePopoverHide"
  >
    <div class="filter-toolbar__popover-body">
      <slot />
    </div>
  </Popover>

  <BaseDrawer
    v-if="isMobile"
    v-model:visible="isDrawerVisible"
    title="Filter By"
    :class="['filter-toolbar__drawer', props.drawerClass]"
  >
    <div class="filter-toolbar__drawer-body">
      <slot />
    </div>
  </BaseDrawer>
</template>

<style>
/* Filter button (teleported into AppTopNav) */
.filter-toolbar__filter-badge--hidden .p-badge {
    display: none;
}

.filter-toolbar__filter-badge {
    display: flex;
    align-items: stretch;
}

.filter-toolbar__filter-badge .p-overlaybadge {
    display: flex;
    align-items: stretch;
}

.filter-toolbar__filter-badge .p-badge {
    cursor: pointer;
}

.filter-toolbar__filter-badge .p-badge:hover {
    color: transparent;
}

.filter-toolbar__filter-badge .p-badge:hover::after {
    content: '\e90b';
    font-family: 'primeicons';
    font-style: normal;
    font-weight: normal;
    line-height: 1;
    color: var(--p-surface-0);
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--p-font-size-xxs);
}

.filter-toolbar__filter-btn.p-button {
    width: auto;
    height: 100%;
    min-width: 0;
    padding: var(--p-button-padding-y) var(--p-spacing-3);
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

/* Inline filter renders at its natural size=small (like the data-table filter
   buttons), not a fixed square. */
.filter-toolbar__filter-badge--inline,
.filter-toolbar__filter-badge--inline .p-overlaybadge {
    width: auto;
    height: auto;
    min-width: auto;
    min-height: auto;
    max-width: none;
    max-height: none;
}

.filter-toolbar__filter-btn--inline.p-button {
    width: var(--p-spacing-8);
    min-width: var(--p-spacing-8);
    height: var(--p-spacing-8);
    padding: 0;
    border-radius: var(--p-border-radius-xs);
    border-color: var(--p-skyblue-200);

    @media (min-width: 768px) {
        width: auto;
        min-width: 0;
        height: auto;
        padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    }
}

.filter-toolbar__filter-btn--inline.p-button .p-button-icon {
    font-size: var(--p-font-size-sm);
}

.filter-toolbar__popover .p-popover-content {
    padding: clamp(var(--p-spacing-3), 1.5vw, var(--p-spacing-4));
    /* Fallback: if even a fully collapsed panel can't fit a very short viewport,
       scroll instead of clipping the bottom sections (CONNECT-574). */
    max-height: calc(100dvh - var(--p-spacing-16));
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--p-gray-100) transparent;
}

.filter-toolbar__popover .p-popover-content::-webkit-scrollbar {
    width: var(--p-spacing-2-25);
}

.filter-toolbar__popover .p-popover-content::-webkit-scrollbar-track {
    background: transparent;
}

.filter-toolbar__popover .p-popover-content::-webkit-scrollbar-thumb {
    background: var(--p-gray-100);
    border-radius: var(--p-border-radius-sm);
}

/* Anchor: transparent for the teleported list filter (no box, no layout impact),
   a positioned box for the inline detail filter so its dropdown anchors to it. */
.filter-toolbar__anchor {
    display: contents;
}

.filter-toolbar__anchor--inline {
    display: inline-flex;
    position: relative;
}

/* Inline dropdown panel — opens below the button, right-aligned so it never spills
   off the right edge (the detail filter sits on the right of the toolbar). */
.filter-toolbar__inline-pop {
    position: absolute;
    top: calc(100% + var(--p-spacing-2));
    right: 0;
    z-index: 1100;
    background: var(--p-popover-background, var(--p-surface-0));
    border: 1px solid var(--p-popover-border-color, var(--p-surface-200));
    border-radius: var(--p-popover-border-radius, var(--p-border-radius-md));
    box-shadow: var(--p-popover-shadow, var(--p-shadow-md));
    padding: clamp(var(--p-spacing-3), 1.5vw, var(--p-spacing-4));
    transform-origin: top right;
    /* Fallback scroll for very short viewports — see popover note above. */
    max-height: calc(100dvh - var(--p-spacing-20));
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--p-gray-100) transparent;
}

.filter-toolbar__inline-pop::-webkit-scrollbar {
    width: var(--p-spacing-2-25);
}

.filter-toolbar__inline-pop::-webkit-scrollbar-track {
    background: transparent;
}

.filter-toolbar__inline-pop::-webkit-scrollbar-thumb {
    background: var(--p-gray-100);
    border-radius: var(--p-border-radius-sm);
}

.filter-toolbar__inline-popover-enter-active,
.filter-toolbar__inline-popover-leave-active {
    transition:
        opacity var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        transform var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.filter-toolbar__inline-popover-enter-from,
.filter-toolbar__inline-popover-leave-to {
    opacity: 0;
    transform: scale(0.96) translateY(calc(-1 * var(--p-spacing-2)));
}

.filter-toolbar__inline-arrow-fade-enter-active,
.filter-toolbar__inline-arrow-fade-leave-active {
    transition: opacity var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.filter-toolbar__inline-arrow-fade-enter-from,
.filter-toolbar__inline-arrow-fade-leave-to {
    opacity: 0;
}

/* Arrow: a rotated square straddling the panel's top edge, centred on the button
   via `left: 50%` of the button-width anchor — so it stays under the button at any
   size with zero JS. */
.filter-toolbar__inline-arrow {
    position: absolute;
    top: calc(100% + var(--p-spacing-2));
    left: 50%;
    width: var(--p-spacing-3);
    height: var(--p-spacing-3);
    background: var(--p-popover-background, var(--p-surface-0));
    border-top: 1px solid var(--p-popover-border-color, var(--p-surface-200));
    border-left: 1px solid var(--p-popover-border-color, var(--p-surface-200));
    transform: translate(-50%, -50%) rotate(45deg);
    z-index: 1101;
}

.filter-toolbar__popover-body {
    display: flex;
    flex-direction: column;
    gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
    width: var(--p-layout-popover-filter-width);
    min-width: var(--p-layout-popover-filter-min-width);
}

.filter-toolbar__drawer-body {
    display: flex;
    flex-direction: column;
    gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
    padding-top: var(--p-spacing-2-25);
}

.filter-toolbar__drawer .p-drawer-header {
    padding-top: var(--p-spacing-2);
    padding-bottom: var(--p-spacing-2);
    padding-right: var(--p-spacing-2);
}
.filter-toolbar__drawer .drawer-title {
    font-family: var(--p-font-family);
    font-size: var(--p-font-size-xl);
    font-style: normal;
    font-weight: 700;
}

.filter-toolbar__drawer--fill .p-drawer-content {
    overflow: hidden;
    min-height: 0;
    scrollbar-width: none;
    scrollbar-gutter: auto;
}
.filter-toolbar__drawer--fill .p-drawer-content::-webkit-scrollbar {
    display: none;
}
.filter-toolbar__drawer--fill .drawer-body,
.filter-toolbar__drawer--fill .filter-toolbar__drawer-body {
    min-height: 0;
    height: 100%;
}
</style>
