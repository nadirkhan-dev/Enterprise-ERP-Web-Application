<script setup lang="ts">
import type { InputNumberInputEvent } from 'primevue/inputnumber'
import type { PriceField } from '~/composables/useItemPriceCalculator'
import type { InventoryRow } from '~/composables/useItemDetail'

interface Props {
  item: {
    baseCost: string
    offerPrice: string
    grossMargin: string
    manufacturerListPrice: string
  }
  inventory: InventoryRow[]
  isPricingLoading: boolean
  originalBaseCostDisplay: string
  originalOfferPriceDisplay: string
  originalGrossMarginDisplay: string
  isBaseCostValid: boolean
  isOfferPriceValid: boolean
  isGrossMarginValid: boolean
  editingField: PriceField | null
  editDollarValue: number | null
  editPercentValue: number | null
}

const emit = defineEmits<{
  'open-calculator': [field: PriceField]
  'close-calculator': []
  'dollar-input-event': [event: InputNumberInputEvent]
  'dollar-input': [value: number | null]
  'percent-input-event': [event: InputNumberInputEvent]
  'percent-input': [value: number | null]
  'editor-ref': [el: HTMLElement | null]
  'estimate-shipping': [row: InventoryRow]
}>()

const props = defineProps<Props>()

const inventoryTableRef = ref(null)

// Per-row truck action → opens the Shipping Estimator drawer with this
// warehouse as the ship-from origin. Skeleton rows are inert.
const frozenActions = [
  {
    // Same shipping glyph as the side nav's Shipments item and the estimator
    // drawer's Get Estimate button.
    icon: 'ms:local_shipping',
    handler: (row: Record<string, unknown>) => {
      if (row._skeleton) { return }
      emit('estimate-shipping', row as unknown as InventoryRow)
    },
  },
]

const inventorySkeletonRows: Array<Record<string, any>> = Array.from({ length: 3 }, (_, index) => ({
  _skeleton: true,
  binLocation: `skeleton-${index}`,
}))

// MSP01 must stay visible even at zero availability so a shipping estimate can
// always be requested from it (outbound + inbound) — critical for special-order/
// non-stock items where inventory is not a reliable indicator. Stocked bins are
// listed as before; when none of them are MSP01, a single MSP01 row (the source
// list always contains one) is surfaced so the warehouse is never hidden behind
// a "Non-stock item" empty state.
const ALWAYS_SHOWN_WAREHOUSE = 'MSP01'
const visibleInventory = computed(() => {
  const stockedInventory = props.inventory.filter((row) => row.available > 0)
  if (stockedInventory.some((row) => row.warehouse === ALWAYS_SHOWN_WAREHOUSE)) {
    return stockedInventory
  }
  const msp01Row = props.inventory.find((row) => row.warehouse === ALWAYS_SHOWN_WAREHOUSE)
  return msp01Row ? [...stockedInventory, msp01Row] : stockedInventory
})

const { rowsPerPage, rowsPerPageOptions, scrollHeight, virtualScrollerOptions } =
  useTableRowsPerPage(inventoryTableRef, () => visibleInventory.value.length)

const { firstVisibleRow, lastVisibleRow } = useVisibleRowRange(
  inventoryTableRef,
  computed(() => visibleInventory.value.length),
)

const { showFooterShadow } = useTableFooterShadow(
  inventoryTableRef,
  computed(() => visibleInventory.value.length),
)

</script>

<template>
  <BasePanel
    id="price-availability"
    title="Price & Availability"
  >
    <div class="price-stats">
      <ItemPriceStatCard
        field="baseCost"
        label="Base Cost"
        :value="item.baseCost"
        :original-value="originalBaseCostDisplay"
        :is-pricing-loading="isPricingLoading"
        :is-valid="isBaseCostValid"
        :is-editing="editingField === 'baseCost'"
        :show-original-when-editing="editingField !== null"
        :edit-dollar-value="editDollarValue"
        :edit-percent-value="editPercentValue"
        @open="$emit('open-calculator', $event)"
        @close="$emit('close-calculator')"
        @dollar-input-event="$emit('dollar-input-event', $event)"
        @dollar-input="$emit('dollar-input', $event)"
        @percent-input-event="$emit('percent-input-event', $event)"
        @percent-input="$emit('percent-input', $event)"
      />

      <ItemPriceStatCard
        field="offerPrice"
        label="Offer Price"
        :value="item.offerPrice"
        :original-value="originalOfferPriceDisplay"
        :is-pricing-loading="isPricingLoading"
        :is-valid="isOfferPriceValid"
        :is-editing="editingField === 'offerPrice'"
        :show-original-when-editing="editingField !== null"
        :edit-dollar-value="editDollarValue"
        :edit-percent-value="editPercentValue"
        @open="$emit('open-calculator', $event)"
        @close="$emit('close-calculator')"
        @dollar-input-event="$emit('dollar-input-event', $event)"
        @dollar-input="$emit('dollar-input', $event)"
        @percent-input-event="$emit('percent-input-event', $event)"
        @percent-input="$emit('percent-input', $event)"
      />

      <ItemPriceStatCard
        field="grossMargin"
        label="Gross Margin"
        :value="item.grossMargin"
        :original-value="originalGrossMarginDisplay"
        :is-pricing-loading="isPricingLoading"
        :is-valid="isGrossMarginValid"
        :is-editing="editingField === 'grossMargin'"
        :show-original-when-editing="editingField !== null"
        :edit-dollar-value="editDollarValue"
        :edit-percent-value="editPercentValue"
        :has-dollar="false"
        @open="$emit('open-calculator', $event)"
        @close="$emit('close-calculator')"
        @dollar-input-event="$emit('dollar-input-event', $event)"
        @dollar-input="$emit('dollar-input', $event)"
        @percent-input-event="$emit('percent-input-event', $event)"
        @percent-input="$emit('percent-input', $event)"
      />

      <div class="price-stat">
        <span class="price-stat__label">Manufacturer List Price</span>
        <span
          v-if="isPricingLoading"
          class="skeleton-block skeleton-line skeleton-line--value"
        />
        <span
          v-else
          class="price-stat__value price-stat__value--calculator"
        >{{ item.manufacturerListPrice }}</span>
      </div>

    </div>

    <DataTable
      ref="inventoryTableRef"
      :value="isPricingLoading ? inventorySkeletonRows : visibleInventory"
      data-key="binLocation"
      scrollable
      :scroll-height="scrollHeight"
      :virtual-scroller-options="virtualScrollerOptions"
      :table-style="{ minWidth: '100%' }"
      :row-class="(rowData) => rowData._skeleton ? 'skeleton-row' : ''"
    >
      <Column field="warehouse" header="Warehouse" style="min-width: clamp(120px, 18vw, 140px)">
        <template #body="{ data: row }">
          <div v-if="row._skeleton" class="skeleton-block" />
          <template v-else>
            {{ row.warehouse }}
          </template>
        </template>
      </Column>
      <Column field="available" header="Available" sortable style="min-width: 140px">
        <template #body="{ data: row }">
          <div v-if="row._skeleton" class="skeleton-block" />
          <template v-else>
            {{ row.available }}
          </template>
        </template>
      </Column>
      <Column field="binLocation" header="Bin Location" style="min-width: clamp(120px, 20vw, 160px)">
        <template #body="{ data: row }">
          <div v-if="row._skeleton" class="skeleton-block" />
          <template v-else>
            {{ row.binLocation }}
          </template>
        </template>
      </Column>
      <Column field="unitCost" header="Unit Cost" sortable style="min-width: 160px">
        <template #body="{ data: row }">
          <div v-if="row._skeleton" class="skeleton-block" />
          <template v-else>
            {{ row.unitCost }}
          </template>
        </template>
      </Column>
      <Column field="minOrderQty" style="min-width: 110px">
        <template #header>
          <span class="moq-header">
            MOQ
            <i
              v-tooltip.top="'Minimum Order Quantity'"
              class="pi pi-question-circle moq-header__icon"
              aria-label="Minimum Order Quantity"
            />
          </span>
        </template>
        <template #body="{ data: row }">
          <div v-if="row._skeleton" class="skeleton-block" />
          <template v-else>
            {{ row.minOrderQty }}
          </template>
        </template>
      </Column>
      <BaseFrozenColumn key="frozen" :table-ref="inventoryTableRef" :actions="frozenActions" />
      <template #footer>
        <BaseDataTableFooterLoader
          v-model:rows-per-page="rowsPerPage"
          :rows-per-page-options="rowsPerPageOptions"
          :show-shadow="showFooterShadow"
          :first-row="firstVisibleRow"
          :last-row="lastVisibleRow"
          :total-records="visibleInventory.length"
          page-label="locations"
        />
      </template>
    </DataTable>
  </BasePanel>
</template>

<style src="./ItemPricePanel.css" scoped></style>
