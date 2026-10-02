<script setup lang="ts">
import type { ManufacturerSupplier, ManufacturerCompetitor } from '~/composables/useManufacturers'
import type { BusinessPartnerManufacturer } from '~/composables/useBusinessPartners'
import type { PlaceholderCategory } from '~/config/materialIcons'

const REMARKS_MAX = 1000

type AssociationMode = 'suppliers' | 'competitors' | 'manufacturers'
type AssociationItem = ManufacturerSupplier | ManufacturerCompetitor | BusinessPartnerManufacturer
// The two master-detail modes share the detail view (logo / name / website +
// remarks). Manufacturers additionally edits status + remarks and reorders.
type DetailItem = ManufacturerCompetitor | BusinessPartnerManufacturer

interface Props {
  visible?: boolean
  mode: AssociationMode
  items?: AssociationItem[]
  loading?: boolean
  skeletonCount?: number
  // When opened with an id (competitors mode), jump straight to that
  // competitor's detail view instead of the list — used by the "view details"
  // action on the manufacturer detail-page table.
  initialDetailId?: number | string | null
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  items: () => [],
  loading: false,
  skeletonCount: 4,
  initialDetailId: null,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  // Payload shape differs by mode — suppliers emit { junctionId, … }, the
  // manufacturers consumer reads { id, … } — so it's kept loose. status /
  // remarks / inactiveNote only appear when the caller may write them, and
  // consumers must patch only the keys present.
  'save': [payload: any]
  'reorder': [order: Array<{ id: number | string, currentSort: number | null }>]
}>()

const localVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value),
})

const isCompetitors = computed(() => props.mode === 'competitors')
const isManufacturers = computed(() => props.mode === 'manufacturers')

// Which placeholder art the logo-less rows and detail panes draw. Mode maps 1:1
// onto the record category, so both panes can share one source of truth.
const placeholderCategory = computed<PlaceholderCategory>(() => {
  if (isCompetitors.value) { return 'competitor' }
  return isManufacturers.value ? 'manufacturer' : 'supplier'
})
const emptyText = computed(() => {
  if (isManufacturers.value) { return 'No manufacturers found.' }
  return isCompetitors.value ? 'No competitors found.' : 'No suppliers found.'
})

// List-view name filter (manufacturers). Declared early so canReorder can read
// it; the filtering + overflow logic lives after listItems below.
const listSearch = ref('')

// Status filter — Active/Inactive, empty = show all. Mirrors the contacts drawer
// (DrawerViewContactInfo): the list opens unfiltered and resets to that default
// when the drawer closes. Competitors carry no status, so the filter is
// suppliers / manufacturers only.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]
const DEFAULT_STATUSES: string[] = []
const selectedStatuses = ref<string[]>([...DEFAULT_STATUSES])
const showStatusFilter = computed(() => !isCompetitors.value)

function clearStatusFilter(): void {
  selectedStatuses.value = []
}

// Empty selection = no status filter (every status shows).
function matchesStatus(entry: AssociationItem): boolean {
  if (!selectedStatuses.value.length) { return true }
  const status = String((entry as ManufacturerSupplier).status ?? 'active').toLowerCase()
  return selectedStatuses.value.includes(status)
}

// Render one skeleton per real record (parent passes the known count) so the
// loading placeholder matches the list's true length — no cap.
const skeletonRows = computed(() =>
  Array.from({ length: Math.max(1, props.skeletonCount) }, (_, index) => index),
)

// ── Master-detail (competitors = view, suppliers = edit) ──────────────────
// selectedDetail backs the shared detail view (competitor read-only or
// manufacturer edit); suppliers use the separate selectedSupplier path.
const selectedDetail = ref<DetailItem | null>(null)
const selectedSupplier = ref<ManufacturerSupplier | null>(null)

// Directus manufacturers_business_partners.remarks is a SOFT limit (softLength
// 1000, no DB max_length) — show the counter but don't hard-cap typing.
const REMARKS_SOFT_LIMIT = 1000
const editStatus = ref<string>('active')
const editRemarks = ref<string>('')
const editInactiveNote = ref<string>('')

// Manufacturers-mode detail edit (status + remarks).
const statusValue = ref<string>('active')
const remarksValue = ref<string>('')
const inactiveNoteValue = ref<string>('')
const remarksLength = computed(() => remarksValue.value.length)
const { limitFor } = useCharLimits('manufacturers_business_partners')
// Inactive-note suggestions authored on the Directus field (CONNECT-708).
const { presetsFor } = useFieldPresets('manufacturers_business_partners')

// Status, its note and remarks are separate field grants on the junction, and
// both halves of this drawer — the manufacturer list and the supplier edit
// view — write the same columns. Each control disables on its own grant, and
// the emitted save carries only the fields the caller may write. All false
// until resolved, so an unknown answer leaves the controls disabled rather
// than offering a field that fails on save.
const { loadStatusFieldRights, getStatusFieldRights } = usePermissions()
loadStatusFieldRights()

const junctionRights = computed(() => getStatusFieldRights('manufacturers_business_partners'))
const canEditStatus = computed(() => junctionRights.value.status)
const canEditInactiveNote = computed(() => junctionRights.value.inactiveNote)
const canEditRemarks = computed(() => junctionRights.value.remarks)
const submitted = ref(false)

const activeInactiveNote = computed(() =>
  isManufacturers.value ? inactiveNoteValue.value : editInactiveNote.value,
)
const activeStatus = computed(() =>
  isManufacturers.value ? statusValue.value : editStatus.value,
)
// The note is only demanded from a user who may write it — a status-only user
// flipping to inactive must not be blocked on a disabled field.
const inactiveNoteError = computed(() =>
  canEditInactiveNote.value && activeStatus.value === 'inactive' && !activeInactiveNote.value.trim()
    ? 'Inactive note is required'
    : '',
)

const listTitle = computed(() => {
  if (isManufacturers.value) { return 'Manufacturers' }
  return isCompetitors.value ? 'Competitors' : 'Suppliers'
})

// True once a card's "View Details" opens a detail/edit pane (competitor view or
// supplier edit) — drives the "← Back to {list}" header and the supplier footer.
const isDetailView = computed(() => !!selectedDetail.value || !!selectedSupplier.value)
const openedDirectToDetail = ref(false)
const detailTitle = computed(() => {
  if (isManufacturers.value) { return 'Edit Manufacturer' }
  if (isCompetitors.value) { return 'Competitor' }
  return 'Edit Supplier'
})
const title = computed(() =>
  isDetailView.value && openedDirectToDetail.value ? detailTitle.value : listTitle.value,
)
const { isDirty, captureBaseline, resetBaseline } = useUnsavedGuard(
  () => {
    if (selectedSupplier.value) {
      return { status: editStatus.value, remarks: editRemarks.value, inactiveNote: editInactiveNote.value }
    }
    if (isManufacturers.value && selectedDetail.value) {
      return { status: statusValue.value, remarks: remarksValue.value, inactiveNote: inactiveNoteValue.value }
    }
    return null
  },
  localVisible,
)

// Slide direction for the list ⇄ detail swap: "forward" (View Details) pushes
// the detail pane in from the right, "back" returns the list from the left.
const slideDirection = ref<'forward' | 'back'>('forward')
const slideTransitionName = computed(() =>
  slideDirection.value === 'forward' ? 'drawer-slide-forward' : 'drawer-slide-back',
)
const isSwapping = ref(false)

// Wraps both panes; used to reach the drawer's scroll container.
const viewsRef = ref<HTMLElement | null>(null)
let savedListScrollTop = 0

function getDrawerScroll(): HTMLElement | null {
  return viewsRef.value?.closest('.p-drawer-content') ?? null
}

// "View Details" — open the detail pane for whichever mode is active.
function viewDetails(entry: AssociationItem): void {
  savedListScrollTop = getDrawerScroll()?.scrollTop ?? 0
  slideDirection.value = 'forward'
  isSwapping.value = true
  openedDirectToDetail.value = false
  if (isCompetitors.value || isManufacturers.value) {
    selectedDetail.value = entry as DetailItem
  } else {
    selectedSupplier.value = entry as ManufacturerSupplier
  }
  getDrawerScroll()?.scrollTo({ top: 0 })
}
function backToList(): void {
  if (openedDirectToDetail.value) {
    localVisible.value = false
    return
  }
  slideDirection.value = 'back'
  isSwapping.value = true
  selectedDetail.value = null
  selectedSupplier.value = null
  // Restore the list's previous scroll position once the list pane is back.
  nextTick(() => {
    getDrawerScroll()?.scrollTo({ top: savedListScrollTop })
  })
  // Back on the list there's nothing to save — re-baseline so the guard is clean.
  captureBaseline()
}

// Save from the shared unsaved-changes dialog: persist the active edit, then close.
function handleGuardedSave(): void {
  const saved = isManufacturers.value ? saveManufacturer() : saveSupplier()
  if (!saved) { return }
  resetBaseline()
  localVisible.value = false
}

// Persist supplier edits (status / remarks) to the parent. Only fields the
// caller may write are emitted — the consumers patch the keys present, and a
// PATCH containing an unwritable key is refused by Directus even unchanged.
function saveSupplier(): boolean {
  if (!selectedSupplier.value) { return false }
  submitted.value = true
  if (inactiveNoteError.value) { return false }
  const savePayload: Record<string, unknown> = { junctionId: selectedSupplier.value.junctionId }
  if (canEditStatus.value) {
    savePayload.status = editStatus.value
  }
  if (canEditRemarks.value) {
    savePayload.remarks = editRemarks.value
  }
  if (canEditInactiveNote.value) {
    savePayload.inactiveNote = editStatus.value === 'inactive' ? editInactiveNote.value.trim() : null
  }
  emit('save', savePayload)
  return true
}

// Footer Save — persist then return to the supplier list.
function handleSupplierSaveClick(): void {
  if (!saveSupplier()) { return }
  backToList()
}

// Footer "Supplier Details →" — jump to the full supplier detail page.
function goToSupplierDetail(): void {
  // Prefer the SAP account number; fall back to the Directus id so a supplier
  // without a SAP id (not yet synced) still opens. The route resolves both.
  const target = selectedSupplier.value?.accountNumber || selectedSupplier.value?.id
  if (!target) { return }
  navigateTo(`/suppliers/${target}`)
}

// Manufacturers mode: persist status + remarks (consumer reads { id, … }),
// then return to the list. Same permission scoping as saveSupplier above.
function saveManufacturer(): boolean {
  if (!selectedDetail.value) { return false }
  submitted.value = true
  if (inactiveNoteError.value) { return false }
  const savePayload: Record<string, unknown> = { id: selectedDetail.value.id }
  if (canEditStatus.value) {
    savePayload.status = statusValue.value
  }
  if (canEditRemarks.value) {
    savePayload.remarks = remarksValue.value
  }
  if (canEditInactiveNote.value) {
    savePayload.inactiveNote = statusValue.value === 'inactive' ? inactiveNoteValue.value.trim() : null
  }
  emit('save', savePayload)
  return true
}
function handleManufacturerSaveClick(): void {
  if (!saveManufacturer()) { return }
  backToList()
}

// Footer "Manufacturer Details →" — jump to the full manufacturer detail page.
function goToManufacturerDetail(): void {
  const manufacturerId = (selectedDetail.value as BusinessPartnerManufacturer | null)?.manufacturerId
  if (manufacturerId == null) { return }
  navigateTo(`/manufacturers/${manufacturerId}`)
}

// The edit footer is shared by suppliers (selectedSupplier) and manufacturers
// (selectedDetail); route Save / detail-link by mode.
function handleFooterSave(): void {
  if (isManufacturers.value) { handleManufacturerSaveClick() } else { handleSupplierSaveClick() }
}
function goToDetailPage(): void {
  if (isManufacturers.value) { goToManufacturerDetail() } else { goToSupplierDetail() }
}

// Reset to the list whenever the drawer closes or the data set changes. When
// opened with an initialDetailId, jump straight to that record's detail/edit.
watch(localVisible, (isOpen) => {
  if (!isOpen) {
    selectedDetail.value = null
    selectedSupplier.value = null
    openedDirectToDetail.value = false
    listSearch.value = ''
    selectedStatuses.value = [...DEFAULT_STATUSES]
    return
  }
  if (props.initialDetailId == null) {
    openedDirectToDetail.value = false
    return
  }
  const match = props.items.find((entry) => entry.id === props.initialDetailId)
  openedDirectToDetail.value = !!match
  if (isCompetitors.value || isManufacturers.value) {
    selectedDetail.value = (match as DetailItem) ?? null
  } else {
    selectedSupplier.value = (match as ManufacturerSupplier) ?? null
  }
})
watch(() => props.items, () => {
  slideDirection.value = 'back'
  selectedDetail.value = null
  selectedSupplier.value = null
  openedDirectToDetail.value = false
})

// Logo for the detail view (competitor or supplier) → responsive image.
const detailLogoId = ref<string | null>(null)
const {
  assetSrc: detailLogoSrc,
  assetSrcset: detailLogoSrcset,
  refreshAssetSource: refreshDetailLogo,
  handleAssetError: handleDetailLogoError,
} = useAssetImageSource(detailLogoId, { width: LOGO_DETAIL_WIDTH })

// Squarish artwork is scaled so its corners clear the ring — see useLogoFit.
const { logoFit, isLogoMeasured, isLogoLoading, handleLogoLoad, handleLogoMount } = useLogoFit(detailLogoSrc)

function resolveDetailLogo(logoId: string | null) {
  detailLogoId.value = logoId
  // Re-showing the same detail leaves the id unchanged, so nothing would
  // rebuild — restamp the current token explicitly.
  void refreshDetailLogo()
}

watch(selectedDetail, (detail) => {
  resolveDetailLogo(detail?.logoId ?? null)
  // Manufacturers-mode edit: seed the status / remarks fields from the selection.
  if (isManufacturers.value) {
    const manufacturer = detail as BusinessPartnerManufacturer | null
    statusValue.value = manufacturer?.status ?? 'active'
    remarksValue.value = manufacturer?.remarks ?? ''
    inactiveNoteValue.value = manufacturer?.inactiveNote ?? ''
    submitted.value = false
  }
  // Baseline the freshly-populated edit (or the read-only competitor → clean).
  if (detail) { captureBaseline() }
})
watch(selectedSupplier, (supplier) => {
  editStatus.value = supplier?.status ?? 'active'
  editRemarks.value = supplier?.remarks ?? ''
  editInactiveNote.value = supplier?.inactiveNote ?? ''
  submitted.value = false
  resolveDetailLogo(supplier?.logoId ?? null)
  // Baseline the freshly-populated supplier edit for the unsaved-changes guard.
  if (supplier) { captureBaseline() }
})

// ── Manufacturers drag-to-reorder ──────────────────────────────────────────
// A local working copy so the live drag never mutates the `items` prop; the new
// order is emitted on drop for the parent to persist.
const orderedManufacturers = ref<BusinessPartnerManufacturer[]>([])
watch(() => props.items, (items) => {
  if (isManufacturers.value) {
    orderedManufacturers.value = [...(items as BusinessPartnerManufacturer[])]
  }
}, { immediate: true })

const listItems = computed<AssociationItem[]>(() =>
  isManufacturers.value ? orderedManufacturers.value : props.items,
)

// Status filter sits between the ordered source and the name search, so the
// search composable receives the already status-filtered set.
const statusFilteredItems = computed<AssociationItem[]>(() =>
  showStatusFilter.value ? listItems.value.filter(matchesStatus) : listItems.value,
)

// Reorder only from the unfiltered home order — a name search or a status filter
// hides rows, so the drag indices would no longer map onto orderedManufacturers.
const canReorder = computed(() =>
  isManufacturers.value
  && !props.loading
  && !listSearch.value.trim()
  && statusFilteredItems.value.length === orderedManufacturers.value.length
  && orderedManufacturers.value.length > 1,
)
const draggingIndex = ref<number | null>(null)
// The card only becomes draggable once the handle is grabbed, so clicking a
// card body / "View Details" never starts a drag.
const isHandleArmed = ref(false)

function armHandle(): void {
  if (canReorder.value) { isHandleArmed.value = true }
}

function handleDragStart(index: number, event: DragEvent): void {
  if (!isHandleArmed.value) {
    event.preventDefault()
    return
  }
  draggingIndex.value = index
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move' }
}

function handleDragOver(index: number, event: DragEvent): void {
  if (draggingIndex.value === null) { return }
  event.preventDefault()
  if (draggingIndex.value === index) { return }
  const list = orderedManufacturers.value
  const [moved] = list.splice(draggingIndex.value, 1)
  list.splice(index, 0, moved)
  draggingIndex.value = index
}

function handleDragEnd(): void {
  const didReorder = draggingIndex.value !== null
  isHandleArmed.value = false
  draggingIndex.value = null
  if (!didReorder) { return }
  emit('reorder', orderedManufacturers.value.map((manufacturer) => ({
    id: manufacturer.id,
    currentSort: manufacturer.sortOrder ?? null,
  })))
}


const {
  displayItems,
  showSearch: showListSearch,
  contentRef: listContentRef,
} = useDrawerListSearch(statusFilteredItems, {
  search: listSearch,
  enabled: () => !isDetailView.value,
  watch: () => [props.skeletonCount, props.loading, isDetailView.value, localVisible.value],
})

const listEmptyMessage = computed(() =>
  listSearch.value.trim()
    ? `No ${listTitle.value.toLowerCase()} match "${listSearch.value.trim()}".`
    : emptyText.value,
)
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="title"
    :dirty="isDirty"
    :header-transition="slideTransitionName"
    :header-key="isDetailView ? 'detail' : 'list'"
    @save="handleGuardedSave"
  >
    <template
      v-if="isDetailView && !openedDirectToDetail"
      #title
    >
      <Button
        text
        class="assoc-drawer__back"
        @click="backToList"
      >
        <i class="pi pi-arrow-left" />
        <span>Back to {{ title }}</span>
      </Button>
    </template>

    <template #header>
      <Transition
        :name="isSwapping ? slideTransitionName : ''"
        @after-enter="isSwapping = false"
        @after-leave="isSwapping = false"
      >
        <div
          v-if="showListSearch || (showStatusFilter && !isDetailView)"
          class="assoc-drawer__filter"
        >
          <div class="assoc-drawer__search">
              <BaseDrawerSearch
                v-model="listSearch"
                :placeholder="`Search ${listTitle}`"
              />
            </div>
            <BaseFilterToolbar
              v-if="showStatusFilter && !isDetailView"
              inline
              :filter-count="selectedStatuses.length"
              :aria-label="`Filter ${listTitle.toLowerCase()} by status`"
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
                      :input-id="`assoc-filter-status-${option.value}`"
                      :value="option.value"
                    />
                    <label :for="`assoc-filter-status-${option.value}`">
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
      </Transition>
    </template>

    <!-- The list and the detail/edit panes swap with a horizontal push:
         View Details slides right→left, Back slides left→right. -->
    <div
      ref="viewsRef"
      class="assoc-drawer__views"
    >
      <Transition :name="slideTransitionName">
        <div
          v-if="selectedDetail"
          class="assoc-drawer__detail"
        >
          <div class="assoc-drawer__intro">
            <div class="assoc-drawer__logo">
              <img
                v-if="detailLogoSrc"
                :ref="handleLogoMount"
                :src="detailLogoSrc"
                :srcset="detailLogoSrcset ?? undefined"
                sizes="120px"
                alt=""
                class="avatar-logo-image"
                :class="{ 'avatar-logo-image--measuring': !isLogoMeasured }"
                :style="{ '--logo-fit': logoFit }"
                @load="handleLogoLoad"
                @error="handleDetailLogoError"
              >
              <BasePlaceholderIcon
                v-else
                :category="placeholderCategory"
                class="placeholder-avatar__icon"
              />
              <div
                v-if="isLogoLoading"
                class="assoc-drawer__logo-loader"
              >
                <BaseSpinner size="md" />
              </div>
            </div>

            <div class="assoc-drawer__detail-name">
              <span>{{ selectedDetail.name }}</span>
              <NuxtLink
                v-if="selectedDetail.website"
                :to="selectedDetail.website"
                external
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`Visit ${selectedDetail.name} website`"
                class="assoc-drawer__website"
              >
                <i class="pi pi-globe" />
              </NuxtLink>
              <span
                v-else
                v-tooltip.top="'No website added'"
                class="assoc-drawer__website assoc-drawer__website--muted"
                role="img"
                aria-label="No website added"
              >
                <i class="pi pi-globe" aria-hidden="true" />
              </span>
            </div>
          </div>

          <!-- Manufacturers: editable status + remarks, plus detail-page link. -->
          <template v-if="isManufacturers">
            <!-- Status | Inactive Notes — two columns, matching the comp. Space
                 is reserved while active so the fields below never shift. -->
            <div class="form-row">
              <div class="assoc-drawer__field">
                <span class="assoc-drawer__field-label">Status</span>
                <div class="assoc-drawer__status-options">
                  <div class="assoc-drawer__status-option">
                    <RadioButton
                      v-model="statusValue"
                      input-id="assoc-status-active"
                      value="active"
                      :disabled="!canEditStatus"
                    />
                    <label for="assoc-status-active">Active</label>
                  </div>
                  <div class="assoc-drawer__status-option">
                    <RadioButton
                      v-model="statusValue"
                      input-id="assoc-status-inactive"
                      value="inactive"
                      :disabled="!canEditStatus"
                    />
                    <label for="assoc-status-inactive">Inactive</label>
                  </div>
                </div>
              </div>
              <div
                class="form-field assoc-drawer__inactive-note"
                :class="{ 'form-field--reserved': statusValue !== 'inactive' }"
                :aria-hidden="statusValue !== 'inactive'"
              >
                <div class="form-field__label-row">
                  <label
                    class="form-field__label form-field__label--required"
                  >Inactive Notes</label>
                  <BaseCharCounter
                    :value="inactiveNoteValue"
                    :max="limitFor('inactive_note')"
                  />
                </div>
                <InputText
                  v-model="inactiveNoteValue"
                  v-trim
                  placeholder="Enter the reason why it's inactive"
                  fluid
                  :tabindex="statusValue === 'inactive' ? undefined : -1"
                  :invalid="submitted && !!inactiveNoteError"
                  :disabled="!canEditInactiveNote"
                />
                <BaseSuggestionChips
                  :suggestions="presetsFor('inactive_note')"
                  :selected="[inactiveNoteValue]"
                  :disabled="!canEditInactiveNote"
                  @select="inactiveNoteValue = $event"
                />
                <span
                  v-if="submitted && inactiveNoteError"
                  class="form-field__error"
                >{{ inactiveNoteError }}</span>
              </div>
            </div>

            <div class="assoc-drawer__analysis">
              <div class="assoc-drawer__remarks-head">
                <span class="assoc-drawer__remarks-title">Remarks</span>
                <span class="assoc-drawer__remarks-rule" />
                <span class="assoc-drawer__remarks-counter">{{ remarksLength }}/{{ REMARKS_MAX }}</span>
              </div>
              <Textarea
                v-model="remarksValue"
                v-trim
                :maxlength="REMARKS_MAX"
                placeholder="Add your remarks here"
                :rows="6"
                fluid
                :disabled="!canEditRemarks"
              />
            </div>
          </template>

          <!-- Competitors: read-only remarks. -->
          <div
            v-else
            class="assoc-drawer__analysis"
          >
            <h3 class="assoc-drawer__analysis-title">
              Remarks
            </h3>
            <p
              :class="['assoc-drawer__analysis-text', { 'assoc-drawer__analysis-text--muted': !(selectedDetail as ManufacturerCompetitor).remarks }]"
            >
              {{ (selectedDetail as ManufacturerCompetitor).remarks || 'No analysis available.' }}
            </p>
          </div>
        </div>

        <!-- Supplier detail / edit view -->
        <div
          v-else-if="!isCompetitors && selectedSupplier"
          class="assoc-drawer__detail assoc-drawer__detail--supplier"
        >
          <div class="assoc-drawer__intro">
            <div class="assoc-drawer__logo">
              <img
                v-if="detailLogoSrc"
                :ref="handleLogoMount"
                :src="detailLogoSrc"
                :srcset="detailLogoSrcset ?? undefined"
                sizes="120px"
                alt=""
                class="avatar-logo-image"
                :class="{ 'avatar-logo-image--measuring': !isLogoMeasured }"
                :style="{ '--logo-fit': logoFit }"
                @load="handleLogoLoad"
                @error="handleDetailLogoError"
              >
              <BasePlaceholderIcon
                v-else
                :category="placeholderCategory"
                class="placeholder-avatar__icon"
              />
              <div
                v-if="isLogoLoading"
                class="assoc-drawer__logo-loader"
              >
                <BaseSpinner size="md" />
              </div>
            </div>

            <div class="assoc-drawer__detail-name">
              <span>{{ selectedSupplier.name }}</span>
              <NuxtLink
                v-if="selectedSupplier.website"
                :to="selectedSupplier.website"
                external
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="`Visit ${selectedSupplier.name} website`"
                class="assoc-drawer__website"
              >
                <i class="pi pi-globe" />
              </NuxtLink>
              <span
                v-else
                v-tooltip.top="'No website added'"
                class="assoc-drawer__website assoc-drawer__website--muted"
                role="img"
                aria-label="No website added"
              >
                <i class="pi pi-globe" aria-hidden="true" />
              </span>
            </div>
          </div>

          <!-- Status | Inactive Notes — two columns, matching the comp. Status is
               editable per CONNECT-556; space is reserved while active so the
               Remarks block below never shifts. -->
          <div class="form-row assoc-drawer__status-row">
            <div class="assoc-drawer__field">
              <h3 class="assoc-drawer__field-label">
                Status
              </h3>
              <div class="assoc-drawer__radios">
                <div class="assoc-drawer__radio">
                  <RadioButton
                    v-model="editStatus"
                    input-id="supplier-status-active"
                    value="active"
                    :disabled="!canEditStatus"
                  />
                  <label for="supplier-status-active">Active</label>
                </div>
                <div class="assoc-drawer__radio">
                  <RadioButton
                    v-model="editStatus"
                    input-id="supplier-status-inactive"
                    value="inactive"
                    :disabled="!canEditStatus"
                  />
                  <label for="supplier-status-inactive">Inactive</label>
                </div>
              </div>
            </div>
            <div
              class="form-field assoc-drawer__inactive-note"
              :class="{ 'form-field--reserved': editStatus !== 'inactive' }"
              :aria-hidden="editStatus !== 'inactive'"
            >
              <div class="form-field__label-row">
                <label
                  class="form-field__label form-field__label--required"
                >Inactive Notes</label>
                <BaseCharCounter
                  :value="editInactiveNote"
                  :max="limitFor('inactive_note')"
                />
              </div>
              <InputText
                v-model="editInactiveNote"
                v-trim
                placeholder="Enter the reason why it's inactive"
                fluid
                :tabindex="editStatus === 'inactive' ? undefined : -1"
                :invalid="submitted && !!inactiveNoteError"
                :disabled="!canEditInactiveNote"
              />
              <BaseSuggestionChips
                :suggestions="presetsFor('inactive_note')"
                :selected="[editInactiveNote]"
                :disabled="!canEditInactiveNote"
                @select="editInactiveNote = $event"
              />
              <span
                v-if="submitted && inactiveNoteError"
                class="form-field__error"
              >{{ inactiveNoteError }}</span>
            </div>
          </div>

          <!-- Remarks (editable, soft 1000-char limit) -->
          <div class="assoc-drawer__field assoc-drawer__field--remarks">
            <h3 class="assoc-drawer__remarks-head">
              <span class="assoc-drawer__remarks-label">Remarks</span>
              <span class="assoc-drawer__remarks-rule" />
              <span
                :class="['assoc-drawer__counter', { 'assoc-drawer__counter--over': editRemarks.length > REMARKS_SOFT_LIMIT }]"
              >{{ editRemarks.length }}/{{ REMARKS_SOFT_LIMIT }}</span>
            </h3>
            <Textarea
              v-model="editRemarks"
              class="assoc-drawer__remarks-input"
              auto-resize
              rows="6"
              :disabled="!canEditRemarks"
            />
          </div>
        </div>

        <!-- List view -->
        <div
          v-else
          ref="listContentRef"
          :class="['assoc-drawer__content', { 'assoc-drawer__content--competitors': isCompetitors || isManufacturers }]"
        >
          <template v-if="loading">
            <div
              v-for="row in skeletonRows"
              :key="`skeleton-${row}`"
              class="assoc-drawer__card assoc-drawer__card--skeleton"
            >
              <span class="skeleton-block assoc-drawer__skeleton-icon" />
              <div class="assoc-drawer__skeleton-lines">
                <span class="skeleton-block assoc-drawer__skeleton-line assoc-drawer__skeleton-line--lead" />
              </div>
              <!-- Stands in for the View Details button. -->
              <span class="skeleton-block assoc-drawer__skeleton-button" />
            </div>
          </template>

          <template v-else>
            <div
              v-for="(item, index) in displayItems"
              :key="item.id"
              class="assoc-drawer__card"
              :class="{ 'assoc-drawer__card--dragging': draggingIndex === index }"
              :draggable="isManufacturers"
              @dragstart="handleDragStart(index, $event)"
              @dragover="handleDragOver(index, $event)"
              @dragend="handleDragEnd"
              @drop.prevent="handleDragEnd"
            >
              <div class="assoc-drawer__lead">
                <i
                  class="pi pi-equals assoc-drawer__handle"
                  :class="{ 'assoc-drawer__handle--grab': canReorder }"
                  aria-hidden="true"
                  @mousedown="armHandle"
                />
                <NuxtLink
                  v-if="item.website"
                  :to="item.website"
                  external
                  target="_blank"
                  rel="noopener noreferrer"
                  :aria-label="`Visit ${item.name} website`"
                  class="assoc-drawer__globe"
                  @click.stop
                >
                  <i class="pi pi-globe" />
                </NuxtLink>
                <i
                  v-else
                  v-tooltip.top="'No website added'"
                  class="pi pi-globe assoc-drawer__globe assoc-drawer__globe--muted"
                  role="img"
                  aria-label="No website added"
                />
              </div>

              <!-- Both modes: name + View Details. Suppliers also show a status
                   tag (competitors have no status). -->
              <span class="assoc-drawer__name assoc-drawer__name--grow">{{ item.name }}</span>
              <StatusTag
                v-if="!isCompetitors"
                :status="(item as ManufacturerSupplier).status ?? 'active'"
                :inactive-note="(item as ManufacturerSupplier).inactiveNote"
              />
              <Button
                outlined
                size="small"
                class="assoc-drawer__view-btn"
                @click="viewDetails(item)"
              >
                <span>View Details</span>
                <i class="pi pi-arrow-right" />
              </Button>
            </div>

            <p
              v-if="!displayItems.length"
              class="assoc-drawer__empty"
            >
              {{ listEmptyMessage }}
            </p>
          </template>
        </div>
      </Transition>
    </div>

    <!-- Edit footer (suppliers or manufacturers): Save / Cancel on the left, a
         jump to the full detail page on the right. Competitors are read-only, so
         they have no footer. -->
    <template
      v-if="(!isCompetitors && selectedSupplier) || (isManufacturers && selectedDetail)"
      #footer
    >
      <div class="assoc-drawer__footer">
        <BaseActionButtons
          @save="handleFooterSave"
          @cancel="backToList"
        />
        <!-- Jump to the full detail page — shown for a manufacturer, or a
             supplier reached via the list's "View Details". Hidden in the
             pencil-opened Edit Supplier view (openedDirectToDetail) on the
             manufacturer detail page. -->
        <Button
          v-if="isManufacturers || !openedDirectToDetail"
          outlined
          class="assoc-drawer__detail-link"
          @click="goToDetailPage"
        >
          <span>{{ isManufacturers ? 'Manufacturer Details' : 'Supplier Details' }}</span>
          <i class="pi pi-arrow-right" />
        </Button>
      </div>
    </template>
  </BaseDrawer>
</template>

<style scoped>
/* Positioning context for the list ⇄ detail push — the leaving pane is
   absolutely positioned by the shared drawer-slide-* classes (drawer.css). */
.assoc-drawer__views {
    position: relative;
    display: flex;
    flex: 1;
    flex-direction: column;
}

.assoc-drawer__detail,
.assoc-drawer__content {
    background: var(--p-surface-0);
}
.assoc-drawer__detail.drawer-slide-forward-enter-active,
.assoc-drawer__detail.drawer-slide-back-enter-active,
.assoc-drawer__content.drawer-slide-forward-enter-active,
.assoc-drawer__content.drawer-slide-back-enter-active {
    position: relative;
    z-index: 1;
}
.assoc-drawer__detail.drawer-slide-forward-leave-active,
.assoc-drawer__detail.drawer-slide-back-leave-active,
.assoc-drawer__content.drawer-slide-forward-leave-active,
.assoc-drawer__content.drawer-slide-back-leave-active {
    z-index: 0;
    opacity: 0;
}
.assoc-drawer__filter.drawer-slide-forward-leave-active,
.assoc-drawer__filter.drawer-slide-back-leave-active {
    opacity: 0;
}

.assoc-drawer__filter {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

/* Search field + its trailing icon: the icon anchors to this wrapper so the
   adjacent filter button stays outside the input. */
.assoc-drawer__search {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
}

/* Align the filter button height to the search field and pin its icon-only width
   so the two controls read as a matched pair (same spec as the contacts drawer's
   filter button; the border/radius/fill come from BaseFilterToolbar's inline
   variant). */
.assoc-drawer__filter :deep(.filter-toolbar__filter-btn.p-button) {
    width: var(--p-spacing-9);
    height: calc(var(--p-spacing-8) + var(--p-spacing-px));
    padding-top: var(--p-spacing-1-75);
    padding-bottom: var(--p-spacing-1-75);
    background: var(--p-surface-0);
    border-color: var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);
}

.assoc-drawer__content {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    padding: var(--p-spacing-2-5) 0 0;

    @media (min-width: 768px) {
        padding: var(--p-spacing-2-5) 0 var(--p-spacing-4);
    }
}

.assoc-drawer__card {
    display: flex;
    flex-direction: row;
    align-items: center;
    align-self: stretch;
    gap: var(--p-spacing-4);
    min-height: calc(var(--p-spacing-px) * 92);
    padding: var(--p-spacing-4-375);
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
}
.assoc-drawer__content--competitors .assoc-drawer__card {
    min-height: calc(var(--p-spacing-px) * 74);
}

/* Skeleton mirrors the real card (lead icon + two text lines) so its height and
   shape match the loaded cards instead of a single flat bar. */
.assoc-drawer__skeleton-icon {
    flex-shrink: 0;
    width: var(--p-spacing-6);
    height: var(--p-spacing-6);
    border-radius: var(--p-border-radius-xs);
}

.assoc-drawer__skeleton-lines {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}

.assoc-drawer__skeleton-line {
    width: 70%;
    height: var(--p-font-size-sm);
    border-radius: var(--p-border-radius-xs);
}

.assoc-drawer__skeleton-line--lead {
    width: 45%;
    height: var(--p-font-size-lg);
}

.assoc-drawer__skeleton-button {
    flex-shrink: 0;
    width: calc(var(--p-spacing-px) * 110);
    height: calc(var(--p-font-size-sm) + var(--p-button-sm-padding-y) * 2 + var(--p-spacing-px) * 2);
    border-radius: var(--p-border-radius-xs);
}

/* Stagger each card so the undertow pulse rolls as a wave, matching the list
   page's skeleton rows. */
.assoc-drawer__card--skeleton:nth-child(1) .skeleton-block {
    animation-delay: calc(-0.98s + var(--p-undertow-stagger) * 0);
}
.assoc-drawer__card--skeleton:nth-child(2) .skeleton-block {
    animation-delay: calc(-0.98s + var(--p-undertow-stagger) * 1);
}
.assoc-drawer__card--skeleton:nth-child(3) .skeleton-block {
    animation-delay: calc(-0.98s + var(--p-undertow-stagger) * 2);
}
.assoc-drawer__card--skeleton:nth-child(4) .skeleton-block {
    animation-delay: calc(-0.98s + var(--p-undertow-stagger) * 3);
}
.assoc-drawer__card--skeleton:nth-child(5) .skeleton-block {
    animation-delay: calc(-0.98s + var(--p-undertow-stagger) * 4);
}
.assoc-drawer__card--skeleton:nth-child(6) .skeleton-block {
    animation-delay: calc(-0.98s + var(--p-undertow-stagger) * 5);
}
.assoc-drawer__card--skeleton:nth-child(7) .skeleton-block {
    animation-delay: calc(-0.98s + var(--p-undertow-stagger) * 6);
}
.assoc-drawer__card--skeleton:nth-child(8) .skeleton-block {
    animation-delay: calc(-0.98s + var(--p-undertow-stagger) * 7);
}

.assoc-drawer__lead {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-4);
}

.assoc-drawer__handle {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

/* Grab cursor only when the list is actually reorderable (manufacturers mode). */
.assoc-drawer__handle--grab {
    cursor: grab;
}

.assoc-drawer__handle--grab:active {
    cursor: grabbing;
}

.assoc-drawer__card--dragging {
    opacity: var(--p-disabled-opacity);
    border-color: var(--p-skyblue-300);
}

.assoc-drawer__globe {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-6);
    height: var(--p-spacing-6);
    margin: calc((var(--p-font-size-sm) - var(--p-spacing-6)) / 2);
    font-size: var(--p-font-size-sm);
    color: var(--p-skyblue-600);
    text-decoration: none;
    border-radius: var(--p-border-radius-xs);
    cursor: pointer;
    text-decoration: none;
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.assoc-drawer__globe:hover {
    background: var(--p-tideblue-50);
}

.assoc-drawer__globe .pi {
    font-size: var(--p-font-size-sm);
}

/* No website — a plain, non-interactive placeholder so the lead row stays
   aligned with the linked rows. */
.assoc-drawer__globe--muted {
    color: var(--p-surface-300);
    cursor: default;
}

.assoc-drawer__globe--muted:hover {
    background: transparent;
}

.assoc-drawer__name {
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);

    @media (min-width: 768px) {
        font-size: var(--p-font-size-base);
    }
}

.assoc-drawer__name--grow {
    flex: 1;
    min-width: 0;
}

.assoc-drawer__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: max(calc(100dvh - 180px), 200px);
    margin: 0;
    font-size: var(--p-font-size-sm);
    color: var(--p-text-muted-color);
    text-align: center;
}

/* "View Details" button: white fill, #82D4EE outline, brand-blue label +
   trailing arrow. Uses the same size/padding as the section's Add button so its
   height matches the search / filter / Add buttons exactly. */
.assoc-drawer__view-btn.p-button {
    flex-shrink: 0;
    gap: var(--p-spacing-1-75);
    padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    border: 1px solid var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    font-weight: var(--p-font-weight-medium);
}

/* Keep the outline + label, swap only the fill to the app-wide hover wash
   (the explicit white background above otherwise suppresses PrimeVue's hover). */
.assoc-drawer__view-btn.p-button:hover {
    background: var(--p-tideblue-50);
    border-color: var(--p-skyblue-200);
    color: var(--p-skyblue-600);
}

/* 14×14 trailing arrow. */
.assoc-drawer__view-btn .pi {
    font-size: var(--p-font-size-sm);
}

/* Mobile: collapse to just the arrow so the button doesn't crowd the status tag
   + name; show the "View Details" label from tablet up. */
.assoc-drawer__view-btn span {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

/* ── Supplier edit footer ─────────────────────────────────────────────── */
.assoc-drawer__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-3);
    width: 100%;
}


.assoc-drawer__detail-link.p-button {
    flex-shrink: 0;
    gap: var(--p-spacing-1-75);
    border: 1px solid var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
    color: var(--p-skyblue-600);
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-medium);
}

.assoc-drawer__detail-link.p-button:hover {
    background: var(--p-tideblue-50);
    border-color: var(--p-skyblue-200);
    color: var(--p-skyblue-600);
}

.assoc-drawer__detail-link .pi {
    font-size: var(--p-font-size-base);
}

/* ── Detail (Analysis) view ───────────────────────────────────────────── */
.assoc-drawer__back.p-button {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
    padding: 0;
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);

    @media (min-width: 768px) {
        font-size: var(--p-font-size-xl);
    }
}

/* Match BaseBackButton: darken the text on hover, no background wash. */
.assoc-drawer__back.p-button:hover {
    background: transparent;
    color: var(--p-deepblue-700);
}

/* 14×14 back arrow. */
.assoc-drawer__back .pi {
    font-size: var(--p-font-size-sm);
}

/* Figma: 10px gap after the header, 32px between blocks (logo / name /
   analysis). Horizontal insets come from BaseDrawer's content padding. */
.assoc-drawer__detail {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    align-self: stretch;
    gap: var(--p-spacing-8);
    padding-top: var(--p-spacing-2-5);
}

.assoc-drawer__intro {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-4);
}

/* Heading + paragraph stay close together; the 32px gap is between blocks. */
.assoc-drawer__analysis {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
}

/* Supplier edit: Figma section spacing — intro→Status = 2xl(24), Status→Remarks
   = lg(20), Remarks heading→textarea = md(16). */
.assoc-drawer__detail--supplier {
    gap: 0;
}

.assoc-drawer__field {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}
.assoc-drawer__detail .form-row {
    align-self: stretch;
}

/* Spacing sits on the Status | Inactive Notes row so both columns share a top
   baseline (a margin on the Status cell alone would offset the two labels). */
.assoc-drawer__status-row {
    margin-top: var(--p-spacing-6);
}

.assoc-drawer__field--remarks {
    margin-top: var(--p-spacing-5);
    gap: var(--p-spacing-4);
}

.assoc-drawer__field-label,
.assoc-drawer__remarks-label {
    margin: 0;
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

.assoc-drawer__radios {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-5);
}

.assoc-drawer__radio {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.assoc-drawer__radio label {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
    cursor: pointer;
}

/* Remarks heading: label + flex rule + char counter on the right. */
.assoc-drawer__remarks-head {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
    margin: 0;
}

.assoc-drawer__remarks-rule {
    flex: 1;
    height: 1px;
    background: var(--p-surface-200);
}

.assoc-drawer__counter {
    flex-shrink: 0;
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
    font-weight: var(--p-font-weight-normal); ;
}

.assoc-drawer__counter--over {
    color: var(--p-red-500);
}

:deep(.assoc-drawer__remarks-input.p-textarea) {
    width: 100%;
    min-height: calc(var(--p-spacing-px) * 200);
    font-family: var(--p-font-family);
    font-size: var(--app-input-font-size);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-5);
    color: var(--p-gray-800);
    border-color: var(--p-surface-200);
    resize: none;
}

/* 150×150 circle, 4px surface-100 ring, white fill — the same avatar the
   manufacturer detail page shows. */
.assoc-drawer__logo {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: calc(var(--p-spacing-px) * 150);
    height: calc(var(--p-spacing-px) * 150);
    aspect-ratio: 1 / 1;
    /* 16px padding around the logo (John/Grace) so trimmed SVGs and raster logos
       that carry their own padding all sit off the rounded border and read
       consistently instead of some looking clipped. */
    box-sizing: border-box;
    padding: var(--p-spacing-4);
    border: var(--p-spacing-1) solid var(--p-surface-100);
    border-radius: var(--p-border-radius-full);
    background: var(--p-surface-0);
    overflow: hidden;
    flex-shrink: 0;
}

/* The logo is held back until it decodes (see useLogoFit), so a slow one leaves
   the ring empty — this fills it with the spinner instead. No backdrop: the
   image underneath is `visibility: hidden` for exactly as long as this shows. */
.assoc-drawer__logo-loader {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
}

.assoc-drawer__detail-name {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

/* 24×24 hit/hover area (matches the card globe / icon buttons). Negative margin
   = −(24−16)/2 keeps the name↔globe gap unchanged. */
.assoc-drawer__website {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-6);
    height: var(--p-spacing-6);
    margin: calc((var(--p-font-size-base) - var(--p-spacing-6)) / 2);
    font-size: var(--p-font-size-base);
    color: var(--p-skyblue-600);
    text-decoration: none;
    border-radius: var(--p-border-radius-xs);
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.assoc-drawer__website:hover {
    background: var(--p-tideblue-50);
}

.assoc-drawer__website .pi {
    font-size: var(--p-font-size-sm);
}

/* No website — grayed, non-interactive placeholder so the name row stays
   aligned instead of leaving a blank gap. */
.assoc-drawer__website--muted {
    color: var(--p-surface-300);
    cursor: default;
}

.assoc-drawer__website--muted:hover {
    background: transparent;
}

/* Heading with a rule that runs to the right of the word (matches the
   release-notes "What's new" header style). */
.assoc-drawer__analysis-title {
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
    margin: 0;
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

.assoc-drawer__analysis-title::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--p-surface-200);
}

/* Figma body-md/regular: TT Norms Pro 14px/20px, weight 450, gray-800. */
.assoc-drawer__analysis-text {
    align-self: flex-start;
    margin: 0;
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-5);
    color: var(--p-gray-800);
    font-feature-settings: 'liga' off, 'clig' off;
}

.assoc-drawer__analysis-text--muted {
    color: var(--p-text-muted-color);
}

/* ── Manufacturers detail: status + editable remarks + actions ──────────── */
.assoc-drawer__field {
    align-self: stretch;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}

.assoc-drawer__field-label {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-deepblue-900);
}

/* Inactive Notes sits beside Status, whose label carries an 8px gap before the
   radios. Lifting the notes cell by that same step brings its input up level
   with the radio row instead of hanging below it. Only side-by-side widths —
   below 768px the row stacks and the two are no longer neighbours. */
.assoc-drawer__inactive-note {
    @media (min-width: 768px) {
        margin-top: calc(-1 * var(--p-spacing-1));
    }
}

.assoc-drawer__status-options {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-6);
}

.assoc-drawer__status-option {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

/* "Remarks ———— N/1000": heading, a rule filling the gap, then the counter —
   the editable counterpart to the read-only analysis-title rule. */
.assoc-drawer__remarks-head {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

.assoc-drawer__remarks-title {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

.assoc-drawer__remarks-rule {
    flex: 1;
    height: 1px;
    background: var(--p-surface-200);
}

.assoc-drawer__remarks-counter {
    font-size: var(--p-font-size-xs);
    color: var(--p-text-muted-color);
}

/* Drawer footer: Save / Cancel on the left, "Manufacturer Details →" on the
   right. Lives in BaseDrawer's #footer slot so it shares the standard drawer
   header/footer chrome. */
.assoc-drawer__footer-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-3);
}
</style>
