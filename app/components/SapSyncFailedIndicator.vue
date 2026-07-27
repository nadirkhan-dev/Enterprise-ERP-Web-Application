<script setup lang="ts">
// "Failed" indicator + Retry Sync button shown beside a SAP account number when
// the Service Master worker reports the sync failed. Hovering the info icon
// reveals the failure reason (error-styled tooltip); the button re-fires the sync.
// Figma: Connect-Design nodes 5956-65690 (sm) / 5956-65799 (lg), tooltip 5990-95937.
import type { SapSyncSubject } from '~/utils/sapSyncMessages'

const props = withDefaults(defineProps<{
  // What was being synced — drives the failure copy (account / address / contact
  // / supplier). Avoids hardcoding the noun per call site.
  subject?: SapSyncSubject
  // Optional override — e.g. the actual error text reported by SAP.
  tooltip?: string
  // 'sm' (12px) for the Account Information panel; 'lg' (14px) for the profile header.
  size?: 'sm' | 'lg'
}>(), {
  subject: 'account',
  tooltip: '',
  size: 'sm',
})

defineEmits<{
  (e: 'retry'): void
}>()

// Prefer an explicit failure reason; otherwise the context-aware default.
const failedTooltip = computed(() => props.tooltip || getSapSyncMessages(props.subject).failed)
</script>

<template>
  <span
    class="sap-failed"
    :class="`sap-failed--${size}`"
  >
    <span
      v-tooltip.top="{ value: failedTooltip, class: 'sap-tooltip--error' }"
      class="sap-failed__status"
    >
      <i class="pi pi-info-circle sap-failed__icon" />
      <span class="sap-failed__label">Failed</span>
    </span>
    <Button
      label="Retry Sync"
      icon="pi pi-refresh"
      severity="danger"
      outlined
      size="small"
      class="sap-failed__retry"
      @click="$emit('retry')"
    />
  </span>
</template>

<style scoped>
.sap-failed {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

.sap-failed__status {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
    color: var(--p-red-500);
}

/* Error icon fill — #F00 (--iconcolor-error) = red-700, a touch brighter than
   the label. */
.sap-failed__icon {
    color: var(--p-red-700);
}

.sap-failed__label {
    font-family: var(--p-mono-family);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-font-line-height-none);
}

.sap-failed--sm .sap-failed__icon,
.sap-failed--sm .sap-failed__label {
    font-size: var(--p-font-size-xs);
}

.sap-failed--lg .sap-failed__icon,
.sap-failed--lg .sap-failed__label {
    font-size: var(--p-font-size-sm);
}

:deep(.sap-failed__retry.p-button) {
    border-color: var(--p-red-200);
    background: var(--p-surface-0);
    color: var(--p-red-700);
    /* Button/small label — 12px (icon inherits via font-size). */
    font-size: var(--p-font-size-xs);
}

:deep(.sap-failed__retry .p-button-label) {
    font-weight: var(--p-font-weight-book);
}
</style>
