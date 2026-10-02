<script setup lang="ts">
// "Synced" indicator shown beside a SAP account number once the Service Master
// worker has synced it live this session. Hovering the info icon reveals when
// it synced (success-styled tooltip).
// Figma: Connect-Design nodes 5956-64877 (sm) / 5956-64988 (lg), tooltip 5990-96936.
withDefaults(defineProps<{
  // Formatted timestamp for the tooltip, e.g. "June 29, 2026 at 1:52 PM".
  syncedAt: string
  // 'sm' (12px) for the Account Information panel; 'lg' (14px) for the profile header.
  size?: 'sm' | 'lg'
}>(), {
  size: 'sm',
})
</script>

<template>
  <span
    v-tooltip.top="{ value: `Synced ${syncedAt}`, class: 'sap-tooltip--success' }"
    class="sap-synced"
    :class="`sap-synced--${size}`"
  >
    <i class="pi pi-info-circle sap-synced__icon" />
    <span class="sap-synced__label">Synced</span>
  </span>
</template>

<style scoped>
.sap-synced {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
    color: var(--p-mildgreen-500);
}

.sap-synced__label {
    font-family: var(--p-mono-family);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-font-line-height-none);
}

.sap-synced--sm .sap-synced__icon,
.sap-synced--sm .sap-synced__label {
    font-size: var(--p-font-size-xs);
}

.sap-synced--lg .sap-synced__icon,
.sap-synced--lg .sap-synced__label {
    font-size: var(--p-font-size-sm);
}
</style>
