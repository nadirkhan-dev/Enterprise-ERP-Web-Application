<script setup lang="ts">
import type { InputNumberInputEvent } from 'primevue/inputnumber'
import type { PriceField } from '~/composables/useItemPriceCalculator'

interface Props {
  field: PriceField
  label: string
  value: string
  originalValue: string
  isPricingLoading: boolean
  isValid: boolean
  isEditing: boolean
  hasDollar?: boolean
  editDollarValue: number | null
  editPercentValue: number | null
  showOriginalWhenEditing: boolean
}

const props = withDefaults(defineProps<Props>(), {
  hasDollar: true,
})

const emit = defineEmits<{
  open: [field: PriceField]
  close: []
  'dollar-input-event': [event: InputNumberInputEvent]
  'dollar-input': [value: number | null]
  'percent-input-event': [event: InputNumberInputEvent]
  'percent-input': [value: number | null]
}>()

const dollarValue = computed({
  get: () => props.editDollarValue,
  set: (val) => emit('dollar-input', val),
})

// Grow the dollar field to fit long values so they aren't clipped (CONNECT-466);
// stays snug for short numbers. Width tracks the grouped character count (e.g.
// "4,184.46" → 8, "118,284.79" → 10), clamped to a sensible range.
const dollarInputWidth = computed(() => {
  const value = props.editDollarValue
  const characterCount = value === null
    ? 8
    : Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).length
  return `${Math.min(Math.max(characterCount + 1, 8), 14)}ch`
})

// Copy affordance (CONNECT-466): once a price differs from its page-load value
// (edited directly or recomputed), show a copy button next to it so the user can
// paste the plain decimal — no currency symbol or separators — into an SAP quote.
// Never on Gross Margin, which isn't entered directly in SAP.
const isChanged = computed(() =>
  props.value !== '—' && !!props.originalValue && props.value !== props.originalValue,
)
const canCopyValue = computed(() => props.field !== 'grossMargin' && isChanged.value)
const copyDecimal = computed(() => props.value.replace(/[$,]/g, ''))
const percentValue = computed({
  get: () => props.editPercentValue,
  set: (val) => emit('percent-input', val),
})

function toggleDropdown() {
  if (!props.isValid) return
  if (props.isEditing) {
    emit('close')
    return
  }
  emit('open', props.field)
}
</script>

<template>
  <div
    class="price-stat"
    :class="{ 'price-stat--dropdown-open': isEditing }"
  >
    <div class="price-stat__header">
      <span class="price-stat__label">{{ label }}</span>
      <span
        v-if="showOriginalWhenEditing || value !== originalValue"
        class="price-stat__original"
      >{{ originalValue }}</span>
    </div>
    <span
      v-if="isPricingLoading"
      class="skeleton-block skeleton-line skeleton-line--value"
    />
    <span
      v-else
      class="price-stat__value price-stat__value--calculator"
    >
      <BaseIconButton
        icon="pi pi-calculator"
        label="Open price calculator"
        class="price-stat__calc-icon"
        data-dropdown-toggle
        :disabled="!isValid"
        @click="toggleDropdown"
      />
      <BaseCopyText
        v-if="canCopyValue"
        :value="value"
        :copy-value="copyDecimal"
        icon-position="right"
        class="price-stat__copy"
      />
      <span
        v-else
        class="price-stat__value-text"
      >{{ value }}</span>
    </span>
    <Transition name="dropdown-expand">
      <div
        v-if="isEditing"
        class="price-stat__dropdown-inputs"
      >
        <div class="price-stat__dropdown-row">
          <InputGroup
            v-if="hasDollar"
            class="price-stat__dollar-group"
          >
            <InputGroupAddon><i class="pi pi-dollar price-stat__dollar-icon" /></InputGroupAddon>
            <InputNumber
              v-model="dollarValue"
              :min-fraction-digits="2"
              :max-fraction-digits="2"
              size="small"
              :input-style="{ width: dollarInputWidth }"
              @input="$emit('dollar-input-event', $event)"
              @update:model-value="$emit('dollar-input', $event)"
            />
          </InputGroup>
          <InputNumber
            v-model="percentValue"
            suffix="%"
            :min-fraction-digits="0"
            :max-fraction-digits="1"
            show-buttons
            increment-button-icon="pi pi-chevron-up"
            decrement-button-icon="pi pi-chevron-down"
            size="small"
            class="price-stat__percent-input"
            @input="$emit('percent-input-event', $event)"
            @update:model-value="$emit('percent-input', $event)"
          />
        </div>
      </div>
    </Transition>
  </div>
</template>
