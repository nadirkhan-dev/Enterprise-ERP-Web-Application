<script setup lang="ts">
interface Props {
  item: {
    shippingGroup: string
    shippingLength: string
    shippingWidth: string
    shippingHeight: string
    shippingWeight: string
    shippingVolume: string
    unitWeight: string
  }
  // Fully qualified Production Type label and its explanation, both parsed from
  // the SupplyHub choice list so the copy stays editable there (CONNECT-830).
  productionTypeLabel: string
  productionTypeNote: string
}

defineProps<Props>()
</script>

<template>
  <BasePanel
    id="logistics"
    title="Logistics"
  >
    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">Shipping Group</span>
        <span class="info-value">{{ item.shippingGroup }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Shipping Length (in)</span>
        <span class="info-value">{{ item.shippingLength }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Shipping Width (in)</span>
        <span class="info-value">{{ item.shippingWidth }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Shipping Height (in)</span>
        <span class="info-value">{{ item.shippingHeight }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Shipping Weight</span>
        <span class="info-value">{{ item.shippingWeight }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Shipping Volume (L x W x H)</span>
        <span class="info-value">{{ item.shippingVolume }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Unit Weight</span>
        <span class="info-value">{{ item.unitWeight }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Production Type</span>
        <span class="info-value production-type__value">
          {{ productionTypeLabel }}
          <i
            v-if="productionTypeNote"
            v-tooltip.top="productionTypeNote"
            class="pi pi-info-circle production-type__icon"
          />
        </span>
      </div>
    </div>
  </BasePanel>
</template>

<style scoped>
.production-type__value {
    gap: var(--p-spacing-2);
    text-transform: none;
}

/* 14px, iconcolor/accent. */
.production-type__icon {
    font-size: var(--p-font-size-sm);
    color: var(--p-primary-500);
    cursor: pointer;
    flex-shrink: 0;
}

.info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--p-spacing-4);

    @media (min-width: 768px) {
        grid-template-columns: repeat(4, 1fr);
        gap: var(--p-spacing-6) var(--p-spacing-4);
    }
}

.info-item {
    align-items: flex-start;

    @media (min-width: 768px) {
        align-items: stretch;
    }
}
</style>
