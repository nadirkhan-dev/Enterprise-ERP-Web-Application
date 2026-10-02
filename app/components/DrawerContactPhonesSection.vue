<script setup lang="ts">
import { VueDraggableNext } from 'vue-draggable-next'
import type { ContactErrors, ContactForm, PhoneRow } from '~/composables/useContactForm'

type CountryOption = {
  id: number
  name: string
  code: string
  phone_code?: string | null
}

type PhoneEditForm = {
  type: string
  country: number | null
  phoneNumber: string
  extension: string
  smsCapable: boolean
  isDefault: boolean
}

interface Props {
  form: ContactForm
  errors: ContactErrors
  submitted: boolean
  // Homeowner customers: disable Extension and the non-general/mobile phone types.
  isHomeowner?: boolean
  editingPhoneId: number | null
  phoneEditForm: PhoneEditForm
  countryOptions: CountryOption[]
  editingCountryCode: string | null
  editingCountryIso: string | null
  dragHandle: string
  isMobile: boolean
  formattedPhone: (phone: PhoneRow) => string
  showPhoneErrorBanner: boolean
  hideDefault?: boolean
  lockDefault?: boolean
  phoneTypesInUse?: string[]
  canAddPhone?: boolean
  canDeletePhone?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hideDefault: false,
  lockDefault: false,
  isHomeowner: false,
  phoneTypesInUse: () => [],
  canAddPhone: true,
  canDeletePhone: false,
})

const emit = defineEmits<{
  'edit-phone': [phone: PhoneRow]
  'remove-phone': [phone: PhoneRow]
  'add-phone': []
  'apply-phone-edit': []
  'cancel-phone-edit': []
  'update:phone-input': [value: { countriesId: number | null; number: string; extension?: string | null }]
  'update:phone-numbers': [value: PhoneRow[]]
}>()

function onDraggableUpdate(value: PhoneRow[]) {
  emit('update:phone-numbers', value)
}

// vue-draggable-next reads its attrs once in onMounted and never re-applies them
// to SortableJS. Anything reactive (handle, disabled) must be pushed through via
// sortableInstance.option(...) when it changes.
const draggable = ref<{ sortableInstance: { option(name: string, value: unknown): void } | null } | null>(null)

watch(
  () => props.dragHandle,
  (handle) => draggable.value?.sortableInstance?.option('handle', handle),
)

watch(
  () => props.form.phoneNumbers.length < 2,
  (disabled) => draggable.value?.sortableInstance?.option('disabled', disabled),
)

// Constrain phone-card dragging to the vertical axis. SortableJS (force-fallback
// mode) drags a cloned `.phone-card--fallback` element by rewriting its transform
// on every pointermove; each frame, before paint, we strip the horizontal shift.
let lockFrameId: number | null = null

function lockFallbackToVertical() {
  const fallback = document.querySelector<HTMLElement>('.phone-card--fallback')
  if (fallback) {
    const matrixMatch = getComputedStyle(fallback).transform.match(/^matrix\(([^)]+)\)$/)
    if (matrixMatch) {
      // matrix(a, b, c, d, translateX, translateY) — index 4 is the horizontal shift
      const parts = matrixMatch[1].split(',').map(part => part.trim())
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
  <div class="drawer-section">
    <div class="drawer-section__heading">
      <span class="drawer-section__title">Phone Numbers</span>
    </div>

    <div class="phone-list phone-list--editable">
      <VueDraggableNext
        v-if="form.phoneNumbers.length"
        ref="draggable"
        :model-value="form.phoneNumbers"
        :handle="dragHandle"
        :disabled="form.phoneNumbers.length < 2"
        ghost-class="phone-card--ghost"
        :force-fallback="true"
        fallback-class="phone-card--fallback"
        item-key="id"
        @update:model-value="onDraggableUpdate"
        @start="handleDragStart"
        @end="handleDragEnd"
      >
        <div
          v-for="(phone, phoneIndex) in form.phoneNumbers"
          :key="phone.id"
          class="phone-card-wrapper"
        >
          <Message
            v-if="editingPhoneId === phone.id && showPhoneErrorBanner"
            severity="error"
            icon="pi pi-exclamation-circle"
            :closable="false"
            class="phone-error-banner"
          >
            Phone number is required. Enter a valid phone number to continue.
          </Message>
          <div
            v-if="editingPhoneId === phone.id"
            class="phone-card"
          >
            <DrawerContactPhoneEdit
              :phone-id="phone.id"
              :phone-edit-form="phoneEditForm"
              :is-homeowner="isHomeowner"
              :phone-types-in-use="phoneTypesInUse"
              :country-options="countryOptions"
              :editing-country-code="editingCountryCode"
              :editing-country-iso="editingCountryIso"
              :submitted="submitted"
              :errors="{
                phoneCountry: errors.phoneCountry,
                phoneNumber: errors.phoneNumber,
                phoneExtension: errors.phoneExtension,
              }"
              :show-phone-error-banner="showPhoneErrorBanner"
              :hide-default="hideDefault"
              :lock-default="lockDefault"
              id-prefix="phoneType"
              @apply="$emit('apply-phone-edit')"
              @cancel="$emit('cancel-phone-edit')"
              @update:phone-input="$emit('update:phone-input', $event)"
            />
          </div>
          <DrawerContactPhoneCard
            v-else
            :phone="phone"
            :formatted-number="formattedPhone(phone)"
            :is-mobile="isMobile"
            :can-delete="canDeletePhone"
            variant="list"
            @edit="$emit('edit-phone', $event)"
            @remove="$emit('remove-phone', $event)"
          />
        </div>
      </VueDraggableNext>

      <div
        v-if="editingPhoneId === null"
        v-tooltip.top="canAddPhone ? '' : 'All phone types are already in use.'"
        class="phone-card phone-card--add"
        :class="{ 'phone-card--add--disabled': !canAddPhone }"
        @click="canAddPhone && $emit('add-phone')"
      >
        <Button
          icon="pi pi-plus"
          outlined
          rounded
          class="phone-card--add__button"
          :disabled="!canAddPhone"
        />
        <span class="phone-card--add__label">Add Phone Number</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.phone-list {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
}

.phone-card {
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    overflow: hidden;
    transition: border-color var(--p-transition-duration-fast);
    margin-bottom: var(--p-spacing-3);
    background: var(--p-surface-0);
}

.phone-card--ghost {
    opacity: 0 !important;
}

.phone-card--fallback {
    opacity: 1 !important;
    background-color: var(--p-surface-0);
    box-shadow: var(--p-shadow-drag);
}

.phone-card--add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-2);
    padding: var(--p-spacing-4);
    border-style: solid;
    cursor: pointer;
    background: var(--p-surface-0);
}

.phone-card--add:hover {
    background: var(--p-tideblue-50);
}

.phone-card--add--disabled {
    cursor: not-allowed;
    opacity: var(--p-disabled-opacity);
}

.phone-card--add--disabled:hover {
    background: var(--p-surface-0);
}

.phone-card--add__button {
    width: 35px;
    height: 35px;
}

.phone-card--add__label {
    color: var(--p-gray-800);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
}

.phone-list--editable :deep(.phone-card__body .p-tag-secondary) {
    opacity: 1;
}
</style>
