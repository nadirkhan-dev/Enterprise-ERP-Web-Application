<script setup lang="ts">
import type { InputNumberInputEvent } from 'primevue/inputnumber'
interface Props {
  // Input size passed through to the fields — the drawer opts into 'small'; the
  // Tools page leaves it default.
  size?: 'small' | 'large' | null
}

withDefaults(defineProps<Props>(), {
  size: null,
})

const DEFAULT_GROSS_MARGIN = 30
const baseCost = ref<number | null>(null)
const offerPrice = ref<number | null>(null)
const grossMargin = ref<number>(DEFAULT_GROSS_MARGIN)
const isPricingEstablished = ref(false)

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// Offer Price = Base Cost / (1 − margin). Undefined once margin hits 100%.
function recomputeOfferFromMargin() {
  if (baseCost.value === null) {
    offerPrice.value = null
    return
  }
  const marginFraction = grossMargin.value / 100
  offerPrice.value = marginFraction < 1 ? round2(baseCost.value / (1 - marginFraction)) : null
}

// Gross Margin = (Offer − Cost) / Offer, to one decimal.
function recomputeMarginFromPrices() {
  if (baseCost.value === null || !offerPrice.value) {
    return
  }
  grossMargin.value = Math.round(((offerPrice.value - baseCost.value) / offerPrice.value) * 1000) / 10
}
function toNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '')
    const parsed = Number(cleaned)
    return cleaned === '' || Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function handleBaseCostInput(event: InputNumberInputEvent) {
  baseCost.value = toNumber(event.value)
  if (isPricingEstablished.value) {
    recomputeMarginFromPrices()
  } else {
    recomputeOfferFromMargin()
  }
}

function handleBaseCostCommit() {
  if (baseCost.value !== null && offerPrice.value) {
    isPricingEstablished.value = true
  }
}

// Typing a price outright makes it the user's number, so later cost edits keep it.
function handleOfferPriceInput(event: InputNumberInputEvent) {
  offerPrice.value = toNumber(event.value)
  isPricingEstablished.value = true
  recomputeMarginFromPrices()
}
function handleGrossMarginInput(event: InputNumberInputEvent) {
  grossMargin.value = toNumber(event.value) ?? 0
  recomputeOfferFromMargin()
}
function toCopyDecimal(value: number | null): string {
  return (value ?? 0).toFixed(2)
}

const baseCostCopyValue = computed(() => toCopyDecimal(baseCost.value))
const offerPriceCopyValue = computed(() => toCopyDecimal(offerPrice.value))
const canCopyBaseCost = computed(() => (baseCost.value ?? 0) > 0)
const canCopyOfferPrice = computed(() => (offerPrice.value ?? 0) > 0)
function handleGrossMarginChange() {
  recomputeOfferFromMargin()
}
</script>

<template>
  <div class="sku-pricing">
    <div class="sku-pricing__field">
      <label
        for="sku-pricing-base-cost"
        class="sku-pricing__label"
      >
        <i
          class="pi pi-calculator"
          aria-hidden="true"
        />
        <span>Base Cost</span>
      </label>
      <InputGroup class="sku-pricing__group">
        <InputGroupAddon><i class="pi pi-dollar" /></InputGroupAddon>
        <InputNumber
          v-model="baseCost"
          input-id="sku-pricing-base-cost"
          :min="0"
          :min-fraction-digits="2"
          :max-fraction-digits="2"
          placeholder="0.00"
          :size="size"
          @input="handleBaseCostInput"
          @blur="handleBaseCostCommit"
        />
        <InputGroupAddon
          v-if="canCopyBaseCost"
          class="sku-pricing__copy"
        >
          <BaseCopyText
            icon-only
            :value="baseCostCopyValue"
          />
        </InputGroupAddon>
      </InputGroup>
    </div>

    <div class="sku-pricing__field">
      <label
        for="sku-pricing-offer-price"
        class="sku-pricing__label"
      >
        <i
          class="pi pi-calculator"
          aria-hidden="true"
        />
        <span>Offer Price</span>
      </label>
      <InputGroup class="sku-pricing__group">
        <InputGroupAddon><i class="pi pi-dollar" /></InputGroupAddon>
        <InputNumber
          v-model="offerPrice"
          input-id="sku-pricing-offer-price"
          :min="0"
          :min-fraction-digits="2"
          :max-fraction-digits="2"
          placeholder="0.00"
          :size="size"
          @input="handleOfferPriceInput"
        />
        <InputGroupAddon
          v-if="canCopyOfferPrice"
          class="sku-pricing__copy"
        >
          <BaseCopyText
            icon-only
            :value="offerPriceCopyValue"
          />
        </InputGroupAddon>
      </InputGroup>
    </div>

    <div class="sku-pricing__field">
      <label
        for="sku-pricing-gross-margin"
        class="sku-pricing__label"
      >
        <i
          class="pi pi-calculator"
          aria-hidden="true"
        />
        <span>Gross Margin</span>
      </label>
      <InputNumber
        v-model="grossMargin"
        input-id="sku-pricing-gross-margin"
        suffix="%"
        :min="0"
        :max="99.9"
        :step="0.5"
        :min-fraction-digits="1"
        :max-fraction-digits="1"
        show-buttons
        increment-button-icon="pi pi-chevron-up"
        decrement-button-icon="pi pi-chevron-down"
        :size="size"
        class="sku-pricing__margin"
        @input="handleGrossMarginInput"
        @update:model-value="handleGrossMarginChange"
      />
    </div>
  </div>
</template>

<style scoped>
/* Three fields across (Base Cost, Offer Price, Gross Margin) — kept 3-up even in
   the narrow drawer so both contexts read identically. */
.sku-pricing {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--p-spacing-3);
}

.sku-pricing__field {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1-75);
    min-width: 0;
}

.sku-pricing__label {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
    font-size: var(--p-font-size-sm);
    line-height: var(--p-font-line-height-none);
    color: var(--p-gray-600);
}

.sku-pricing__label .pi {
    flex: 0 0 auto;
    font-size: var(--p-font-size-xs);
    line-height: var(--p-font-line-height-none);
    color: var(--p-gray-600);
}

/* One bordered container per control (Price & Availability calculator pattern):
   overflow:hidden clips the borderless inner parts to the xs radius, so the $
   addon / stepper read as a single control. */
.sku-pricing__group,
.sku-pricing__margin {
    position: relative;
    width: 100%;
    height: var(--p-spacing-9);
    border: 1px solid var(--p-gray-200);
    border-radius: var(--p-border-radius-xs);
    overflow: hidden;
}

.sku-pricing__group:focus-within,
.sku-pricing__margin:focus-within {
    border-color: var(--p-primary-500);
}

/* $ addon: a right divider only — the container carries the border + radius. The
   dollar glyph is deepblue-900 to match the Price & Availability calculator. */
.sku-pricing__group :deep(.p-inputgroupaddon) {
    min-width: var(--p-spacing-9);
    border: none;
    border-right: 1px solid var(--p-gray-200);
    border-radius: 0;
    background: var(--p-surface-0);
    color: var(--p-deepblue-900);
}

.sku-pricing__group :deep(.p-inputgroupaddon .pi-dollar) {
    color: var(--p-deepblue-900);
    font-weight: var(--p-font-weight-bold);
}
.sku-pricing__group :deep(.p-inputgroupaddon.sku-pricing__copy) {
    border-right: none;
}

.sku-pricing__group :deep(.p-inputnumber) {
    flex: 1 1 auto;
    min-width: 0;
}

/* Inner inputs are borderless/flush — the container provides the frame. */
.sku-pricing__group :deep(.p-inputnumber-input),
.sku-pricing__margin :deep(.p-inputnumber-input) {
    width: 100%;
    height: 100%;
    border: none;
    border-radius: 0;
    box-shadow: none;
    font-weight: var(--p-font-weight-normal);
}
.sku-pricing__group :deep(.p-inputgroupaddon),
.sku-pricing__group :deep(.p-inputnumber) {
    height: 100%;
}

/* Gross Margin stepper: overlaid on the right so the input stays full width; its
   text clears the buttons via right padding. */
.sku-pricing__margin :deep(.p-inputnumber-input) {
    padding-right: var(--p-spacing-9);
}

.sku-pricing__margin :deep(.p-inputnumber-button-group) {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    height: 100%;
    width: var(--p-spacing-9);
    display: grid;
    grid-template-rows: 1fr 1fr;
    border-left: 1px solid var(--p-gray-200);
}

.sku-pricing__margin :deep(.p-inputnumber-button) {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 0;
    border: none;
    border-radius: 0;
    background: var(--p-surface-0);
    color: var(--p-gray-500);
}

.sku-pricing__margin :deep(.p-inputnumber-button-group::after) {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 1px;
    transform: translateY(-50%);
    background: var(--p-gray-200);
    pointer-events: none;
    z-index: 1;
}

.sku-pricing__margin :deep(.p-inputnumber-button:hover) {
    background: var(--p-tideblue-50);
}

.sku-pricing__margin :deep(.p-inputnumber-button .pi) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: block;
    width: 8.5px !important;
    height: 8.5px !important;
    font-size: 8.5px !important;
    line-height: 1 !important;
    margin: 0;
    padding: 0;
    overflow: visible;
}

.sku-pricing__margin :deep(.p-inputnumber-button .pi::before) {
    display: block;
    font-size: 8.5px !important;
    line-height: 1 !important;
}
.sku-pricing__margin :deep(.p-inputnumber-decrement-button .pi) {
    transform: translate(-50%, calc(-50% + 1px));
}
</style>
