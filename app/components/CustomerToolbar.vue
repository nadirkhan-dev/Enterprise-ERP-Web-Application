<script setup lang="ts">
import { useIsMobile } from '~/composables/useIsMobile'

interface Props {
  showNavigation?: boolean
}

withDefaults(defineProps<Props>(), {
  showNavigation: false,
})

const filterStore = useCustomerFilterStore()
const navStore = useCustomerNavigationStore()
const { isMobile } = useIsMobile()
// The real managers PLUS the "Unassigned" pseudo-user, so the accounts nobody owns
// are selectable rather than invisible. Both the desktop and the mobile filter panel
// read this, and the loading branch below still keys off the real list.
const accountManagers = computed(() => filterStore.accountManagerOptions)
const isAccountManagersLoading = computed(() => filterStore.isAccountManagersLoading)
const businessPartnerGroups = computed(() => filterStore.businessPartnerGroups)
const isBusinessPartnerGroupsLoading = computed(() => filterStore.isBusinessPartnerGroupsLoading)

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const SEARCH_OPTION_THRESHOLD = 5

const toolbarRef = ref<any>(null)
const managerSearchQuery = ref('')
const groupSearchQuery = ref('')

const selectedStatuses = computed<string[]>({
  get: () => filterStore.selectedStatuses,
  set: (values) => filterStore.setStatuses(values),
})

const selectedAccountManagerIds = computed<string[]>({
  get: () => filterStore.selectedAccountManagerIds,
  set: (values) => filterStore.setAccountManagerIds(values),
})

const selectedBusinessPartnerGroupIds = computed<number[]>({
  get: () => filterStore.selectedBusinessPartnerGroupIds,
  set: (values) => filterStore.setBusinessPartnerGroupIds(values),
})

const isNationalAccountOnly = computed<boolean>({
  get: () => filterStore.isNationalAccountOnly,
  set: (value) => filterStore.setNationalAccountOnly(value),
})

const totalFilterCount = computed(() => filterStore.totalFilterCount)

const filteredAccountManagers = computed(() => {
  const query = managerSearchQuery.value.trim().toLowerCase()
  if (!query) { return accountManagers.value }
  return accountManagers.value.filter((manager) =>
    manager.name.toLowerCase().includes(query),
  )
})

const filteredBusinessPartnerGroups = computed(() => {
  const query = groupSearchQuery.value.trim().toLowerCase()
  if (!query) { return businessPartnerGroups.value }
  return businessPartnerGroups.value.filter((group) =>
    group.name.toLowerCase().includes(query),
  )
})

const showManagerSearch = computed(
  () => isMobile.value || accountManagers.value.length >= SEARCH_OPTION_THRESHOLD,
)
const showGroupSearch = computed(
  () => isMobile.value || businessPartnerGroups.value.length >= SEARCH_OPTION_THRESHOLD,
)

function handleFilterOpen() {
  filterStore.ensureAccountManagersLoaded()
  filterStore.ensureBusinessPartnerGroupsLoaded()
}

// Inline detail-page filter
// The inline filter popover beside the prev/next chevrons scopes the
// Next/Prev traversal via the customerNavigation store. It is independent of
// the list filter (customerFilter): editing it never changes what the list
// page shows — it only re-scopes detail-page navigation.
const detailStatuses = computed<string[]>({
  get: () => navStore.detailStatuses,
  set: (values) => navStore.setDetailStatuses(values),
})

const detailAccountManagerIds = computed<string[]>({
  get: () => navStore.detailAccountManagerIds,
  set: (values) => navStore.setDetailAccountManagerIds(values),
})

const detailBusinessPartnerGroupIds = computed<number[]>({
  get: () => navStore.detailBusinessPartnerGroupIds,
  set: (values) => navStore.setDetailBusinessPartnerGroupIds(values),
})

const detailNationalAccountOnly = computed<boolean>({
  get: () => navStore.detailIsNationalAccountOnly,
  set: (value) => navStore.setDetailNationalAccountOnly(value),
})

const detailFilterCount = computed(() => navStore.detailFilterCount)

const navManagerSearchQuery = ref('')
const navGroupSearchQuery = ref('')

const navFilteredAccountManagers = computed(() => {
  const query = navManagerSearchQuery.value.trim().toLowerCase()
  if (!query) { return accountManagers.value }
  return accountManagers.value.filter((manager) =>
    manager.name.toLowerCase().includes(query),
  )
})

const navFilteredBusinessPartnerGroups = computed(() => {
  const query = navGroupSearchQuery.value.trim().toLowerCase()
  if (!query) { return businessPartnerGroups.value }
  return businessPartnerGroups.value.filter((group) =>
    group.name.toLowerCase().includes(query),
  )
})

// Navigation — windowed Next/Prev via customerNavigation
// The detail page (Customers/[id].vue) drives the navigation lifecycle;
// this component only reads the resulting window and routes between pages.
const previousEntry = computed(() => navStore.previousEntry)
const nextEntry = computed(() => navStore.nextEntry)
const previousSapId = computed(() => previousEntry.value?.sapId ?? null)
const nextSapId = computed(() => nextEntry.value?.sapId ?? null)
const previousCustomerName = computed(() => previousEntry.value?.name ?? null)
const nextCustomerName = computed(() => nextEntry.value?.name ?? null)
// Drives the greyed-out state. With wrap-around a chevron is unavailable only
// at a genuine dead end (empty set, lone current customer, or the unused side
// of a single-other-customer set) — never just because the next/wrap target
// is still loading.
const canGoPrevious = computed(() => navStore.canGoPrevious)
const canGoNext = computed(() => navStore.canGoNext)

// Hover tooltips for the chevron buttons. When the target is known we show its
// name; when the side is navigable but its target isn't loaded yet (a backward
// wrap to the last customer) we show a generic label; when the side is a dead
// end we explain why nothing happens on click.
const previousTooltip = computed(() => {
  if (!canGoPrevious.value) { return 'No previous customer' }
  return previousCustomerName.value || previousSapId.value || 'Previous customer'
})
const nextTooltip = computed(() => {
  if (!canGoNext.value) { return 'No next customer' }
  return nextCustomerName.value || nextSapId.value || 'Next customer'
})
// Per-button loading shimmer: shown while the whole window is (re)building, and
// while a navigable side's target is still being fetched (most visibly the
// Previous wrap to the last customer, whose tail lands a beat after the head
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

// Routes to a Next/Prev target. The target always lives in a loaded segment
// (head or tail), so the destination's cursor will find it — keep it an
// internal navigation so the detail filter and both windows are preserved.
function navigateToEntry(target: { sapId: string }) {
  const inHead = navStore.entries.some((entry) => entry.sapId === target.sapId)
  const inTail = navStore.tailEntries.some((entry) => entry.sapId === target.sapId)
  if (inHead || inTail) {
    navStore.markInternalNavigation(target.sapId)
  }
  navigateTo(`/customers/${target.sapId}`)
}

async function goToNext() {
  if (!navStore.canGoNext) { return }
  let target = navStore.nextEntry
  if (!target && navStore.hasMoreForward) {
    // More rows exist beyond the head — load the next chunk, then re-read.
    // Re-reading yields the real next customer, or the wrap-to-first once the
    // forward end is reached.
    await navStore.loadNextChunk(false)
    target = navStore.nextEntry
  }
  if (!target) { return }
  navigateToEntry(target)
}
</script>

<template>
  <div class="customer-toolbar">
    <BaseFilterToolbar
      ref="toolbarRef"
      :filter-count="totalFilterCount"
      aria-label="Filter customers"
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
              :input-id="`customer-filter-status-${option.value}`"
              :value="option.value"
            />
            <label :for="`customer-filter-status-${option.value}`">
              <Tag
                :value="option.label"
                :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
              />
            </label>
          </div>
        </div>
      </BaseFilterSection>

      <BaseFilterSection
        v-model:search="managerSearchQuery"
        title="Account Manager"
        :active-count="selectedAccountManagerIds.length"
        :show-search="showManagerSearch"
        collapsible
        @clear="filterStore.setAccountManagerIds([])"
      >
        <div
          v-if="isAccountManagersLoading && !accountManagers.length"
          class="filter-section__loading"
        >
          <BaseSpinner size="sm" />
        </div>
        <div class="filter-section__option-list">
          <div
            v-for="manager in filteredAccountManagers"
            :key="manager.id"
            class="filter-section__option"
          >
            <Checkbox
              v-model="selectedAccountManagerIds"
              :input-id="`customer-filter-manager-${manager.id}`"
              :value="manager.id"
            />
            <label
              :for="`customer-filter-manager-${manager.id}`"
              class="customer-toolbar__manager"
            >
              <img
                v-if="manager.avatarUrl"
                :src="manager.avatarUrl"
                alt=""
                class="customer-toolbar__manager-avatar"
              >
              <span
                v-else
                class="customer-toolbar__manager-avatar customer-toolbar__manager-avatar--fallback"
              >
                <i class="pi pi-user customer-toolbar__manager-avatar-icon" />
              </span>
              <span class="customer-toolbar__manager-name">{{ manager.name }}</span>
            </label>
          </div>
        </div>
      </BaseFilterSection>

      <BaseFilterSection
        v-model:search="groupSearchQuery"
        title="Customer Group"
        :active-count="selectedBusinessPartnerGroupIds.length"
        :show-search="showGroupSearch"
        collapsible
        @clear="filterStore.setBusinessPartnerGroupIds([])"
      >
        <div
          v-if="isBusinessPartnerGroupsLoading && !businessPartnerGroups.length"
          class="filter-section__loading"
        >
          <BaseSpinner size="sm" />
        </div>
        <div class="filter-section__option-list">
          <div
            v-for="group in filteredBusinessPartnerGroups"
            :key="group.id"
            class="filter-section__option"
          >
            <Checkbox
              v-model="selectedBusinessPartnerGroupIds"
              :input-id="`customer-filter-group-${group.id}`"
              :value="group.id"
            />
            <label :for="`customer-filter-group-${group.id}`">{{ group.name }}</label>
          </div>
        </div>
      </BaseFilterSection>

      <BaseFilterSection
        title="Other"
        :active-count="isNationalAccountOnly ? 1 : 0"
        is-last
        collapsible
        @clear="filterStore.setNationalAccountOnly(false)"
      >
        <div class="filter-section__option">
          <Checkbox
            v-model="isNationalAccountOnly"
            input-id="customer-filter-national"
            binary
          />
          <label for="customer-filter-national">National Customers only</label>
        </div>
      </BaseFilterSection>
    </BaseFilterToolbar>

    <div
      v-if="showNavigation"
      class="customer-toolbar__nav"
    >
      <!-- Inline filter — scopes Next/Prev, independent of the list filter -->
      <BaseFilterToolbar
        :filter-count="detailFilterCount"
        aria-label="Filter customers"
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
                :input-id="`customer-nav-filter-status-${option.value}`"
                :value="option.value"
              />
              <label :for="`customer-nav-filter-status-${option.value}`">
                <Tag
                  :value="option.label"
                  :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
                />
              </label>
            </div>
          </div>
        </BaseFilterSection>

        <BaseFilterSection
          v-model:search="navManagerSearchQuery"
          title="Account Manager"
          :active-count="detailAccountManagerIds.length"
          :show-search="showManagerSearch"
          collapsible
          @clear="navStore.setDetailAccountManagerIds([])"
        >
          <div
            v-if="isAccountManagersLoading && !accountManagers.length"
            class="filter-section__loading"
          >
            <BaseSpinner size="sm" />
          </div>
          <div class="filter-section__option-list">
            <div
              v-for="manager in navFilteredAccountManagers"
              :key="manager.id"
              class="filter-section__option"
            >
              <Checkbox
                v-model="detailAccountManagerIds"
                :input-id="`customer-nav-filter-manager-${manager.id}`"
                :value="manager.id"
              />
              <label
                :for="`customer-nav-filter-manager-${manager.id}`"
                class="customer-toolbar__manager"
              >
                <img
                  v-if="manager.avatarUrl"
                  :src="manager.avatarUrl"
                  alt=""
                  class="customer-toolbar__manager-avatar"
                >
                <span
                  v-else
                  class="customer-toolbar__manager-avatar customer-toolbar__manager-avatar--fallback"
                >
                  <i class="pi pi-user customer-toolbar__manager-avatar-icon" />
                </span>
                <span class="customer-toolbar__manager-name">{{ manager.name }}</span>
              </label>
            </div>
          </div>
        </BaseFilterSection>

        <BaseFilterSection
          v-model:search="navGroupSearchQuery"
          title="Customer Group"
          :active-count="detailBusinessPartnerGroupIds.length"
          :show-search="showGroupSearch"
          collapsible
          @clear="navStore.setDetailBusinessPartnerGroupIds([])"
        >
          <div
            v-if="isBusinessPartnerGroupsLoading && !businessPartnerGroups.length"
            class="filter-section__loading"
          >
            <BaseSpinner size="sm" />
          </div>
          <div class="filter-section__option-list">
            <div
              v-for="group in navFilteredBusinessPartnerGroups"
              :key="group.id"
              class="filter-section__option"
            >
              <Checkbox
                v-model="detailBusinessPartnerGroupIds"
                :input-id="`customer-nav-filter-group-${group.id}`"
                :value="group.id"
              />
              <label :for="`customer-nav-filter-group-${group.id}`">{{ group.name }}</label>
            </div>
          </div>
        </BaseFilterSection>

        <BaseFilterSection
          title="Other"
          :active-count="detailNationalAccountOnly ? 1 : 0"
          is-last
          collapsible
          @clear="navStore.setDetailNationalAccountOnly(false)"
        >
          <div class="filter-section__option">
            <Checkbox
              v-model="detailNationalAccountOnly"
              input-id="customer-nav-filter-national"
              binary
            />
            <label for="customer-nav-filter-national">National Customers only</label>
          </div>
        </BaseFilterSection>
      </BaseFilterToolbar>

      <div class="customer-toolbar__nav-buttons">
        <Button
          outlined
          severity="secondary"
          size="small"
          :class="[
            'customer-toolbar__nav-btn',
            { 'customer-toolbar__nav-btn--unavailable': !canGoPrevious },
          ]"
          aria-label="Previous customer"
          :aria-disabled="!canGoPrevious"
          v-tooltip.bottom="previousTooltip"
          @click="goToPrevious"
        >
          <i
            class="pi pi-chevron-left customer-toolbar__nav-icon"
            aria-hidden="true"
          />
          <span class="customer-toolbar__nav-label">{{ previousSapId || ' ' }}</span>
          <span
            v-if="isPreviousLoading"
            class="customer-toolbar__nav-skeleton"
            aria-hidden="true"
          />
        </Button>
        <Button
          outlined
          severity="secondary"
          size="small"
          :class="[
            'customer-toolbar__nav-btn',
            { 'customer-toolbar__nav-btn--unavailable': !canGoNext },
          ]"
          aria-label="Next customer"
          :aria-disabled="!canGoNext"
          v-tooltip.bottom="nextTooltip"
          @click="goToNext"
        >
          <span class="customer-toolbar__nav-label">{{ nextSapId }}</span>
          <i
            class="pi pi-chevron-right customer-toolbar__nav-icon"
            aria-hidden="true"
          />
          <span
            v-if="isNextLoading"
            class="customer-toolbar__nav-skeleton"
            aria-hidden="true"
          />
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.customer-toolbar {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

/* Navigation: inline filter + prev/next chevrons */
.customer-toolbar__nav {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
    min-height: var(--p-spacing-8);
}

.customer-toolbar__nav-buttons {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    gap: var(--p-spacing-1);
}

/* Width is locked (min == width == max) and the button is flex-rigid; the
   loading skeleton is an absolute overlay (see below), so the icon and label
   stay mounted and the button never resizes or shifts while a fetch runs. */
:deep(.customer-toolbar__nav-btn.p-button) {
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

:deep(.customer-toolbar__nav-btn--unavailable.p-button) {
    color: var(--p-surface-400);
    cursor: not-allowed;
}

.customer-toolbar__nav-icon {
    flex: 0 0 auto;
    font-size: var(--p-font-size-sm);
}

.customer-toolbar__nav-label {
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

/* Loading skeleton — an absolute overlay covering the button's interior. It is
   out of the flex flow, so the icon and label keep their place and the button
   holds its exact size while a fetch runs. */
.customer-toolbar__nav-skeleton {
    position: absolute;
    inset: var(--p-spacing-1);
    pointer-events: none;
    border-radius: var(--p-border-radius-xs);
    background-color: var(--p-undertow-base);
    animation: undertow var(--p-undertow-duration)
        var(--p-transition-timing-spring) infinite;
}

.customer-toolbar__manager {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.customer-toolbar__manager-avatar {
    width: var(--p-spacing-7);
    height: var(--p-spacing-7);
    border-radius: 50%;
    object-fit: cover;
}

.customer-toolbar__manager-avatar--fallback {
    background: var(--p-surface-100);
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.customer-toolbar__manager-avatar-icon {
    font-size: var(--p-font-size-xs);
    color: var(--p-surface-300);
}

.customer-toolbar__manager-name {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}
</style>
