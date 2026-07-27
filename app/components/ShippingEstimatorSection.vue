<script setup lang="ts">
// Standalone Shipping Estimator for /tools/shipping-estimator. It renders the
// same ShippingEstimatorForm the item-detail drawer uses, in manual mode: the
// user types the weight and picks Parcel/LTL (auto → LTL over 50 lbs), and the
// Ship-From supplier list is fetched. All rate logic is shared with the drawer.
</script>

<template>
  <div class="estimator-card">
    <ShippingEstimatorForm
      mode="manual"
      :visible="true"
    />
  </div>
</template>

<style scoped>
/* Page card matching BasePanel's surface (this estimator has no collapsible
   header, so it isn't a BasePanel — just the same card shell). */
.estimator-card {
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-xs);
    box-shadow: var(--p-shadow-sm);
    padding: var(--p-spacing-4);

    @media (min-width: 768px) {
        padding: clamp(var(--p-spacing-6), 2vw, var(--p-spacing-8));
    }
}
</style>
