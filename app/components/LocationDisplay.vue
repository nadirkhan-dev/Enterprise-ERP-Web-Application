<script setup lang="ts">
import { useLocationStore } from '~/stores/location'

interface Props {
  variant?: 'standalone' | 'menu'
}

withDefaults(defineProps<Props>(), {
  variant: 'standalone',
})

const locationStore = useLocationStore()

// Blocked → point the user to browser settings (a denied permission can't be
// re-prompted from JS); otherwise explain why we ask for location at all.
const locationTooltip = computed(() =>
  locationStore.isPermissionBlocked
    ? 'Location access is blocked. Enable it in your browser settings to share.'
    : 'Location sharing provides a better user experience by improving the accuracy of address suggestions.',
)

const displayLocation = computed(() => {
  // Show reverse geocoded location if available, otherwise show coordinates
  if (locationStore.displayLocation) {
    return locationStore.displayLocation
  }
  // Fallback: show coords if reverse geocoding hasn't completed yet
  if (locationStore.hasCoordinates) {
    const lat = locationStore.latitude?.toFixed(4)
    const lon = locationStore.longitude?.toFixed(4)
    return `${lat}, ${lon}`
  }
  // No location available
  return null
})
</script>

<template>
  <div class="location-display" :class="`location-display--${variant}`">
    <i
      v-tooltip.bottom="locationTooltip"
      class="pi pi-map-marker location-display__icon"
    />
    <span
      v-tooltip.bottom="locationTooltip"
      class="location-display__text"
    >
      {{ displayLocation || 'Location Sharing' }}
    </span>
    <!-- Wrapper carries the tooltip: a disabled InputSwitch swallows hover
         events, so the tooltip must live on an always-interactive element. -->
    <span
      v-tooltip.bottom="locationTooltip"
      class="location-display__toggle-wrap"
    >
      <InputSwitch
        :model-value="locationStore.isLocationSharing"
        :disabled="locationStore.isPermissionBlocked"
        :aria-label="`Toggle location sharing: ${displayLocation || 'Location Sharing'}`"
        class="location-display__toggle"
        @update:model-value="locationStore.setLocationSharing($event)"
      />
    </span>
  </div>
</template>

<style scoped>
.location-display {
  display: flex;
  align-items: center;
  gap: var(--p-spacing-3);
}

.location-display--standalone {
  padding: var(--p-spacing-3) var(--p-spacing-4);
  background: var(--p-surface-50);
  border-bottom: 1px solid var(--p-surface-200);
}

.location-display--menu {
  padding: clamp(12px, 3vw, 16px) clamp(12px, 3vw, 16px) clamp(12px, 3vw, 16px) clamp(12px, 3vw, 24px);
  gap: 7px;
  width: 100%;
  justify-content: center;
}

.location-display__icon {
  color: var(--p-deepblue-900);
  font-size: var(--p-font-size-sm);
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}

.location-display__text {
  font-size: var(--p-font-size-sm);
  font-weight: 600;
  color: var(--p-deepblue-900);
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}

.location-display--menu .location-display__text {
  flex: 0 1 auto;
  max-width: 150px;
}

.location-display__toggle-wrap {
  margin-left: auto;
  flex-shrink: 0;
  display: inline-flex;
}

.location-display--menu .location-display__toggle-wrap {
  margin-left: 0;
}
</style>
