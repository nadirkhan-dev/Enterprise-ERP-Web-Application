<script setup lang="ts">
import type { PhoneRow } from '~/composables/useContactForm'

interface Props {
  phone: PhoneRow
  formattedNumber: string
  variant?: 'list' | 'summary'
  actionsDisabled?: boolean
  editingClass?: boolean
  isMobile?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'list',
  actionsDisabled: false,
  editingClass: false,
  isMobile: false,
})

defineEmits<{
  edit: [phone: PhoneRow]
  remove: [phone: PhoneRow]
}>()

const isList = computed(() => props.variant === 'list')
</script>

<template>
  <div
    class="phone-card"
    :class="{ 'phone-card--editing': editingClass }"
  >
    <div class="phone-card__header">
      <div class="phone-card__type">
        <div class="phone-card__lead">
          <i
            class="pi pi-equals phone-card__sort-handle"
            :class="{ 'phone-card__sort-handle--mobile': !isList }"
          />
          <i
            v-if="phone.isDefault && (isList || !isMobile)"
            class="pi pi-star-fill phone-card__star-fill"
          />
        </div>
        <span class="phone-card__name">{{ phone.type }}</span>
        <i
          v-if="phone.isDefault && !isList && isMobile"
          class="pi pi-star-fill phone-card__star-fill"
        />
      </div>
      <div
        class="phone-card__actions"
        :class="{ 'phone-card__actions--disabled': actionsDisabled }"
      >
        <BaseIconButton
          icon="pi pi-pencil"
          label="Edit phone"
          class="phone-card__edit"
          :disabled="actionsDisabled"
          @click="$emit('edit', phone)"
        />
        <i
          v-if="!isList"
          class="pi pi-equals phone-card__sort-handle phone-card__sort-handle--desktop"
        />
        <!-- TEMPORARY: remove is commented out until the deletion workflow
             (permissions, confirmation, UX) is finalised. The @remove handler is
             intact — uncomment to restore. Edit + the drag handle remain.
        <BaseIconButton
          icon="pi pi-trash"
          label="Remove phone"
          destructive
          :disabled="actionsDisabled"
          @click="$emit('remove', phone)"
        />
        -->
      </div>
    </div>
    <div class="phone-card__body">
      <div class="phone-card__detail">
        <span class="phone-card__label">Phone Number</span>
        <span class="phone-card__value">
          <i class="pi pi-phone" />
          {{ formattedNumber || phone.number }}
        </span>
      </div>
      <div class="phone-card__detail">
        <span class="phone-card__label">SMS Capable</span>
        <Tag
          :value="phone.smsCapable ? 'Yes' : 'No'"
          severity="secondary"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.phone-card {
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    overflow: hidden;
    transition: border-color var(--p-transition-duration-fast);
    margin-bottom: var(--p-spacing-3);
    background: var(--p-inputtext-disabled-background, var(--p-form-field-disabled-background));
}

.phone-card--editing {
    background: var(--p-surface-0);
}

.phone-card__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--p-spacing-3) var(--p-spacing-3) 0 var(--p-spacing-4);

    @media (min-width: 768px) {
        padding: var(--p-spacing-3) var(--p-spacing-4) 0;
    }
}

/* Two different gaps via nested flex, both pure `gap` (no margins):
   outer row spaces lead-group → name (8px); inner lead spaces handle → star (16px). */
.phone-card__type {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2); /* 8px — star → name */
}

.phone-card__lead {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-4); /* 16px — handle → star */
}

.phone-card__type .phone-card__sort-handle {
    margin-right: 0; /* cancel the base handle margin so the gap is exact */
}

.phone-card__type .pi {
    font-size: var(--p-font-size-base); /* 16px icons */
    line-height: 1;
    width: auto; /* no extra box width — tight to the glyph */
}

.phone-card__name {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-semibold);
    color: var(--p-deepblue-900);
    text-transform: capitalize;
    /* Optical nudge: the text glyph (TT Norms) sits ~1px higher than the
       PrimeIcons handle/star glyphs, so push it down to read as vertically
       centred against them. */
    position: relative;
    top: 2px;
}

.phone-card__actions {
    display: flex;
    align-items: center;
    gap: var(--p-datatable-header-cell-gap);
}

.phone-card__actions .pi-equals {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

/* Edit pencil sits in gray rather than the default primary blue. */
.phone-card__actions :deep(.phone-card__edit:not(.base-icon-button--disabled)) {
    color: var(--p-gray-800);
}

.phone-card__sort-handle {
    cursor: grab;
    margin-right: var(--p-spacing-2);
    color: var(--p-gray-800);
}

.phone-card__sort-handle:active {
    cursor: grabbing;
}

:deep(.phone-card__body .p-tag-secondary) {
    background: var(--tag-contrast-background, #000);
    color: var(--p-surface-0);
    opacity: 0.4;
}

/* Yes / No tag box spec. */
:deep(.phone-card__body .p-tag) {
    display: flex;
    min-height: var(--p-spacing-5-5); /* 22px */
    padding: 3.5px var(--p-spacing-1-75); /* 3.5px / 7px */
    justify-content: center;
    align-items: center;
    gap: var(--tag-gap, 3.5px);
}

.phone-card__actions--disabled {
    opacity: 0.4;
    pointer-events: none;
}

.phone-card__star-fill {
    color: var(--p-yellow-500) !important;
}

.phone-card__sort-handle--desktop {
    display: none;

    @media (min-width: 768px) {
        display: block;
        margin-inline: calc(var(--p-spacing-1) * -2);
    }
}

.phone-card__sort-handle--mobile {
    @media (min-width: 768px) {
        display: none;
    }
}

.phone-card__body {
    display: flex;
    align-items: center;
    padding: var(--p-spacing-3) var(--p-spacing-2) var(--p-spacing-3) var(--p-spacing-4);
    gap: var(--p-spacing-3);
}

.phone-card__detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
}

.phone-card__label {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-gray-800);
    line-height: 1;
}

.phone-card__value {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-deepblue-900);
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
}

.phone-card__value .pi-phone {
    font-size: var(--p-font-size-sm);
    color: var(--p-deepblue-900);
}
</style>
