<script setup lang="ts">
withDefaults(defineProps<{
  // 'sm' (12px) for the Account Information panel; 'lg' (14px) for the profile header.
  size?: 'sm' | 'lg'
  // Drop the "Syncing..." label and show only the spinning icon — for tight cells
  // like the manufacturer suppliers table's Account column.
  iconOnly?: boolean
}>(), {
  size: 'sm',
  iconOnly: false,
})
</script>

<template>
  <span
    class="sap-syncing"
    :class="`sap-syncing--${size}`"
  >
    <i
      class="pi pi-sync sap-syncing__icon"
      :aria-label="iconOnly ? 'Syncing' : undefined"
    />
    <span
      v-if="!iconOnly"
      class="sap-syncing__label"
    >Syncing...</span>
  </span>
</template>

<style scoped>
.sap-syncing {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
    /* Label: primary-900 / body-sm-mono, weight 500, fixed 12px in both the
       Account Information cell and the profile-card header (per Figma spec). */
    color: var(--p-deepblue-900);
}

/* Spinning sync icon — deliberately not the 3-dot BaseSpinner, but reuses its
   rotation (3s linear) and pulse (1.5s ease) timing so every loading state
   shares the same motion character. */
.sap-syncing__icon {
    color: var(--p-skyblue-600);
    animation:
        sap-syncing-spin 3s linear infinite,
        sap-syncing-pulse 1.5s cubic-bezier(0.7, 0, 0.3, 1) infinite;
}

.sap-syncing__label {
    font-family: var(--p-mono-family);
    font-weight: var(--p-font-weight-bold);
    line-height: normal;
}

/* Size is set per placement — icon and text match: 14px in the Account
   Information card (sm), 12px in the profile-card / detail header (lg). */
.sap-syncing--sm .sap-syncing__icon,
.sap-syncing--sm .sap-syncing__label {
    font-size: var(--p-font-size-sm);
}

.sap-syncing--lg .sap-syncing__icon,
.sap-syncing--lg .sap-syncing__label {
    font-size: var(--p-font-size-xs);
}

@keyframes sap-syncing-spin {
    to {
        transform: rotate(360deg);
    }
}

@keyframes sap-syncing-pulse {
    0%, 100% {
        opacity: var(--p-opacity-50);
    }
    50% {
        opacity: var(--p-opacity-100);
    }
}
</style>
