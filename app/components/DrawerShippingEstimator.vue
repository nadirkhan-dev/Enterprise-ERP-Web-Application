<script setup lang="ts">
import type { ItemReactive } from '~/composables/useItemDetail'

// A supplier the estimate can ship from — either one of the item's associated
// suppliers or the warehouse's linked supplier.
interface SupplierOption {
  id: number | string
  name: string
  accountNumber?: string | null
}

// What the trigger row hands the drawer. Warehouse rows carry only a name
// (Looker inventory has no id), so the form resolves it against its own
// warehouse list to reach the linked supplier + address.
interface EstimatorContext {
  source: 'warehouse' | 'supplier'
  warehouseName?: string | null
  supplier?: SupplierOption | null
}

interface Props {
  visible?: boolean
  item: ItemReactive
  context?: EstimatorContext | null
  // The item's associated suppliers (from the Suppliers section) — populate the
  // Supplier dropdown so the user can switch the ship-from supplier.
  suppliers?: SupplierOption[]
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  context: null,
  suppliers: () => [],
})

const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const localVisible = computed({
  get: () => props.visible,
  set: value => emit('update:visible', value),
})

// The drawer is a thin shell around ShippingEstimatorForm (mode="item"): it maps
// the item to the form's inputs and drives submission through the exposed API, so
// no rate logic lives here — it is shared with the standalone /tools estimator.
const estimatorForm = ref<{
  handleGetEstimates: () => void
  canSubmit: boolean
  isLoading: boolean
  submitDisabledHint: string
} | null>(null)

const shippingCategory = computed<'parcel' | 'LTL'>(() =>
  props.item.shippingGroupCode === 'ltl' ? 'LTL' : 'parcel',
)
const shippingGroupId = computed(() =>
  typeof props.item.shippingGroupId === 'number' ? props.item.shippingGroupId : null,
)

function handleCancel() {
  localVisible.value = false
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    title="Shipping Estimator"
    flush-content-bottom
  >
    <ShippingEstimatorForm
      ref="estimatorForm"
      mode="item"
      :visible="localVisible"
      :weight-lb="item.shippingWeightRaw"
      :length-in="item.shippingLengthRaw"
      :width-in="item.shippingWidthRaw"
      :height-in="item.shippingHeightRaw"
      :shipping-category="shippingCategory"
      :shipping-group-id="shippingGroupId"
      :suppliers="suppliers"
      :context="context"
    />

    <template #footer>
      <div class="estimator-footer">
        <span
          v-tooltip.top="estimatorForm?.submitDisabledHint"
          class="estimator-footer__button-wrap"
        >
          <Button
            class="estimator-footer__submit"
            :disabled="!estimatorForm?.canSubmit"
            @click="estimatorForm?.handleGetEstimates()"
          >
            <BaseSpinner
              v-if="estimatorForm?.isLoading"
              size="sm"
              class="estimator-footer__spinner"
            />
            <!-- Same shipping glyph as the side nav and the row actions that open
                 this drawer (ms:local_shipping), not PrimeIcons' pi-truck. -->
            <AppNavIcon
              v-else
              icon="ms:local_shipping"
              aria-hidden="true"
            />
            <span>Get Estimate</span>
          </Button>
        </span>
        <Button
          severity="secondary"
          class="estimator-footer__cancel"
          @click="handleCancel"
        >
          <i class="pi pi-times" />
          <span>Cancel</span>
        </Button>
      </div>
    </template>
  </BaseDrawer>
</template>

<style scoped>
/* Footer: Get Estimate + Cancel, matching the other drawers' action row. */
.estimator-footer {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    width: 100%;
}

.estimator-footer__button-wrap {
    display: inline-flex;
}

.estimator-footer__submit.p-button,
.estimator-footer__cancel.p-button {
    display: inline-flex;
    align-items: center;
    gap: var(--p-button-gap);
}

.estimator-footer__spinner {
    width: var(--p-font-size-sm);
    height: var(--p-font-size-sm);
}

/* AppNavIcon's inline <svg> sizes off the inherited font-size; keep the flex row
   from squeezing it. */
.estimator-footer__submit .app-nav-icon-svg {
    flex-shrink: 0;
}

.estimator-footer__cancel.p-button {
    border-color: transparent;
    background: var(--p-gray-50);
    color: var(--p-deepblue-900);
}

.estimator-footer__cancel.p-button:hover,
.estimator-footer__cancel.p-button:focus-visible {
    border-color: transparent;
    background: var(--p-tideblue-50);
    color: var(--p-deepblue-900);
}
</style>
