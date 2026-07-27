<script setup lang="ts">
const INITIAL_LIMIT = 10

interface Props {
  activities?: Record<string, any>[]
  contacts?: Record<string, any>[]
  activityGroups?: Record<string, any>[]
  businessPartnerId?: number | string | null
  // The customer's account manager — used to default a new activity's "Assign To"
  // when a follow-up date is set. Null for relationships without one.
  accountManagerId?: string | null
  accountManagerName?: string | null
  loading?: boolean
  collapsed?: boolean
  totalCount?: number
  isLoadingMore?: boolean
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  activities: () => [],
  contacts: () => [],
  activityGroups: () => [],
  businessPartnerId: null,
  accountManagerId: null,
  accountManagerName: null,
  loading: false,
  collapsed: false,
  totalCount: 0,
  isLoadingMore: false,
  hasMore: false,
})

const emit = defineEmits<{
  saved: []
  'scroll-near-bottom': []
  'load-all': []
}>()

const filterText = ref('')
const isFilterExpanded = ref(false)
const filterInputRef = ref<any>(null)
const activitiesTableRef = ref<any>(null)
const activityDrawerVisible = ref(false)
const activityDrawerData = ref<Record<string, any> | null>(null)
const activityDrawerReadOnly = ref(false)
const activityTotal = computed(() => props.totalCount || props.activities.length)
const EDIT_WINDOW_MS = 15 * 60 * 1000
const now = ref(Date.now())
let editWindowTimer: ReturnType<typeof setInterval> | null = null

function isActivityEditable(activity: Record<string, any>): boolean {
  const created = activity.dateCreated ? new Date(activity.dateCreated).getTime() : 0
  return created > 0 && now.value - created < EDIT_WINDOW_MS
}

// Row-action icon: a pencil while the activity is still editable (within the
// 15-minute window), otherwise a file — the read-only/locked state — matching the
// other detail-page sections. Both open the drawer (read-only when locked).
function resolveActivityIcon(activity: Record<string, any>): string {
  return isActivityEditable(activity) ? 'pi pi-pencil' : 'pi pi-file'
}

/**
 */
const filteredActivities = computed(() => {
  const query = filterText.value.toLowerCase().trim()
  if (!query) {return props.activities}
  return props.activities.filter((activity) => [activity.contact, activity.action, activity.subject, activity.notes]
    .filter(Boolean)
    .some((field) => field.toLowerCase().includes(query)))
})

const footerTotal = computed(() =>
  filterText.value.trim() ? filteredActivities.value.length : activityTotal.value,
)

// Small result sets render at natural height; larger ones get a fixed-height,
// virtual-scrolled table.
const isCompactTable = computed(() => filteredActivities.value.length <= INITIAL_LIMIT)

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(activitiesTableRef, () => filteredActivities.value.length)

function handleFilterIconClick() {
  if (filterText.value) {
    filterText.value = ''
    isFilterExpanded.value = false
  } else {
    isFilterExpanded.value = !isFilterExpanded.value
    if (isFilterExpanded.value) {
      nextTick(() => filterInputRef.value?.$el?.focus())
    }
  }
}

function handleMobileFilterClick() {
  if (filterText.value) {
    filterText.value = ''
    isFilterExpanded.value = true
  } else {
    isFilterExpanded.value = !isFilterExpanded.value
  }
}

let scrollContainer: HTMLElement | null = null

function handleTableScroll(event: Event) {
  const container = event.target as HTMLElement
  const nearBottom =
    container.scrollHeight - container.scrollTop - container.clientHeight < 100
  if (nearBottom && props.hasMore && !props.isLoadingMore) {
    emit('scroll-near-bottom')
  }
}

function bindScrollListener() {
  const next = (activitiesTableRef.value?.$el?.querySelector('.p-virtualscroller')
    ?? activitiesTableRef.value?.$el?.querySelector('.p-datatable-table-container')
    ?? null) as HTMLElement | null
  if (next === scrollContainer) {return}
  scrollContainer?.removeEventListener('scroll', handleTableScroll)
  scrollContainer = next
  scrollContainer?.addEventListener('scroll', handleTableScroll)
}

watch([() => props.activities.length, isCompactTable], () => {
  nextTick(bindScrollListener)
})
watch(
  () => isFilterExpanded.value || filterText.value.length > 0,
  (isSearchActive) => {
    if (isSearchActive) {emit('load-all')}
  },
)

onMounted(() => {
  editWindowTimer = setInterval(() => { now.value = Date.now() }, 30000)
  nextTick(bindScrollListener)
})

onUnmounted(() => {
  if (editWindowTimer) { clearInterval(editWindowTimer) }
  scrollContainer?.removeEventListener('scroll', handleTableScroll)
})

const emptyMessage = computed(() => {
  if (!activityTotal.value) {return 'No associated activities'}
  if (filterText.value.trim() && !filteredActivities.value.length) {
    return `0 of ${activityTotal.value} activities match`
  }
  return `0 of ${activityTotal.value} activities`
})

const { showFooterShadow } = useTableFooterShadow(activitiesTableRef, computed(() => filteredActivities.value.length))
const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(activitiesTableRef, computed(() => filteredActivities.value.length))

function openEditActivity(activity) {
  activityDrawerData.value = activity
  // Past the 15-minute window the activity is locked (document icon) — open the
  // drawer read-only so the user can only read, not edit.
  activityDrawerReadOnly.value = !isActivityEditable(activity)
  activityDrawerVisible.value = true
}


// Highlight the row whose activity drawer is currently open.
function rowClass(activity: Record<string, any>): string {
  return activityDrawerVisible.value && activity.id === activityDrawerData.value?.id
    ? 'is-drawer-active'
    : ''
}

function openAddActivity() {
  activityDrawerData.value = null
  activityDrawerReadOnly.value = false
  activityDrawerVisible.value = true
}
</script>

<template>
  <BasePanel
    id="activities"
    :title="`Activities (${activityTotal.toLocaleString()})`"
    :collapsed="collapsed"
    :loading="loading"
  >
    <template #actions>
      <div
        v-if="activityTotal > INITIAL_LIMIT"
        class="section-filter section-activity__filter-desktop"
      >
        <InputText
          ref="filterInputRef"
          v-model="filterText"
          v-search-input
          autocomplete="off"
          placeholder="Search Activities"
          size="small"
          :class="[
            'section-filter__input',
            { 'section-filter__input--collapsed': !isFilterExpanded }
          ]"
          @focus="isFilterExpanded = true"
        />
        <SectionFilterIcon
          :active="Boolean(filterText)"
          @activate="handleFilterIconClick"
        />
      </div>
      <Button
        v-if="activityTotal > INITIAL_LIMIT"
        outlined
        size="small"
        icon="pi pi-search"
        :class="['section-activity__filter', { 'section-activity__filter--active': filterText }]"
        aria-label="Search Activities"
        @click="handleMobileFilterClick"
      />
      <Button
        v-if="businessPartnerId"
        size="small"
        label="Add"
        icon="pi pi-plus"
        class="section-activity__add"
        @click="openAddActivity"
      />
    </template>
    <DataTable
      ref="activitiesTableRef"
      class="is-row-hoverable"
      :value="filteredActivities"
      data-key="id"
      :row-class="rowClass"
      scrollable
      removable-sort
      sort-field="dateCreated"
      :sort-order="-1"
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      @sort="$emit('load-all')"
    >
      <template #header>
        <div
          v-if="isFilterExpanded || filterText"
          class="section-activity__filter-row"
        >
          <InputText
            v-model="filterText"
            v-search-input
            autocomplete="off"
            placeholder="Search Activities"
            size="small"
            class="section-activity__filter-input"
          />
        </div>
      </template>
      <Column
        field="created_on"
        sort-field="dateCreated"
        header="Created On"
        sortable
        style="min-width: clamp(130px, 12vw, 150px)"
      />
      <Column
        field="created_by"
        header="Created By"
        sortable
        style="min-width: clamp(160px, 15vw, 200px)"
      />
      <Column
        field="contact"
        header="Contact"
        sortable
        style="min-width: clamp(200px, 22vw, 250px)"
      />
      <Column
        field="action"
        header="Action"
        sortable
        style="min-width: clamp(200px, 22vw, 250px)"
      />
      <Column
        field="subject"
        header="Subject"
        sortable
        style="min-width: clamp(170px, 18vw, 230px)"
      />
      <!-- The row opens the activity drawer, and the frozen column shows the
           edit/locked (pencil/file) icon — same affordance as the other sections. -->
      <BaseFrozenColumn
        key="frozen"
        :table-ref="activitiesTableRef"
        :actions="[{ icon: resolveActivityIcon, handler: openEditActivity }]"
      />
      <template
        #footer
      >
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :loading="loading || isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="footerTotal"
          page-label="activities"
          :filter-text="filterText"
          :empty-msg="emptyMessage"
        />
      </template>
    </DataTable>
  </BasePanel>

  <DrawerActivity
    v-model:visible="activityDrawerVisible"
    :activity="activityDrawerData"
    :contacts="contacts"
    :activity-groups="activityGroups"
    :business-partner-id="businessPartnerId"
    :account-manager-id="accountManagerId"
    :account-manager-name="accountManagerName"
    :read-only="activityDrawerReadOnly"
    @saved="emit('saved')"
  />
</template>

<style scoped>
.section-activity__filter {
    display: inline-flex;

    @media (min-width: 768px) {
        display: none;
    }
}

:deep(.section-activity__filter.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    border-color: var(--p-skyblue-200);
}

/* Add button — icon-only on mobile, icon + label from tablet up. */
:deep(.section-activity__add .p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

:deep(.section-activity__add.p-button) {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;

    @media (min-width: 768px) {
        width: auto;
        height: auto;
        min-width: auto;
        padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    }
}

.section-activity__filter-desktop {
    display: none;

    @media (min-width: 768px) {
        display: flex;
    }
}

.section-activity__filter-desktop :deep(.section-filter__input--collapsed) {
    border-color: var(--p-skyblue-200);
}

.section-activity__filter-row {
    display: block;
    padding-bottom: var(--p-spacing-2);

    @media (min-width: 768px) {
        display: none;
    }
}

.section-activity__filter-input {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

:deep(.section-activity__filter--active.p-button) {
    color: var(--p-red-500);
    border-color: var(--p-skyblue-200);
}
</style>
