<script setup lang="ts">
import { useSuppliersFilterStore } from '~/stores/suppliersFilter'
import { useSuppliersNavigationStore } from '~/stores/suppliersNavigation'
import { useIsMobile } from '~/composables/useIsMobile'

interface Props {
  /**
   * Show the detail-page navigation: an inline filter that re-scopes the
   * Next/Prev sequence plus prev/next chevrons. Used on the supplier detail
   * page.
   */
  showNavigation?: boolean
}

withDefaults(defineProps<Props>(), {
  showNavigation: false,
})

const filterStore = useSuppliersFilterStore()
const navStore = useSuppliersNavigationStore()
const { isMobile } = useIsMobile()
const manufacturers = computed(() => filterStore.manufacturers)
const isManufacturersLoading = computed(() => filterStore.isManufacturersLoading)
const businessPartnerGroups = computed(() => filterStore.businessPartnerGroups)
const isBusinessPartnerGroupsLoading = computed(() => filterStore.isBusinessPartnerGroupsLoading)

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const SEARCH_OPTION_THRESHOLD = 5

const groupSearchQuery = ref('')
const manufacturerSearchQuery = ref('')

const selectedStatuses = computed<string[]>({
  get: () => filterStore.selectedStatuses,
  set: (values) => filterStore.setStatuses(values),
})

const selectedBusinessPartnerGroupIds = computed<number[]>({
  get: () => filterStore.selectedBusinessPartnerGroupIds,
  set: (values) => filterStore.setBusinessPartnerGroupIds(values),
})

const selectedManufacturerIds = computed<number[]>({
  get: () => filterStore.selectedManufacturerIds,
  set: (values) => filterStore.setManufacturerIds(values),
})

const totalFilterCount = computed(() => filterStore.totalFilterCount)

const filteredBusinessPartnerGroups = computed(() => {
  const query = groupSearchQuery.value.trim().toLowerCase()
  if (!query) { return businessPartnerGroups.value }
  return businessPartnerGroups.value.filter((group) =>
    group.name.toLowerCase().includes(query),
  )
})

const filteredManufacturers = computed(() => {
  const query = manufacturerSearchQuery.value.trim().toLowerCase()
  if (!query) { return manufacturers.value }
  // Left-to-right prefix match (name-only), mirroring the Manufacturer pickers
  // (CONNECT-701) — a "contains" match surfaced unrelated names mid-string.
  return manufacturers.value.filter((manufacturer) =>
    manufacturer.name.toLowerCase().startsWith(query),
  )
})

const showGroupSearch = computed(
  () => isMobile.value || businessPartnerGroups.value.length >= SEARCH_OPTION_THRESHOLD,
)
const showManufacturerSearch = computed(
  () => isMobile.value || manufacturers.value.length >= SEARCH_OPTION_THRESHOLD,
)

const showManufacturersSection = computed(() => !filterStore.isOperatingExpenseOnly)

watch(showManufacturersSection, (visible) => {
  if (!visible) {
    if (filterStore.selectedManufacturerIds.length) {
      filterStore.setManufacturerIds([])
    }
    manufacturerSearchQuery.value = ''
  }
})

function handleFilterOpen() {
  filterStore.ensureBusinessPartnerGroupsLoaded()
  filterStore.ensureManufacturersLoaded()
}

// Inline detail-page filter
// Scopes the detail-page Next/Prev traversal via the suppliersNavigation
// store. Independent of the list filter.
const detailStatuses = computed<string[]>({
  get: () => navStore.detailStatuses,
  set: (values) => navStore.setDetailStatuses(values),
})

const detailBusinessPartnerGroupIds = computed<number[]>({
  get: () => navStore.detailBusinessPartnerGroupIds,
  set: (values) => navStore.setDetailBusinessPartnerGroupIds(values),
})

const detailManufacturerIds = computed<number[]>({
  get: () => navStore.detailManufacturerIds,
  set: (values) => navStore.setDetailManufacturerIds(values),
})

const detailFilterCount = computed(() => navStore.detailFilterCount)

const navGroupSearchQuery = ref('')
const navManufacturerSearchQuery = ref('')

const navFilteredBusinessPartnerGroups = computed(() => {
  const query = navGroupSearchQuery.value.trim().toLowerCase()
  if (!query) { return businessPartnerGroups.value }
  return businessPartnerGroups.value.filter((group) =>
    group.name.toLowerCase().includes(query),
  )
})

const navFilteredManufacturers = computed(() => {
  const query = navManufacturerSearchQuery.value.trim().toLowerCase()
  if (!query) { return manufacturers.value }
  // Left-to-right prefix match (name-only), mirroring the Manufacturer pickers
  // (CONNECT-701) — a "contains" match surfaced unrelated names mid-string.
  return manufacturers.value.filter((manufacturer) =>
    manufacturer.name.toLowerCase().startsWith(query),
  )
})

// Navigation — windowed Next/Prev via suppliersNavigation
const previousEntry = computed(() => navStore.previousEntry)
const nextEntry = computed(() => navStore.nextEntry)
const previousSapId = computed(() => previousEntry.value?.sapId ?? null)
const nextSapId = computed(() => nextEntry.value?.sapId ?? null)
const previousSupplierName = computed(() => previousEntry.value?.name ?? null)
const nextSupplierName = computed(() => nextEntry.value?.name ?? null)
// Drives the greyed-out state. With wrap-around a chevron is unavailable only
// at a genuine dead end (empty set, lone current supplier, or the unused side
// of a single-other-supplier set) — never just because a target is loading.
const canGoPrevious = computed(() => navStore.canGoPrevious)
const canGoNext = computed(() => navStore.canGoNext)

// Hover tooltips. When the target is known we show its name; when the side is
// navigable but its target isn't loaded yet (a backward wrap to the last
// supplier) we show a generic label; when the side is a dead end we explain
// why nothing happens on click.
const previousTooltip = computed(() => {
  if (!canGoPrevious.value) { return 'No previous supplier' }
  return previousSupplierName.value || previousSapId.value || 'Previous supplier'
})
const nextTooltip = computed(() => {
  if (!canGoNext.value) { return 'No next supplier' }
  return nextSupplierName.value || nextSapId.value || 'Next supplier'
})
// Per-button loading shimmer: shown while the whole window is (re)building, and
// while a navigable side's target is still being fetched (most visibly the
// Previous wrap to the last supplier, whose tail lands a beat after the head
// arrives from the list cache). Showing the shimmer there turns a blank → pop
// "blink" into a smooth, intentional loading state.
const isPreviousLoading = computed(
  () => navStore.isBuilding || (canGoPrevious.value && !previousSapId.value),
)
const isNextLoading = computed(
  () => navStore.isBuilding || (canGoNext.value && !nextSapId.value),
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
    // Re-reading yields the real next supplier, or the wrap-to-first once the
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
function navigateToEntry(target: { sapId: string }) {
  const inHead = navStore.entries.some((entry) => entry.sapId === target.sapId)
  const inTail = navStore.tailEntries.some((entry) => entry.sapId === target.sapId)
  if (inHead || inTail) {
    navStore.markInternalNavigation(target.sapId)
  }
  navigateTo(`/suppliers/${target.sapId}`)
}
</script>

<template>
  <div class="suppliers-toolbar">
    <BaseFilterToolbar
      :filter-count="totalFilterCount"
      aria-label="Filter suppliers"
      drawer-class="filter-toolbar__drawer--fill"
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
              :input-id="`suppliers-filter-status-${option.value}`"
              :value="option.value"
            />
            <label :for="`suppliers-filter-status-${option.value}`">
              <Tag
                :value="option.label"
                :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
              />
            </label>
          </div>
        </div>
      </BaseFilterSection>

      <BaseFilterSection
        v-model:search="groupSearchQuery"
        title="Supplier Group"
        :active-count="selectedBusinessPartnerGroupIds.length"
        :show-search="showGroupSearch"
        collapsible
        @clear="filterStore.setBusinessPartnerGroupIds([])"
      >
        <div
          v-if="isBusinessPartnerGroupsLoading && !businessPartnerGroups.length"
          class="filter-section__empty"
        >
          Loading…
        </div>
        <div class="filter-section__options-row">
          <div
            v-for="group in filteredBusinessPartnerGroups"
            :key="group.id"
            class="filter-section__option"
          >
            <Checkbox
              v-model="selectedBusinessPartnerGroupIds"
              :input-id="`suppliers-filter-group-${group.id}`"
              :value="group.id"
            />
            <label :for="`suppliers-filter-group-${group.id}`">{{ group.name }}</label>
          </div>
        </div>
      </BaseFilterSection>

      <!-- Manufacturers — header stays visible; content swaps to an
           empty state when only Operating Expense is selected -->
      <BaseFilterSection
        v-model:search="manufacturerSearchQuery"
        title="Manufacturers"
        fill
        :active-count="selectedManufacturerIds.length"
        :show-search="showManufacturerSearch && showManufacturersSection"
        is-last
        collapsible
        @clear="filterStore.setManufacturerIds([])"
      >
        <div
          v-if="!showManufacturersSection"
          class="suppliers-toolbar__empty"
        >
          No results available
        </div>
        <template v-else>
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
                :input-id="`suppliers-filter-manufacturer-${manufacturer.id}`"
                :value="manufacturer.id"
              />
              <label :for="`suppliers-filter-manufacturer-${manufacturer.id}`">{{ manufacturer.name }}</label>
            </div>
          </div>
        </template>
      </BaseFilterSection>
    </BaseFilterToolbar>

    <div
      v-if="showNavigation"
      class="suppliers-toolbar__nav"
    >
      <!-- Inline filter — scopes Next/Prev, independent of the list filter -->
      <BaseFilterToolbar
        :filter-count="detailFilterCount"
        aria-label="Filter suppliers"
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
                :input-id="`suppliers-nav-filter-status-${option.value}`"
                :value="option.value"
              />
              <label :for="`suppliers-nav-filter-status-${option.value}`">
                <Tag
                  :value="option.label"
                  :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
                />
              </label>
            </div>
          </div>
        </BaseFilterSection>

        <BaseFilterSection
          v-model:search="navGroupSearchQuery"
          title="Supplier Group"
          :active-count="detailBusinessPartnerGroupIds.length"
          :show-search="showGroupSearch"
          collapsible
          @clear="navStore.setDetailBusinessPartnerGroupIds([])"
        >
          <div
            v-if="isBusinessPartnerGroupsLoading && !businessPartnerGroups.length"
            class="filter-section__empty"
          >
            Loading…
          </div>
          <div class="filter-section__options-row">
            <div
              v-for="group in filteredBusinessPartnerGroups"
              :key="group.id"
              class="filter-section__option"
            >
              <Checkbox
                v-model="detailBusinessPartnerGroupIds"
                :input-id="`suppliers-nav-filter-group-${group.id}`"
                :value="group.id"
              />
              <label :for="`suppliers-nav-filter-group-${group.id}`">{{ group.name }}</label>
            </div>
          </div>
        </BaseFilterSection>

        <BaseFilterSection
          v-model:search="navManufacturerSearchQuery"
          title="Manufacturers"
          fill
          :active-count="detailManufacturerIds.length"
          :show-search="showManufacturerSearch"
          is-last
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
                :input-id="`suppliers-nav-filter-manufacturer-${manufacturer.id}`"
                :value="manufacturer.id"
              />
              <label :for="`suppliers-nav-filter-manufacturer-${manufacturer.id}`">{{ manufacturer.name }}</label>
            </div>
          </div>
        </BaseFilterSection>
      </BaseFilterToolbar>

      <div class="suppliers-toolbar__nav-buttons">
        <Button
          outlined
          severity="secondary"
          size="small"
          :class="[
            'suppliers-toolbar__nav-btn',
            { 'suppliers-toolbar__nav-btn--unavailable': !canGoPrevious },
          ]"
          aria-label="Previous supplier"
          :aria-disabled="!canGoPrevious"
          v-tooltip.bottom="previousTooltip"
          @click="goToPrevious"
        >
          <i
            class="pi pi-chevron-left suppliers-toolbar__nav-icon"
            aria-hidden="true"
          />
          <span class="suppliers-toolbar__nav-label">{{ previousSapId }}</span>
          <span
            v-if="isPreviousLoading"
            class="suppliers-toolbar__nav-skeleton"
            aria-hidden="true"
          />
        </Button>
        <Button
          outlined
          severity="secondary"
          size="small"
          :class="[
            'suppliers-toolbar__nav-btn',
            { 'suppliers-toolbar__nav-btn--unavailable': !canGoNext },
          ]"
          aria-label="Next supplier"
          :aria-disabled="!canGoNext"
          v-tooltip.bottom="nextTooltip"
          @click="goToNext"
        >
          <span class="suppliers-toolbar__nav-label">{{ nextSapId }}</span>
          <i
            class="pi pi-chevron-right suppliers-toolbar__nav-icon"
            aria-hidden="true"
          />
          <span
            v-if="isNextLoading"
            class="suppliers-toolbar__nav-skeleton"
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.suppliers-toolbar {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

.suppliers-toolbar__empty {
    text-align: center;
    color: var(--p-gray-800);
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-medium);
    padding: var(--p-spacing-3) 0;
}

/* Navigation: inline filter + prev/next chevrons */
.suppliers-toolbar__nav {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
    min-height: var(--p-spacing-8);
}

.suppliers-toolbar__nav-buttons {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: var(--p-spacing-1);
}

:deep(.suppliers-toolbar__nav-btn.p-button) {
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
        width: var(--p-layout-sequence-nav-width, 6.4375rem);
        min-width: var(--p-layout-sequence-nav-width, 6.4375rem);
        max-width: var(--p-layout-sequence-nav-width, 6.4375rem);
        padding-inline: var(--p-spacing-2);
    }
}

:deep(.suppliers-toolbar__nav-btn--unavailable.p-button) {
    color: var(--p-surface-400);
    cursor: not-allowed;
}

.suppliers-toolbar__nav-icon {
    flex: 0 0 auto;
    font-size: var(--p-font-size-sm);
}

.suppliers-toolbar__nav-label {
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

.suppliers-toolbar__nav-skeleton {
    position: absolute;
    inset: var(--p-spacing-1);
    pointer-events: none;
    border-radius: var(--p-border-radius-xs);
    background-color: var(--p-undertow-base);
    animation: undertow var(--p-undertow-duration)
        var(--p-transition-timing-spring) infinite;
}
</style>
