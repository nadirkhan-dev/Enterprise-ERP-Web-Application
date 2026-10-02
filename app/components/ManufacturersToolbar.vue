<script setup lang="ts">
import { useManufacturersNavigationStore } from '~/stores/manufacturersNavigation'

interface Props {
  /**
   * Show the detail-page navigation: prev/next chevrons. Manufacturers
   * have no list-level filters, so this is the only mode the toolbar
   * renders content in — when false it renders nothing.
   */
  showNavigation?: boolean
}

withDefaults(defineProps<Props>(), {
  showNavigation: false,
})

const navStore = useManufacturersNavigationStore()

const previousEntry = computed(() => navStore.previousEntry)
const nextEntry = computed(() => navStore.nextEntry)
const previousId = computed(() => previousEntry.value?.id ?? null)
const nextId = computed(() => nextEntry.value?.id ?? null)
const previousName = computed(() => previousEntry.value?.name ?? null)
const nextName = computed(() => nextEntry.value?.name ?? null)
// Drives the greyed-out state. With wrap-around a chevron is unavailable only
// at a genuine dead end (empty set, lone current manufacturer, or the unused
// side of a single-other-manufacturer set) — never just while a target loads.
const canGoPrevious = computed(() => navStore.canGoPrevious)
const canGoNext = computed(() => navStore.canGoNext)

// Hover tooltips. When the target is known we show its name; when the side is
// navigable but its target isn't loaded yet (a backward wrap to the last
// manufacturer) we show a generic label; when the side is a dead end we explain
// why nothing happens on click.
const previousTooltip = computed(() => {
  if (!canGoPrevious.value) { return 'No previous manufacturer' }
  return previousName.value || previousId.value || 'Previous manufacturer'
})
const nextTooltip = computed(() => {
  if (!canGoNext.value) { return 'No next manufacturer' }
  return nextName.value || nextId.value || 'Next manufacturer'
})
// Per-button loading shimmer: shown while the whole window is (re)building, and
// while a navigable side's target is still being fetched (most visibly the
// Previous wrap to the last manufacturer, whose tail lands a beat after the head
// arrives from the list cache). Showing the shimmer there turns a blank → pop
// "blink" into a smooth, intentional loading state.
const isPreviousLoading = computed(
  () => navStore.isBuilding || (canGoPrevious.value && !previousId.value),
)
const isNextLoading = computed(
  () => navStore.isBuilding || (canGoNext.value && !nextId.value),
)

async function goToPrevious() {
  if (!navStore.canGoPrevious) { return }
  let target = navStore.previousEntry
  if (!target) {
    // Target not loaded yet: either the tail (the wrap target) hasn't been
    // seeded, or we're at the tail's loaded start and need the older slice.
    await navStore.ensureTail()
    if (!navStore.previousEntry) { await navStore.loadMoreTail() }
    target = navStore.previousEntry
  }
  if (!target) { return }
  navigateToEntry(target)
}

async function goToNext() {
  if (!navStore.canGoNext) { return }
  let target = navStore.nextEntry
  if (!target && navStore.hasMoreForward) {
    // More rows exist beyond the head — load the next chunk, then re-read.
    // Re-reading yields the real next manufacturer, or the wrap-to-first once
    // the forward end is reached.
    await navStore.loadNextChunk(false)
    target = navStore.nextEntry
  }
  if (!target) { return }
  navigateToEntry(target)
}

// Routes to a Next/Prev target. The target always lives in a loaded segment
// (head or tail), so the destination's cursor will find it — keep it an
// internal navigation so both windows are preserved.
function navigateToEntry(target: { id: string }) {
  const inHead = navStore.entries.some((entry) => entry.id === target.id)
  const inTail = navStore.tailEntries.some((entry) => entry.id === target.id)
  if (inHead || inTail) {
    navStore.markInternalNavigation(target.id)
  }
  navigateTo(`/manufacturers/${target.id}`)
}
</script>

<template>
  <div
    v-if="showNavigation"
    class="manufacturers-toolbar"
  >
    <div class="manufacturers-toolbar__nav-buttons">
      <Button
        outlined
        severity="secondary"
        size="small"
        :class="[
          'manufacturers-toolbar__nav-btn',
          { 'manufacturers-toolbar__nav-btn--unavailable': !canGoPrevious },
        ]"
        aria-label="Previous manufacturer"
        :aria-disabled="!canGoPrevious"
        v-tooltip.bottom="previousTooltip"
        @click="goToPrevious"
      >
        <i
          class="pi pi-chevron-left manufacturers-toolbar__nav-icon"
          aria-hidden="true"
        />
        <span class="manufacturers-toolbar__nav-label">{{ previousName }}</span>
        <span
          v-if="isPreviousLoading"
          class="manufacturers-toolbar__nav-skeleton"
          aria-hidden="true"
        />
      </Button>
      <Button
        outlined
        severity="secondary"
        size="small"
        :class="[
          'manufacturers-toolbar__nav-btn',
          { 'manufacturers-toolbar__nav-btn--unavailable': !canGoNext },
        ]"
        aria-label="Next manufacturer"
        :aria-disabled="!canGoNext"
        v-tooltip.bottom="nextTooltip"
        @click="goToNext"
      >
        <span class="manufacturers-toolbar__nav-label">{{ nextName }}</span>
        <i
          class="pi pi-chevron-right manufacturers-toolbar__nav-icon"
          aria-hidden="true"
        />
        <span
          v-if="isNextLoading"
          class="manufacturers-toolbar__nav-skeleton"
          aria-hidden="true"
        />
      </Button>
    </div>
  </div>
</template>

<style scoped>
.manufacturers-toolbar {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-3);
    min-height: var(--p-spacing-8);
}

.manufacturers-toolbar__nav-buttons {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: var(--p-spacing-1);
}

:deep(.manufacturers-toolbar__nav-btn.p-button) {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    gap: var(--p-button-gap);
    width: var(--p-spacing-8);
    min-width: var(--p-spacing-8);
    max-width: var(--p-spacing-8);
    height: var(--p-spacing-8);
    padding-inline: 0;
    background: var(--p-surface-0);
    color: var(--p-deepblue-900);
    border-color: var(--p-surface-200);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-bold);

    @media (min-width: 768px) {
        width: var(--p-layout-sequence-nav-width, 6.4375rem);
        min-width: var(--p-layout-sequence-nav-width, 6.4375rem);
        max-width: var(--p-layout-sequence-nav-width, 6.4375rem);
        padding-inline: var(--p-spacing-2);
    }
}

:deep(.manufacturers-toolbar__nav-btn--unavailable.p-button) {
    color: var(--p-surface-400);
    cursor: not-allowed;
}

.manufacturers-toolbar__nav-icon {
    flex: 0 0 auto;
    font-size: var(--p-font-size-sm);
}

.manufacturers-toolbar__nav-label {
    display: none;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;

    @media (min-width: 768px) {
        display: block;
    }
}

.manufacturers-toolbar__nav-skeleton {
    position: absolute;
    inset: var(--p-spacing-1);
    pointer-events: none;
    border-radius: var(--p-border-radius-xs);
    background-color: var(--p-undertow-base);
    animation: undertow var(--p-undertow-duration)
        var(--p-transition-timing-spring) infinite;
}
</style>
