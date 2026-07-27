<script setup lang="ts">
import { PLACEHOLDER_ICONS, type PlaceholderCategory } from '~/config/materialIcons'

// 'suppliers' / 'competitors' pick records to associate WITH a manufacturer (the
// manufacturer detail page); 'manufacturers' is the mirror — picking
// manufacturers to associate with a supplier (the supplier detail page).
type AssociationMode = 'suppliers' | 'competitors' | 'manufacturers'

interface Props {
  visible?: boolean
  mode: AssociationMode
  // Record ids already associated with this manufacturer (or, in 'manufacturers'
  // mode, with this supplier) — excluded from the picker so the same record
  // can't be added twice.
  existingIds?: Array<number | string>
  // The record these are being associated WITH (the manufacturer, or the supplier
  // in 'manufacturers' mode). Named in the "all already added" empty state.
  entityName?: string
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  existingIds: () => [],
  entityName: '',
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  'save': [ids: Array<number | string>]
  'add-new': []
}>()

const { fetchBusinessPartners, fetchBusinessPartnerCount } = useBusinessPartners()
const { fetchManufacturers, fetchManufacturerCount } = useManufacturers()
const { fetchBusinessPartnerGroups } = useBusinessPartnerGroups()
const competitorsCrud = useDirectusCrud('competitors')
const { getResponsiveUrl } = useAssetUrl()

const localVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value),
})

const isCompetitors = computed(() => props.mode === 'competitors')
const isManufacturers = computed(() => props.mode === 'manufacturers')
const isSuppliers = computed(() => props.mode === 'suppliers')
const OPERATING_EXPENSE_GROUP_NAME = 'Operating Expense'
const operatingExpenseGroupId = ref<number | null>(null)

async function resolveOperatingExpenseGroupId() {
  if (operatingExpenseGroupId.value !== null) { return }
  const { data } = await fetchBusinessPartnerGroups()
  operatingExpenseGroupId.value =
    data?.find((group) => group.name === OPERATING_EXPENSE_GROUP_NAME)?.id ?? null
}
const supplierExcludeGroupIds = computed<number[] | null>(() =>
  isSuppliers.value && operatingExpenseGroupId.value != null
    ? [operatingExpenseGroupId.value]
    : null,
)

// Which placeholder art the logo-less rows draw — mode maps 1:1 onto category.
const placeholderCategory = computed<PlaceholderCategory>(() => {
  if (isCompetitors.value) { return 'competitor' }
  return isManufacturers.value ? 'manufacturer' : 'supplier'
})

// Suppliers carry account/status; competitors and manufacturers are name-only.
const SUPPLIER_FIELDS = ['id', 'name', 'account_number', 'logo_id', 'website', 'status']
const COMPETITOR_FIELDS = ['id', 'name', 'logo_id', 'website']
const MANUFACTURER_FIELDS = ['id', 'name', 'logo_id', 'website']
const STATUS_OPTIONS = [
  { label: 'Active', value: 'active' },
  { label: 'Inactive', value: 'inactive' },
]

// Every label in the picker, keyed by what it's picking.
const MODE_COPY: Record<AssociationMode, {
  title: string
  search: string
  page: string
  addNew: string
}> = {
  suppliers: {
    title: 'Add Existing Supplier',
    search: 'Search Suppliers',
    page: 'suppliers',
    addNew: 'Add New Supplier',
  },
  competitors: {
    title: 'Add Existing Competitor',
    search: 'Search Competitors',
    page: 'competitors',
    addNew: 'Add New Competitor',
  },
  manufacturers: {
    title: 'Add Existing Manufacturer',
    search: 'Search Manufacturers',
    page: 'manufacturers',
    addNew: 'Add New Manufacturer',
  },
}

const copy = computed(() => MODE_COPY[props.mode])
const drawerTitle = computed(() => copy.value.title)
const searchPlaceholder = computed(() => copy.value.search)
const search = ref('')
const isLoading = ref(false)
const isLoadingMore = ref(false)
const hasMore = ref(true)
const totalRecords = ref(0)
const hasLoaded = ref(false)
const records = ref<Record<string, any>[]>([])
const selected = ref<Record<string, any>[]>([])
const pickerTableRef = ref<any>(null)

// No-match line shown while a search is active (the "all already associated"
// case is carried by the richer empty-state hero below instead).
const noMatchMessage = computed(
  () => `No ${copy.value.page} match “${search.value.trim()}”`,
)

// ── "All already added" empty-state hero (Figma 6720-186747) ────────────────
// Entity icon reuses the row-placeholder art so the hero matches the list.
const entityIcon = computed(() => PLACEHOLDER_ICONS[placeholderCategory.value])
// copy.page is the plural noun ('competitors'); the singular drops the trailing s.
const entitySingular = computed(() => copy.value.page.replace(/s$/, ''))
const entityTitle = computed(
  () => `All Existing ${copy.value.page.charAt(0).toUpperCase()}${copy.value.page.slice(1)} Have Been Added`,
)
// Falls back to a generic noun when the parent didn't pass its name.
const entityLabel = computed(() => props.entityName.trim() || `this ${isManufacturers.value ? 'supplier' : 'manufacturer'}`)

// Show the hero (in place of the table) only once a completed load has found
// nothing to add and no search is narrowing it — so it never fights the table's
// own loading spinner or no-match line, and never sits inside the scroll body.
const showAllAddedState = computed(
  () => !isLoading.value && !search.value.trim() && records.value.length === 0 && totalRecords.value === 0,
)

// Hide the search field when there's genuinely nothing to search (all records
// already associated). Keep it visible while a search is active so it stays
// clearable, and once any results exist.
const showSearch = computed(() =>
  Boolean(search.value.trim())
  || totalRecords.value > 0
  || (isLoading.value && hasLoaded.value),
)

// One page per request; more pages append as the user scrolls the list — the
// same infinite-scroll + footer-spinner pattern as the suppliers list page.
const PAGE_SIZE = 25
let currentPage = 1

// Status filter (suppliers only) — starts unset, toggled via the shared filter
// toolbar. An empty selection means "all".
const selectedStatuses = ref<string[]>([])

// "Clear" resets the status filter to none (= show all statuses).
function clearStatusFilter() {
  selectedStatuses.value = []
}

// Fetch one page — suppliers (via business partners) or competitors. Same query
// shape as fetchTotal() so the running total lines up.
// Already-associated ids are excluded server-side (from BOTH the page query and
// the count) so the footer total stays in step with what the list actually
// shows — otherwise the count includes rows the picker filters out.
const excludeIds = computed(() => (props.existingIds.length ? [...props.existingIds] : null))
// Competitors and manufacturers are plain collections — exclude by primary key.
// (Suppliers go through fetchBusinessPartners, which takes `excludeIds` directly.)
const excludeIdFilter = computed(() =>
  excludeIds.value ? { id: { _nin: excludeIds.value } } : null,
)

// Manufacturer search is name-only, left-to-right (prefix). We deliberately do
// NOT use Directus's `search` param for manufacturers: it full-text matches
// EVERY field, so a query like "t" hit the `website` URLs ("http…") and returned
// unrelated names (3M, A-1 Compressor). `_istarts_with` = case-insensitive prefix
// on `name` only, mirroring the other Manufacturer dropdowns (CONNECT-701).
const manufacturerFilter = computed<Record<string, unknown> | null>(() => {
  const term = search.value.trim()
  const conditions: Record<string, unknown>[] = []
  if (excludeIdFilter.value) { conditions.push(excludeIdFilter.value) }
  if (term) { conditions.push({ name: { _istarts_with: term } }) }
  if (!conditions.length) { return null }
  return conditions.length === 1 ? conditions[0]! : { _and: conditions }
})

function fetchPage(page: number) {
  if (isCompetitors.value) {
    return competitorsCrud.fetchMany({
      fields: COMPETITOR_FIELDS,
      sort: ['name'],
      limit: PAGE_SIZE,
      page,
      ...(excludeIdFilter.value ? { filter: excludeIdFilter.value } : {}),
      ...(search.value.trim() ? { search: search.value.trim() } : {}),
    })
  }
  if (isManufacturers.value) {
    return fetchManufacturers({
      fields: MANUFACTURER_FIELDS,
      sort: ['name'],
      limit: PAGE_SIZE,
      page,
      // Name-only prefix filter (see manufacturerFilter) — no full-text `search`.
      filter: manufacturerFilter.value,
    })
  }
  return fetchBusinessPartners({
    relationshipType: 'supplier',
    statusValues: selectedStatuses.value.length ? [...selectedStatuses.value] : null,
    excludeIds: excludeIds.value,
    excludeGroupIds: supplierExcludeGroupIds.value,
    search: search.value.trim() || null,
    limit: PAGE_SIZE,
    page,
    fields: SUPPLIER_FIELDS,
  })
}

async function fetchTotal() {
  const { data } = isCompetitors.value
    ? await competitorsCrud.fetchCount(excludeIdFilter.value, search.value.trim() || null)
    : isManufacturers.value
      ? await fetchManufacturerCount(manufacturerFilter.value, null)
      : await fetchBusinessPartnerCount({
          relationshipType: 'supplier',
          statusValues: selectedStatuses.value.length ? [...selectedStatuses.value] : null,
          excludeIds: excludeIds.value,
          excludeGroupIds: supplierExcludeGroupIds.value,
          search: search.value.trim() || null,
        })
  totalRecords.value = data ?? 0
}

// Resolve each logo to a responsive src. Already-associated rows are excluded
// server-side (see fetchPage/fetchTotal), so no client-side filtering here.
async function decoratePage(rows: Record<string, any>[]) {
  await Promise.all(rows.map(async (record) => {
    const responsive = await getResponsiveUrl(record.logo_id, 56)
    record._logoSrc = responsive?.src ?? null
    record._logoSrcset = responsive?.srcset ?? null
  }))
  return rows
}

// page 1 replaces (initial load / reload); later pages append (scroll).
async function loadPage(page: number, options: { silent?: boolean } = {}) {
  const { silent = false } = options
  if (page === 1) { isLoading.value = true }
  else if (!silent) { isLoadingMore.value = true }

  const [pageResult] = await Promise.all([
    fetchPage(page),
    page === 1 ? fetchTotal() : Promise.resolve(),
  ])
  const { data, error } = pageResult
  hasLoaded.value = true

  if (error || !data) {
    if (page === 1) { records.value = [] }
    hasMore.value = false
    isLoading.value = false
    isLoadingMore.value = false
    return
  }

  currentPage = page
  hasMore.value = data.length === PAGE_SIZE
  const decorated = await decoratePage(data)
  records.value = page === 1 ? decorated : [...records.value, ...decorated]
  isLoading.value = false
  isLoadingMore.value = false
}

// Infinite scroll — load the next page as the table body nears the bottom.
let scrollContainer: HTMLElement | null = null

function handleScroll(event: Event) {
  const container = event.target as HTMLElement
  const threshold = 100
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold
  if (nearBottom && hasMore.value && !isLoadingMore.value && !isLoading.value) {
    loadPage(currentPage + 1)
  }
}

// Re-top-up the rows when the window grows (e.g. maximise) so the table keeps
// filling the taller drawer instead of leaving a gap.
let resizeDebounce: ReturnType<typeof setTimeout> | null = null
function handleResizeFill() {
  if (resizeDebounce) { clearTimeout(resizeDebounce) }
  resizeDebounce = setTimeout(() => fillViewport(), 200)
}

function attachScroll() {
  detachScroll()
  const tableEl = pickerTableRef.value?.$el as HTMLElement | undefined
  scrollContainer = tableEl?.querySelector('.p-datatable-table-container') ?? null
  scrollContainer?.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', handleResizeFill, { passive: true })
}

function detachScroll() {
  scrollContainer?.removeEventListener('scroll', handleScroll)
  scrollContainer = null
  window.removeEventListener('resize', handleResizeFill)
  if (resizeDebounce) { clearTimeout(resizeDebounce); resizeDebounce = null }
}

// On large viewports one page often doesn't fill the table's height, leaving
// empty space below the rows. Keep loading pages until the rows overflow the
// scroll container (a scrollbar appears) or there's nothing more to fetch — so
// the table stays filled with content on big screens instead of looking short.
async function fillViewport() {
  await nextTick()
  const container = pickerTableRef.value?.$el?.querySelector('.p-datatable-table-container') as HTMLElement | null
  if (!container) { return }
  let guard = 0
  while (
    hasMore.value
    && !isLoading.value
    && !isLoadingMore.value
    && container.scrollHeight <= container.clientHeight
    && guard < 20
  ) {
    guard += 1
    await loadPage(currentPage + 1, { silent: true })
    await nextTick()
  }
}

// Reload from page 1 then top up until the table's height is filled.
async function reloadFirstPage() {
  await loadPage(1)
  await fillViewport()
}

// Clearing re-runs the query through the same debounced `search` watcher below.
function handleSearchIconClick(): void {
  if (search.value) { search.value = '' }
}

let searchDebounce: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  isLoading.value = true
  if (searchDebounce) { clearTimeout(searchDebounce) }
  searchDebounce = setTimeout(() => reloadFirstPage(), 300)
})

// Status filter changes are discrete — reload immediately (suppliers only).
watch(selectedStatuses, () => reloadFirstPage(), { deep: true })

watch(localVisible, async (isOpen) => {
  if (!isOpen) {
    detachScroll()
    return
  }
  search.value = ''
  selected.value = []
  selectedStatuses.value = []
  hasLoaded.value = false
  // Baseline the empty selection so the guard is clean until the user picks.
  captureBaseline()
  if (isSuppliers.value) { await resolveOperatingExpenseGroupId() }
  await loadPage(1)
  await nextTick()
  attachScroll()
  await fillViewport()
})

onBeforeUnmount(detachScroll)

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(pickerTableRef, computed(() => records.value.length))
const { showFooterShadow } = useTableFooterShadow(pickerTableRef, computed(() => records.value.length))
const { isDirty, captureBaseline, resetBaseline } = useUnsavedGuard(
  () => selected.value.map((record) => record.id),
  localVisible,
)

function handleSave() {
  emit('save', selected.value.map((record) => record.id))
  resetBaseline()
  localVisible.value = false
}

function handleCancel() {
  localVisible.value = false
}

// "Add New <record>": commit anything already picked from the list, close this
// picker, and signal the parent to open the "request a brand-new record" form —
// for a supplier / competitor / manufacturer that isn't in Connect yet.
function handleRequestNew() {
  if (selected.value.length) {
    emit('save', selected.value.map((record) => record.id))
  }
  resetBaseline()
  localVisible.value = false
  emit('add-new')
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="drawerTitle"
    no-footer-shadow
    flush-content-bottom
    :dirty="isDirty"
    @save="handleSave"
  >
    <template #header>
      <div
        v-if="showSearch"
        class="add-assoc__search"
      >
        <div class="section-filter add-assoc__search-field">
          <InputText
            v-model="search"
            autocomplete="off"
            :placeholder="searchPlaceholder"
            size="small"
            class="section-filter__input add-assoc__search-input"
          />
          <SectionFilterIcon
            :active="Boolean(search)"
            @activate="handleSearchIconClick"
          />
        </div>

        <!-- Status filter is supplier-only (competitors have no status). Reuses
             the shared items-table filter toolbar, inline so the funnel renders
             here in the drawer header instead of teleporting to the top nav. -->
        <BaseFilterToolbar
          v-if="isSuppliers"
          inline
          :filter-count="selectedStatuses.length"
          aria-label="Filter by status"
          @clear-all="clearStatusFilter"
        >
          <BaseFilterSection
            title="Status"
            is-last
            :active-count="selectedStatuses.length"
            @clear="clearStatusFilter"
          >
            <div class="filter-section__options-row">
              <div
                v-for="option in STATUS_OPTIONS"
                :key="option.value"
                class="filter-section__option"
              >
                <Checkbox
                  v-model="selectedStatuses"
                  :input-id="`add-assoc-status-${option.value}`"
                  :value="option.value"
                />
                <label :for="`add-assoc-status-${option.value}`">
                  <Tag
                    :value="option.label"
                    :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
                  />
                </label>
              </div>
            </div>
          </BaseFilterSection>
        </BaseFilterToolbar>
      </div>
    </template>

    <!-- All records already associated: the richer empty-state hero replaces the
         table entirely, so it centres in the drawer body without reserving the
         table's scroll height (no stray scrollbar) or being clipped by a cell. -->
    <div
      v-if="showAllAddedState"
      class="add-assoc__all-added"
    >
      <BaseEmptyState
        :icon="entityIcon"
        :title="entityTitle"
      >
        All of your organization's existing {{ copy.page }} are associated with
        <strong>{{ entityLabel }}</strong>. To add a new {{ entitySingular }} that
        is not listed, click the <strong>{{ copy.addNew }}</strong> button.
      </BaseEmptyState>
    </div>

    <DataTable
      v-else
      ref="pickerTableRef"
      v-model:selection="selected"
      :value="records"
      data-key="id"
      scrollable
      scroll-height="max(calc(100dvh - 255px), 200px)"
      :meta-key-selection="false"
      :class="['add-assoc__table', { 'add-assoc__table--no-rows': !records.length }]"
    >
      <!-- First-load spinner, or a muted no-match line while a search is active.
           (The "all already added" case is the hero above, not here.) -->
      <template #empty>
        <div class="add-assoc__state">
          <BaseSpinner
            v-if="isLoading"
            size="md"
          />
          <span v-else>{{ noMatchMessage }}</span>
        </div>
      </template>

      <Column
        selection-mode="multiple"
        style="width: 50px; min-width: 50px"
      />

      <Column
        v-if="isSuppliers"
        field="account_number"
        header="Account"
        sortable
        style="width: clamp(92px, 9vw, 116px)"
      >
        <template #body="{ data: record }">
          <BaseCopyText
            v-if="record.account_number"
            :value="record.account_number"
          />
          <span v-else>—</span>
        </template>
      </Column>

      <Column
        field="name"
        header="Name"
        sortable
        :style="isSuppliers ? 'width: clamp(160px, 24vw, 240px)' : undefined"
      >
        <template #body="{ data: record }">
          <div class="add-assoc__company">
            <span
              class="placeholder-thumb"
              :class="{ 'placeholder-thumb--empty': !record._logoSrc }"
            >
              <img
                v-if="record._logoSrc"
                :src="record._logoSrc"
                :srcset="record._logoSrcset ?? undefined"
                sizes="30px"
                alt=""
                class="placeholder-thumb__img"
              >
              <BasePlaceholderIcon
                v-else
                :category="placeholderCategory"
                class="placeholder-thumb__icon"
              />
            </span>
            <BaseWebsiteLink
              :website="record.website"
              :name="record.name"
            />
            <span class="add-assoc__name">{{ record.name }}</span>
          </div>
        </template>
      </Column>

      <Column
        v-if="isSuppliers"
        field="status"
        header="Status"
        sortable
        style="width: clamp(96px, 10vw, 120px)"
      >
        <template #body="{ data: record }">
          <Tag
            :value="record.status === 'active' ? 'Active' : 'Inactive'"
            :class="record.status === 'active' ? 'status-active' : 'status-inactive'"
          />
        </template>
      </Column>

      <!-- Results count + "Loading more…" spinner, pinned below the scroll body
           (same BaseDataTableFooterLoader the suppliers list page uses). Hidden
           while the list is empty — the centred #empty message carries that state
           instead, so the count never shows a redundant "0 of 0". -->
      <template #footer>
        <BaseDataTableFooterLoader
          v-if="totalRecords > 0 || isLoadingMore"
          :loading="isLoadingMore"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="totalRecords"
          :show-shadow="showFooterShadow || isLoadingMore"
          :page-label="copy.page"
          :filter-text="search"
        />
      </template>
    </DataTable>

    <template #footer>
      <div class="add-assoc__footer">
        <!-- Nothing to select in the "all already added" state, so Save/Cancel
             are hidden; the footer's space-between then drops "Add New …" to the
             left as the only remaining action. -->
        <BaseActionButtons
          v-if="!showAllAddedState"
          :save-disabled="!selected.length"
          @save="handleSave"
          @cancel="handleCancel"
        />
        <!-- Escape hatch for a record that isn't in Connect yet — present in every
             mode. In the "all already added" state it's the sole action, shown as
             the filled primary CTA with an arrow (Figma 6720-186747); otherwise the
             outlined companion to Save/Cancel. -->
        <Button
          v-if="showAllAddedState"
          class="add-assoc__add-new-cta"
          @click="handleRequestNew"
        >
          <span>{{ copy.addNew }}</span>
          <i
            class="pi pi-arrow-right"
            aria-hidden="true"
          />
        </Button>
        <Button
          v-else
          outlined
          class="add-assoc__add-new"
          @click="handleRequestNew"
        >
          <span>{{ copy.addNew }}</span>
        </Button>
      </div>
    </template>
  </BaseDrawer>
</template>

<style scoped>
/* Header search row: input grows, funnel (suppliers only) sits on the right. */
.add-assoc__search {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    width: 100%;
}

.add-assoc__search-field {
    flex: 1;
    min-width: 0;
}

/* Override the shared section-filter clamp width so the search fills the header
   row, and match the funnel button's 33px height. Border-radius (xs), border,
   white background and the form-field shadow already come from the inputtext
   preset, so only the height + padding need pinning. 7px block / 10.5px inline
   per the design spec, keeping extra inline-end room for the search icon. */
:deep(.add-assoc__search-input.p-inputtext) {
    width: 100%;
    height: 33px;
    padding-block: var(--p-spacing-1-75);
    padding-inline: var(--p-spacing-2-625) var(--p-spacing-8);
}

/* The shared section-filter icon is brand-blue (it's an interactive collapse
   toggle there); here it's a plain decorative search glyph, so use the muted
   input-icon color instead. */
/* Muted + inert while the field is empty. Scoped to :not(--active) so it can't
   out-specify the global .section-filter__icon--active red once a query exists. */
.add-assoc__search :deep(.section-filter__icon:not(.section-filter__icon--active)) {
    color: var(--p-text-muted-color);
    cursor: default;
}

.add-assoc__search :deep(.section-filter__icon--active) {
    cursor: pointer;
}

/* Footer: Save/Cancel on the left, the "add new" affordance pushed to the far
   right. */
.add-assoc__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-3);
    width: 100%;
}

/* Outlined brand-blue button, sized to match the adjacent Save/Cancel buttons
   (default button font/height). Opens the request-a-new-supplier form. */
.add-assoc__add-new.p-button {
    flex-shrink: 0;
    gap: var(--p-spacing-1-75);
    border: 1px solid var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-medium);
}

.add-assoc__add-new.p-button:hover {
    background: var(--p-tideblue-50);
    border-color: var(--p-skyblue-200);
    color: var(--p-skyblue-600);
}

/* Empty-state CTA — the default PrimeVue primary button (filled skyblue, white
   label + arrow); only stop it shrinking in the footer flex row. */
.add-assoc__add-new-cta.p-button {
    flex-shrink: 0;
}

:deep(.p-datatable-thead > tr > th:first-child .p-checkbox) {
    display: none;
}

.add-assoc__table {
    flex: 1;
    min-height: 0;
}

/* No rows (empty or first load): drop the column header so the drawer shows just
   the centred message/spinner, not a lone sortable "Name" header over nothing. */
.add-assoc__table--no-rows :deep(.p-datatable-thead) {
    display: none;
}

/* No rows = nothing to scroll, so never show the scroll container's bar while
   loading / empty. PrimeVue sets `overflow: auto` inline on the container, so this
   needs !important to win. */
.add-assoc__table--no-rows :deep(.p-datatable-table-container) {
    overflow-y: hidden !important;
}

/* Rows here aren't clickable — selection happens through the checkbox column
   (the DataTable has no `selection-mode` of its own), so the shared data-table
   `cursor: pointer` on body cells promises an interaction the row doesn't have.
   The checkbox, globe and copy controls carry their own pointer. */
.add-assoc__table :deep(.p-datatable-tbody > tr > td) {
    cursor: default;
}


/* Footer counter: bottom-align it (top pad, zero below) so the gap beneath the
   count matches the panel/shipping-estimator footer — centring it in a tall band
   left too much space below, which read as an oversized gap above the buttons. */
.add-assoc__table :deep(.p-datatable-footer) {
    padding: 0;
}

.add-assoc__table :deep(.infinite-scroll-footer) {
    box-sizing: border-box;
    align-items: end;
    width: 100%;
    min-height: calc(var(--p-spacing-4) + var(--p-spacing-7));
    padding: var(--p-spacing-4) 0 0;
}

.add-assoc__table :deep(.infinite-scroll-footer .footer-spacing) {
    padding-top: 0;
}

/* "All already added" hero — centred in the drawer body. `flex: 1` alone won't
   fill (the body's height isn't a definite constraint here), so anchor an explicit
   height to the viewport minus the header + footer bands AND the content's top
   padding. Kept comfortably shorter than the real body so it never overflows into a
   drawer scrollbar. */
.add-assoc__all-added {
    flex: 1;
    min-height: calc(100dvh - 180px);
    display: flex;
    align-items: center;
    justify-content: center;
}

/* First-load state: centre the BaseSpinner (loading) or the empty message in the
   scroll body. Matches the table's scroll-height so it sits in the middle. */
.add-assoc__state {
    display: flex;
    align-items: center;
    justify-content: center;
    /* Fill the scroll body (same height as the DataTable's scroll-height) so the
       message/spinner sits in the true vertical centre — the header is hidden in
       this state, so there's nothing above it eating the space. */
    min-height: max(calc(100dvh - 255px), 200px);
    /* Match the footer count's type so the empty message reads as the same
       system voice (mono, 2xs, muted). */
    color: var(--p-text-muted-color);
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-2xs);
}

/* The selection cell inherits the global 24px cell line-height, which creates a
   text line-box taller than the checkbox — so the checkbox rides that line's
   baseline and sits above the row's true center (while the 28px logo thumbnail
   in the Name cell is flex-centered). Zeroing the line-height drops the phantom
   text line, letting the cell's `vertical-align: middle` center the checkbox
   itself so it lines up with the thumbnail/globe/name. */
.add-assoc__table :deep(.p-datatable-tbody > tr > td:first-child) {
    line-height: 0;
}

.add-assoc__table :deep(.p-datatable-tbody > tr > td:first-child .p-checkbox) {
    vertical-align: middle;
}

.add-assoc__company {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    min-width: 0;
}


.add-assoc__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
