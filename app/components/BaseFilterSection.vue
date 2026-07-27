<script setup lang="ts">
import type { FilterCollapseController, FilterSectionHandle } from '~/composables/useFilterCollapse'
import { FILTER_COLLAPSE_KEY } from '~/composables/useFilterCollapse'

interface Props {
  title: string
  activeCount?: number
  showSearch?: boolean
  searchPlaceholder?: string
  isLast?: boolean
  fill?: boolean
  /** When true, the section shows a chevron toggle and participates in the
   *  toolbar's auto-collapse (CONNECT-574). */
  collapsible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  activeCount: 0,
  showSearch: false,
  searchPlaceholder: '',
  isLast: false,
  fill: false,
  collapsible: false,
})

const emit = defineEmits<{
  (e: 'clear'): void
}>()

const searchQuery = defineModel<string>('search', { default: '' })

// Collapsible behaviour (CONNECT-574). Collapsible sections register with the
// filter toolbar's collapse controller, which auto-collapses the lowest-priority
// sections (from the bottom up) whenever the panel would overflow the viewport
// height. The chevron also lets the user collapse/expand a section manually.
const isCollapsed = ref(false)
const sectionRef = ref<HTMLElement | null>(null)
const collapseController = inject<FilterCollapseController | null>(FILTER_COLLAPSE_KEY, null)

const sectionHandle: FilterSectionHandle = {
  collapse: () => { isCollapsed.value = true },
  expand: () => { isCollapsed.value = false },
  get el() { return sectionRef.value },
}

function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value
  collapseController?.notifyManualToggle()
}

onMounted(() => {
  if (props.collapsible) { collapseController?.register(sectionHandle) }
})

onBeforeUnmount(() => {
  if (props.collapsible) { collapseController?.unregister(sectionHandle) }
})
</script>

<template>
  <section
    ref="sectionRef"
    :class="[
      'filter-section',
      {
        'filter-section--last': props.isLast,
        'filter-section--fill': props.fill,
        'filter-section--collapsed': props.collapsible && isCollapsed,
      },
    ]"
  >
    <div class="filter-section__header">
      <Button
        v-if="props.collapsible"
        text
        size="small"
        :icon="isCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
        class="filter-section__toggle"
        :aria-label="`${isCollapsed ? 'Expand' : 'Collapse'} ${props.title}`"
        :aria-expanded="!isCollapsed"
        @click="toggleCollapsed"
      />
      <span class="filter-section__title">{{ props.title }}</span>
      <span class="filter-section__divider" />
      <OverlayBadge
        :value="props.activeCount"
        severity="danger"
        :class="['filter-section__clear-badge', { 'filter-section__clear-badge--hidden': !props.activeCount }]"
      >
        <Button
          outlined
          size="small"
          label="Clear"
          class="filter-section__clear-btn"
          :disabled="!props.activeCount"
          @click="emit('clear')"
        />
      </OverlayBadge>
    </div>

    <div
      v-show="!(props.collapsible && isCollapsed)"
      class="filter-section__body"
    >
      <IconField
        v-if="props.showSearch"
        class="filter-section__search"
      >
        <InputText
          v-search-input
          v-model="searchQuery"
          :placeholder="props.searchPlaceholder"
          fluid
        />
        <InputIcon class="pi pi-search" />
      </IconField>

      <slot />
    </div>
  </section>
</template>

<style>
.filter-section {
    display: flex;
    flex-direction: column;
    gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
}

/* Body holds the search + options; hidden when the section is collapsed. Carries
   the section's inner spacing so the header-to-content gap is unchanged. */
.filter-section__body {
    display: flex;
    flex-direction: column;
    gap: clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
}

.filter-section__header {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

/* Chevron toggle — a compact bordered square that flips the section open/closed */
.filter-section__toggle.p-button {
    flex: 0 0 auto;
    width: var(--p-spacing-7);
    height: var(--p-spacing-7);
    min-width: 0;
    padding: 0;
    border: 1px solid var(--p-surface-300);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
    color: var(--p-deepblue-900);
}

.filter-section__toggle.p-button .p-button-icon {
    font-size: var(--p-font-size-xs);
}

.filter-section__title {
    flex: 0 0 auto;
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

.filter-section__divider {
    flex: 1 1 0;
    height: 1px;
    background: var(--p-gray-200);
}

.filter-section__clear-badge {
    flex: 0 0 auto;
}

.filter-section__clear-badge--hidden .p-badge {
    display: none;
}

.filter-section__clear-btn.p-button {
    display: flex;
    align-items: center;
    gap: var(--p-button-gap);
    padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    border: 1px solid var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
}

.filter-section__clear-btn.p-button:disabled {
    color: var(--p-gray-300);
    border-color: var(--p-gray-200);
    background: var(--p-surface-0);
    opacity: 1;
}

.filter-section__search .p-inputtext {
    height: var(--p-spacing-8);
}

.filter-section__option {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    min-height: var(--p-spacing-8);
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}
.filter-section__options-row {
    display: flex;
    gap: var(--p-spacing-4);
}

.filter-section__option label {
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

/* Option list — cap at 5 rows visible by default */
.filter-section__option-list {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
    max-height: calc(var(--p-spacing-8) * 5 + var(--p-spacing-1) * 4);
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--p-gray-100) transparent;
    /* `overflow-y: auto` also clips horizontally, so a focused checkbox's focus
       ring (which extends beyond the box) gets cut at the list edges. Inset the
       content with padding on the left / top / bottom (where the checkbox ring
       sits — the right holds the scrollbar), and pull it back with a matching
       negative margin so the rows stay aligned with the search field above. */
    padding: var(--p-spacing-1) 0 var(--p-spacing-1) var(--p-spacing-1);
    margin: calc(-1 * var(--p-spacing-1)) 0 calc(-1 * var(--p-spacing-1)) calc(-1 * var(--p-spacing-1));
}

.filter-toolbar__drawer--fill .filter-section--fill,
.filter-toolbar__drawer--fill .filter-section--fill .filter-section__body {
    flex: 1 1 auto;
    min-height: 0;
}

.filter-toolbar__drawer--fill .filter-section--fill .filter-section__option-list {
    flex: 1 1 auto;
    max-height: none;
    min-height: 0;
    scrollbar-width: none;
}

.filter-toolbar__drawer--fill .filter-section--fill .filter-section__option-list::-webkit-scrollbar {
    display: none;
}

.filter-section__option-list::-webkit-scrollbar {
    width: var(--p-spacing-2-25);
    height: var(--p-spacing-2-25);
}

.filter-section__option-list::-webkit-scrollbar-track {
    background: transparent;
}

.filter-section__option-list::-webkit-scrollbar-thumb {
    background: var(--p-gray-100);
    border-radius: var(--p-border-radius-sm);
}

.filter-section__empty {
    font-size: var(--p-font-size-xs);
    color: var(--p-gray-800);
    padding: var(--p-spacing-1) 0;
}

/* Loading placeholder for a filter section's options — centers our BaseSpinner
   where the "Loading…" text used to sit. */
.filter-section__loading {
    display: flex;
    justify-content: center;
    padding: var(--p-spacing-2) 0;
}
</style>
