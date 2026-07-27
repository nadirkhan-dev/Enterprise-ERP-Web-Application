<script setup lang="ts">
import { VueDraggableNext } from 'vue-draggable-next'

interface Props {
  visible?: boolean
  contacts?: Record<string, any>[]
  title?: string
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  contacts: () => [],
  title: 'Contact Information',
})
const emit = defineEmits<{
  'update:visible': [value: boolean]
  reorder: [contacts: Record<string, any>[]]
  'set-default': [payload: { type: 'sales' | 'billing'; junctionId: number | null }]
}>()

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const filterText = ref('')

// Status filter — mirrors the listing-page filter UX standard. Nothing is
// selected by default, so the drawer opens showing contacts of every status.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]
const DEFAULT_STATUSES: string[] = []
const selectedStatuses = ref<string[]>([...DEFAULT_STATUSES])

// Placeholder surfaces the total number of contacts being searched. Scope word
// is capitalized ("Contacts") to match the search convention used elsewhere.
const filterPlaceholder = computed(() => `Search ${props.contacts.length} Contacts`)

// Default Sales / Billing contact selects (Defaults section). Options are the
// same contacts shown in the list below.
const contactOptions = computed(() =>
  props.contacts.map((contact) => {
    const name = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
    return {
      id: contact.id,
      label: contact.job_title ? `${name}, ${contact.job_title}` : name,
    }
  }),
)
const salesContact = ref<number | string | null>(null)
const billingContact = ref<number | string | null>(null)

// Reflect the customer's current defaults in the selects (each contact carries
// isDefault* flags). This runs programmatically, so it never triggers a save —
// only the Select's @change (a user action) emits `set-default`.
function syncDefaultsFromContacts() {
  salesContact.value = props.contacts.find((contact) => contact.isDefaultSalesContact)?.id ?? null
  billingContact.value = props.contacts.find((contact) => contact.isDefaultBillingContact)?.id ?? null
}
syncDefaultsFromContacts()

watch(localVisible, (isOpen) => {
  if (isOpen) {
    syncDefaultsFromContacts()
  } else {
    filterText.value = ''
    selectedStatuses.value = [...DEFAULT_STATUSES]
  }
})

// The Select value is a contact *record* id; the default pointer needs the
// contact *junction* id. `set-default` carries that (or null to clear) and the
// parent persists it to the partner's default sales/billing contact pointer.
function junctionIdForContact(contactRecordId: number | string | null) {
  return props.contacts.find((contact) => contact.id === contactRecordId)?.junctionId ?? null
}

function handleSalesContactChange(event: { value: number | string | null }) {
  emit('set-default', { type: 'sales', junctionId: junctionIdForContact(event.value) })
}

function handleBillingContactChange(event: { value: number | string | null }) {
  emit('set-default', { type: 'billing', junctionId: junctionIdForContact(event.value) })
}

const orderedContacts = ref<Record<string, any>[]>([...props.contacts])
watch(
  () => props.contacts,
  (next) => {
    orderedContacts.value = [...next]
    syncDefaultsFromContacts()
  },
)

// Contacts without an explicit status are treated as active.
function isActiveStatus(contact: Record<string, any>) {
  return String(contact.status ?? 'active').toLowerCase() !== 'inactive'
}

function statusLabel(contact: Record<string, any>) {
  return isActiveStatus(contact) ? 'Active' : 'Inactive'
}

// An empty status selection means "no status filter" (show every status).
function matchesStatus(contact: Record<string, any>) {
  if (!selectedStatuses.value.length) {
    return true
  }
  const status = String(contact.status ?? 'active').toLowerCase()
  return selectedStatuses.value.includes(status)
}

function matchesText(contact: Record<string, any>) {
  const term = filterText.value.toLowerCase().trim()
  if (!term) {
    return true
  }
  const fullName = `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
  const searchableValues = [
    fullName,
    contact.job_title,
    contact.email_address,
    formatPhoneNumber(getPrimaryPhone(contact)),
  ]
  return searchableValues.some(
    (value) => value && String(value).toLowerCase().includes(term),
  )
}

function matchesFilter(contact: Record<string, any>) {
  return matchesStatus(contact) && matchesText(contact)
}

const visibleContacts = computed(() =>
  orderedContacts.value.filter((contact) => matchesFilter(contact)),
)
const hasVisibleContacts = computed(() => visibleContacts.value.length > 0)
const isReorderDisabled = computed(
  () => Boolean(filterText.value.trim()) || visibleContacts.value.length < 2,
)

function handleReorder(reordered: Record<string, any>[]) {
  orderedContacts.value = reordered
  emit('reorder', reordered)
}
const draggable = ref<{ sortableInstance: { option(name: string, value: unknown): void } | null } | null>(null)
watch(isReorderDisabled, (disabled) => {
  draggable.value?.sortableInstance?.option('disabled', disabled)
})

let lockFrameId: number | null = null

function lockFallbackToVertical() {
  const fallback = document.querySelector<HTMLElement>('.drawer-view-contact__card--fallback')
  if (fallback) {
    const matrixMatch = getComputedStyle(fallback).transform.match(/^matrix\(([^)]+)\)$/)
    if (matrixMatch) {
      const parts = matrixMatch[1].split(',').map((part) => part.trim())
      if (parts[4] !== '0') {
        parts[4] = '0'
        fallback.style.transform = `matrix(${parts.join(', ')})`
      }
    }
  }
  lockFrameId = requestAnimationFrame(lockFallbackToVertical)
}

function handleDragStart() {
  lockFrameId = requestAnimationFrame(lockFallbackToVertical)
}

function handleDragEnd() {
  if (lockFrameId !== null) {
    cancelAnimationFrame(lockFrameId)
    lockFrameId = null
  }
}

onBeforeUnmount(handleDragEnd)

</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="title"
    width="landing"
  >
    <template #header>
      <div class="drawer-view-contact__filter">
        <div class="drawer-view-contact__search">
          <BaseDrawerSearch
            v-model="filterText"
            :placeholder="filterPlaceholder"
          />
        </div>
        <BaseFilterToolbar
          inline
          :filter-count="selectedStatuses.length"
          aria-label="Filter contacts"
          @clear-all="selectedStatuses = []"
        >
          <BaseFilterSection
            title="Status"
            is-last
            :active-count="selectedStatuses.length"
            @clear="selectedStatuses = []"
          >
            <div class="filter-section__options-row">
              <div
                v-for="option in STATUS_OPTIONS"
                :key="option.value"
                class="filter-section__option"
              >
                <Checkbox
                  v-model="selectedStatuses"
                  :input-id="`contact-filter-status-${option.value}`"
                  :value="option.value"
                />
                <label :for="`contact-filter-status-${option.value}`">
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

      <!-- Defaults lives in the fixed header so it stays put while the contact
           cards below scroll. -->
      <div class="drawer-section drawer-view-contact__defaults">
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Defaults</span>
        </div>
        <div class="form-row">
          <div class="form-field">
            <label class="form-field__label">Sales Contact</label>
            <Select
              v-model="salesContact"
              :options="contactOptions"
              option-label="label"
              option-value="id"
              placeholder="Select Sales Contact"
              show-clear
              :filter="contactOptions.length > 10"
              panel-class="address-select-panel"
              fluid
              @change="handleSalesContactChange"
            />
          </div>
          <div class="form-field">
            <label class="form-field__label">Billing Contact</label>
            <Select
              v-model="billingContact"
              :options="contactOptions"
              option-label="label"
              option-value="id"
              placeholder="Select Billing Contact"
              show-clear
              :filter="contactOptions.length > 10"
              panel-class="address-select-panel"
              fluid
              @change="handleBillingContactChange"
            />
          </div>
        </div>
      </div>
    </template>

    <div class="drawer-view-contact__content">
      <VueDraggableNext
        ref="draggable"
        :model-value="orderedContacts"
        handle=".drawer-view-contact__handle"
        :disabled="isReorderDisabled"
        ghost-class="drawer-view-contact__card--ghost"
        :force-fallback="true"
        fallback-class="drawer-view-contact__card--fallback"
        item-key="id"
        class="drawer-view-contact__list"
        @update:model-value="handleReorder"
        @start="handleDragStart"
        @end="handleDragEnd"
      >
        <div
          v-for="contact in orderedContacts"
          v-show="matchesFilter(contact)"
          :key="contact.id"
          class="drawer-view-contact__card"
        >
          <div class="drawer-view-contact__lead">
            <i
              class="pi pi-equals drawer-view-contact__handle"
              aria-hidden="true"
            />
            <i
              v-if="contact.isDefaultSalesContact || contact.isDefaultBillingContact"
              v-tooltip.top="
                contact.isDefaultSalesContact && contact.isDefaultBillingContact
                  ? 'Default sales and billing contact'
                  : contact.isDefaultSalesContact
                    ? 'Default sales contact'
                    : 'Default billing contact'
              "
              class="pi pi-star-fill drawer-view-contact__default-star"
              aria-hidden="true"
            />
          </div>
          <div class="drawer-view-contact__caption">
            <span class="drawer-view-contact__name">
              {{ contact.first_name }} {{ contact.last_name }}
            </span>
            <span
              v-if="contact.job_title"
              class="drawer-view-contact__job"
            >
              {{ contact.job_title }}
            </span>
          </div>
          <div class="drawer-view-contact__details">
            <div
              v-if="formatPhoneNumber(getPrimaryPhone(contact))"
              class="drawer-view-contact__detail-row"
            >
              <i class="pi pi-phone" />
              <span>{{ formatPhoneNumber(getPrimaryPhone(contact)) }}</span>
            </div>
            <div
              v-if="contact.email_address"
              class="drawer-view-contact__detail-row"
            >
              <i class="pi pi-envelope" />
              <span class="drawer-view-contact__email-text">{{ contact.email_address }}</span>
            </div>
          </div>
          <Tag
            :value="statusLabel(contact)"
            :class="[
              'drawer-view-contact__status',
              isActiveStatus(contact) ? 'status-active' : 'status-inactive',
            ]"
          />
        </div>
      </VueDraggableNext>

      <p
        v-if="!hasVisibleContacts"
        class="drawer-view-contact__empty"
      >
        No contacts found.
      </p>
    </div>
  </BaseDrawer>
</template>

<style scoped>
.drawer-view-contact__content {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    /* 10px breathing room between the fixed header and the first contact card. */
    padding: var(--p-spacing-2-5) 0 0;

    @media (min-width: 768px) {
        padding: var(--p-spacing-2-5) 0 var(--p-spacing-4);
    }
}
.drawer-view-contact__defaults {
    gap: var(--p-spacing-4);
}
.drawer-view-contact__defaults .drawer-section__title {
    text-box-trim: trim-both;
    text-box-edge: cap alphabetic;
}
/* Trim only the label's TOP leading so the gap below the heading is clean while
   its bottom leading (label → input spacing) stays intact. */
.drawer-view-contact__defaults .form-field__label {
    text-box-trim: trim-start;
    text-box-edge: cap alphabetic;
}

.drawer-view-contact__list {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
}

.drawer-view-contact__card {
    display: flex;
    flex-direction: row;
    align-items: center;
    /* Figma sds-size-space-400 (16px) between the handle/star group and the name. */
    gap: var(--p-spacing-4);
    padding: var(--p-spacing-4-375);
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
}
.drawer-view-contact__card--ghost {
    opacity: 0 !important;
}

.drawer-view-contact__card--fallback {
    opacity: 1 !important;
    background: var(--p-surface-0);
    box-shadow: var(--p-shadow-drag);
}
.drawer-view-contact__lead {
    display: flex;
    align-items: center;
    /* Figma sds-size-space-400 (16px) between the drag handle and the star. */
    gap: var(--p-spacing-4);
}

.drawer-view-contact__handle {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
    cursor: grab;
}

.drawer-view-contact__handle:active {
    cursor: grabbing;
}

.drawer-view-contact__default-star {
    font-size: var(--p-font-size-sm);
    color: var(--p-yellow-500);
}

.drawer-view-contact__caption {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}

.drawer-view-contact__name {
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);

    @media (min-width: 768px) {
        font-size: var(--p-font-size-base);
    }
}

.drawer-view-contact__job {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

.drawer-view-contact__details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
    width: 100%;

    @media (min-width: 768px) {
        gap: var(--p-spacing-3);
        width: auto;
    }
}

.drawer-view-contact__detail-row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--p-spacing-1);
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

.drawer-view-contact__detail-row .pi {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-400);
}

/* Status pill pinned to the right edge of the card. */
.drawer-view-contact__status {
    flex-shrink: 0;
    align-self: center;
}

.drawer-view-contact__email-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
}

.drawer-view-contact__empty {
    font-size: var(--p-font-size-sm);
    color: var(--p-text-muted-color);
    text-align: center;
    padding: var(--p-spacing-6) 0;
}

.drawer-view-contact__filter {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

/* Search field + its trailing icon: the icon is anchored to this wrapper so the
   adjacent filter button stays outside the input. */
.drawer-view-contact__search {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
}

/* Filter button — Figma spec: ~35px wide, 33px tall, xs radius, skyblue-200
   outline, white fill. The border/radius/fill already come from BaseFilterToolbar's
   inline variant; here we align the height to the search field (7px padding-y) and
   pin the icon-only width so the two controls read as a matched pair. */
.drawer-view-contact__filter :deep(.filter-toolbar__filter-btn.p-button) {
    width: var(--p-spacing-9);
    height: calc(var(--p-spacing-8) + var(--p-spacing-px));
    padding-top: var(--p-spacing-1-75);
    padding-bottom: var(--p-spacing-1-75);
    background: var(--p-surface-0);
    border-color: var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);
}

/* Keep both selects equal width: let each grid column shrink below the selected
   contact's text (min-width: 0) instead of growing to fit it, and truncate the
   label so a long name shows an ellipsis rather than widening the input. */
.drawer-section .form-field {
    min-width: 0;
}

/* Sales / Billing contact selects: 7px / 10.5px padding to hit the Figma's 33px
   input height. Border-radius (xs), border, white background and the input shadow
   already come from the design-system input tokens. */
.drawer-section :deep(.p-select-label) {
    padding: var(--p-spacing-1-75) var(--p-spacing-2-625);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
