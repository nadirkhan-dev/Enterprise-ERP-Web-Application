<script setup lang="ts">
import { useItemsFilterStore } from '~/stores/itemsFilter'
import { useItemsNavigationStore } from '~/stores/itemsNavigation'
import { useIsMobile } from '~/composables/useIsMobile'

interface Props {
  /**
   * Hide the Manufacturers filter section. Used on a manufacturer detail
   * page where the listing is already scoped to a single manufacturer and
   * letting the user pick a different one would be incoherent.
   */
  hideManufacturer?: boolean
  /**
   * Render the filter button inline (in this component's slot) instead of
   * teleporting it into the top-nav filter slot.
   */
  inline?: boolean
  /**
   * Show the detail-page navigation: an inline filter that re-scopes the
   * Next/Prev sequence plus prev/next chevrons. Used on the item detail page.
   */
  showNavigation?: boolean
}

withDefaults(defineProps<Props>(), {
  hideManufacturer: false,
  inline: false,
  showNavigation: false,
})

const filterStore = useItemsFilterStore()
const navStore = useItemsNavigationStore()
const { isMobile } = useIsMobile()
const manufacturers = computed(() => filterStore.manufacturers)
const isManufacturersLoading = computed(() => filterStore.isManufacturersLoading)

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const SEARCH_OPTION_THRESHOLD = 5

const manufacturerSearchQuery = ref('')

const selectedStatuses = computed<string[]>({
  get: () => filterStore.selectedStatuses,
  set: (values) => filterStore.setStatuses(values),
})

const selectedManufacturerIds = computed<number[]>({
  get: () => filterStore.selectedManufacturerIds,
  set: (values) => filterStore.setManufacturerIds(values),
})

const isSpecialOrderOnly = computed<boolean>({
  get: () => filterStore.isSpecialOrderOnly,
  set: (value) => filterStore.setSpecialOrderOnly(value),
})

const totalFilterCount = computed(() => filterStore.totalFilterCount)

const filteredManufacturers = computed(() => {
  const query = manufacturerSearchQuery.value.trim().toLowerCase()
  if (!query) { return manufacturers.value }
  // Traditional left-to-right (prefix) match: the query matches from the start
  // of the manufacturer name, not anywhere within it.
  return manufacturers.value.filter((manufacturer) =>
    manufacturer.name.toLowerCase().startsWith(query),
  )
})

const showManufacturerSearch = computed(
  () => isMobile.value || manufacturers.value.length >= SEARCH_OPTION_THRESHOLD,
)

function handleFilterOpen() {
  filterStore.ensureManufacturersLoaded()
}

// Inline detail-page filter
// Scopes the detail-page Next/Prev traversal via the itemsNavigation store.
// Independent of the list filter: editing it never changes what the list
// page shows.
const detailStatuses = computed<string[]>({
  get: () => navStore.detailStatuses,
  set: (values) => navStore.setDetailStatuses(values),
})

const detailManufacturerIds = computed<number[]>({
  get: () => navStore.detailManufacturerIds,
  set: (values) => navStore.setDetailManufacturerIds(values),
})

const detailIsSpecialOrderOnly = computed<boolean>({
  get: () => navStore.detailIsSpecialOrderOnly,
  set: (value) => navStore.setDetailSpecialOrderOnly(value),
})

const detailFilterCount = computed(() => navStore.detailFilterCount)

const navManufacturerSearchQuery = ref('')

const navFilteredManufacturers = computed(() => {
  const query = navManufacturerSearchQuery.value.trim().toLowerCase()
  if (!query) { return manufacturers.value }
  // Traditional left-to-right (prefix) match — see filteredManufacturers.
  return manufacturers.value.filter((manufacturer) =>
    manufacturer.name.toLowerCase().startsWith(query),
  )
})

// Navigation — windowed Next/Prev via itemsNavigation
const previousEntry = computed(() => navStore.previousEntry)
const nextEntry = computed(() => navStore.nextEntry)
const previousSku = computed(() => previousEntry.value?.sku ?? null)
const nextSku = computed(() => nextEntry.value?.sku ?? null)
const previousDescription = computed(() => previousEntry.value?.description ?? null)
const nextDescription = computed(() => nextEntry.value?.description ?? null)
// Drives the greyed-out state. With wrap-around a chevron is unavailable only
// at a genuine dead end (empty set, lone current item, or the unused side of a
// single-other-item set) — never just because the next/wrap target is loading.
const canGoPrevious = computed(() => navStore.canGoPrevious)
const canGoNext = computed(() => navStore.canGoNext)

// Hover tooltips. When the target is known we show its name; when the side is
// navigable but its target isn't loaded yet (a backward wrap to the last item)
// we show a generic label; when the side is a dead end we explain why nothing
// happens on click.
const previousTooltip = computed(() => {
  if (!canGoPrevious.value) { return 'No previous item' }
  return previousDescription.value || previousSku.value || 'Previous item'
})
const nextTooltip = computed(() => {
  if (!canGoNext.value) { return 'No next item' }
  return nextDescription.value || nextSku.value || 'Next item'
})
// Per-button loading shimmer: shown while the whole window is (re)building, and
// while a navigable side's target is still being fetched (most visibly the
// Previous wrap to the last item, whose tail lands a beat after the head
// arrives from the list cache). Showing the shimmer there turns a blank → pop
// "blink" into a smooth, intentional loading state.
const isPreviousLoading = computed(
  () => navStore.isBuilding || (canGoPrevious.value && !previousSku.value),
)
const isNextLoading = computed(
  () => navStore.isBuilding || (canGoNext.value && !nextSku.value),
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
    // Re-reading yields the real next item, or the wrap-to-first once the
    // forward end is reached.
    await navStore.loadNextChunk(false)
    target = navStore.nextEntry
  }
  if (!target) { return }
  navigateToEntry(target)
}

// Routes to a Next/Prev target. The target always lives in a loaded segment
// (head or tail), so the destination's cursor will find it — keep it an
// internal navigation so the detail filter and both windows are preserved.
function navigateToEntry(target: { sku: string }) {
  const inHead = navStore.entries.some((entry) => entry.sku === target.sku)
  const inTail = navStore.tailEntries.some((entry) => entry.sku === target.sku)
  if (inHead || inTail) {
    navStore.markInternalNavigation(target.sku)
  }
  navigateTo(`/items/${target.sku}`)
}
</script>

<template>
  <div class="items-toolbar">
    <BaseFilterToolbar
      :filter-count="totalFilterCount"
      aria-label="Filter items"
      drawer-class="filter-toolbar__drawer--fill"
      :inline="inline"
      @clear-all="filterStore.clearAll()"
      @open="handleFilterOpen"
    >
      <BaseFilterSection
        title="Status"
        :active-count="selectedStatuses.length"
        @clear="filterStore.setStatuses([])"
      >
        <div class="filter-section__options-row">
          <div
            v-for="option in STATUS_OPTIONS"
            :key="option.value"
            class="filter-section__option"
          >
            <Checkbox
              v-model="selectedStatuses"
              :input-id="`items-filter-status-${option.value}`"
              :value="option.value"
            />
            <label :for="`items-filter-status-${option.value}`">
              <Tag
                :value="option.label"
                :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
              />
            </label>
          </div>
        </div>
      </BaseFilterSection>

      <BaseFilterSection
        v-if="!hideManufacturer"
        v-model:search="manufacturerSearchQuery"
        title="Manufacturers"
        fill
        :active-count="selectedManufacturerIds.length"
        :show-search="showManufacturerSearch"
        collapsible
        @clear="filterStore.setManufacturerIds([])"
      >
        <div
          v-if="isManufacturersLoading && !manufacturers.length"
          class="filter-section__empty"
        >
          Loading…
        </div>
        <div class="filter-section__option-list">
          <div
            v-for="manufacturer in filteredManufacturers"
            :key="manufacturer.id"
            class="filter-section__option"
          >
            <Checkbox
              v-model="selectedManufacturerIds"
              :input-id="`items-filter-manufacturer-${manufacturer.id}`"
              :value="manufacturer.id"
            />
            <label :for="`items-filter-manufacturer-${manufacturer.id}`">{{ manufacturer.name }}</label>
          </div>
        </div>
      </BaseFilterSection>

      <BaseFilterSection
        title="Item Type"
        :active-count="isSpecialOrderOnly ? 1 : 0"
        is-last
        collapsible
        @clear="filterStore.setSpecialOrderOnly(false)"
      >
        <div class="filter-section__option">
          <Checkbox
            v-model="isSpecialOrderOnly"
            input-id="items-filter-special-order"
            binary
          />
          <label for="items-filter-special-order">Special Order SKU</label>
        </div>
      </BaseFilterSection>
    </BaseFilterToolbar>

    <div
      v-if="showNavigation"
      class="items-toolbar__nav"
    >
      <!-- Inline filter — scopes Next/Prev, independent of the list filter -->
      <BaseFilterToolbar
        :filter-count="detailFilterCount"
        aria-label="Filter items"
        drawer-class="filter-toolbar__drawer--fill"
        inline
        icon="pi pi-sliders-h"
        @clear-all="navStore.clearDetailFilters()"
        @open="handleFilterOpen"
      >
        <BaseFilterSection
          title="Status"
          :active-count="detailStatuses.length"
          @clear="navStore.setDetailStatuses([])"
        >
          <div class="filter-section__options-row">
            <div
              v-for="option in STATUS_OPTIONS"
              :key="option.value"
              class="filter-section__option"
            >
              <Checkbox
                v-model="detailStatuses"
                :input-id="`items-nav-filter-status-${option.value}`"
                :value="option.value"
              />
              <label :for="`items-nav-filter-status-${option.value}`">
                <Tag
                  :value="option.label"
                  :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
                />
              </label>
            </div>
          </div>
        </BaseFilterSection>

        <BaseFilterSection
          v-if="!hideManufacturer"
          v-model:search="navManufacturerSearchQuery"
          title="Manufacturers"
          fill
          :active-count="detailManufacturerIds.length"
          :show-search="showManufacturerSearch"
          collapsible
          @clear="navStore.setDetailManufacturerIds([])"
        >
          <div
            v-if="isManufacturersLoading && !manufacturers.length"
            class="filter-section__empty"
          >
            Loading…
          </div>
          <div class="filter-section__option-list">
            <div
              v-for="manufacturer in navFilteredManufacturers"
              :key="manufacturer.id"
              class="filter-section__option"
            >
              <Checkbox
                v-model="detailManufacturerIds"
                :input-id="`items-nav-filter-manufacturer-${manufacturer.id}`"
                :value="manufacturer.id"
              />
              <label :for="`items-nav-filter-manufacturer-${manufacturer.id}`">{{ manufacturer.name }}</label>
            </div>
          </div>
        </BaseFilterSection>

        <BaseFilterSection
          title="Item Type"
          :active-count="detailIsSpecialOrderOnly ? 1 : 0"
          is-last
          collapsible
          @clear="navStore.setDetailSpecialOrderOnly(false)"
        >
          <div class="filter-section__option">
            <Checkbox
              v-model="detailIsSpecialOrderOnly"
              input-id="items-nav-filter-special-order"
              binary
            />
            <label for="items-nav-filter-special-order">Special Order SKU</label>
          </div>
        </BaseFilterSection>
      </BaseFilterToolbar>

      <div class="items-toolbar__nav-buttons">
        <Button
          outlined
          severity="secondary"
          size="small"
          :class="[
            'items-toolbar__nav-btn',
            { 'items-toolbar__nav-btn--unavailable': !canGoPrevious },
          ]"
          aria-label="Previous item"
          :aria-disabled="!canGoPrevious"
          v-tooltip.bottom="previousTooltip"
          @click="goToPrevious"
        >
          <i
            class="pi pi-chevron-left items-toolbar__nav-icon"
            aria-hidden="true"
          />
          <span class="items-toolbar__nav-label">{{ previousSku }}</span>
          <span
            v-if="isPreviousLoading"
            class="items-toolbar__nav-skeleton"
            aria-hidden="true"
          />
        </Button>
        <Button
          outlined
          severity="secondary"
          size="small"
          :class="[
            'items-toolbar__nav-btn',
            { 'items-toolbar__nav-btn--unavailable': !canGoNext },
          ]"
          aria-label="Next item"
          :aria-disabled="!canGoNext"
          v-tooltip.bottom="nextTooltip"
          @click="goToNext"
        >
          <span class="items-toolbar__nav-label">{{ nextSku }}</span>
          <i
            class="pi pi-chevron-right items-toolbar__nav-icon"
            aria-hidden="true"
          />
          <span
            v-if="isNextLoading"
            class="items-toolbar__nav-skeleton"
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.items-toolbar {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

/* Navigation: inline filter + prev/next chevrons */
.items-toolbar__nav {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
    min-height: var(--p-spacing-8);
}

.items-toolbar__nav-buttons {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: var(--p-spacing-1);
}

:deep(.items-toolbar__nav-btn.p-button) {
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
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-bold);

    @media (min-width: 768px) {
        width: auto;
        min-width: var(--p-layout-sequence-nav-width, 6.4375rem);
        max-width: none;
        padding-inline: var(--p-spacing-2);
    }
}

:deep(.items-toolbar__nav-btn--unavailable.p-button) {
    color: var(--p-surface-400);
    cursor: not-allowed;
}

.items-toolbar__nav-icon {
    flex: 0 0 auto;
    font-size: var(--p-font-size-sm);
}

.items-toolbar__nav-label {
    display: none;
    flex: 0 0 auto;
    white-space: nowrap;
    text-align: center;

    @media (min-width: 768px) {
        display: block;
    }
}

.items-toolbar__nav-skeleton {
    position: absolute;
    inset: var(--p-spacing-1);
    pointer-events: none;
    border-radius: var(--p-border-radius-xs);
    background-color: var(--p-undertow-base);
    animation: undertow var(--p-undertow-duration)
        var(--p-transition-timing-spring) infinite;
}
</style>
