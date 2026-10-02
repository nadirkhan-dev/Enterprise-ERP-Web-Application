<script setup lang="ts">
import type mapboxgl from 'mapbox-gl'

interface Props {
  latitude?: number | null
  longitude?: number | null
  interactive?: boolean
}

interface DragendPayload {
  latitude: number
  longitude: number
}

const DEFAULT_CENTER = { lng: -98.5795, lat: 39.8283 }
const DEFAULT_ZOOM = 3
// State-level zoom used whenever a location is pinned (on load and when an
// address suggestion is selected). Kept deliberately wide so a US state roughly
// fills the viewport and the marker's position within that state stays visible —
// this lets users catch a suggestion that landed in the wrong region before
// accepting it, rather than a street-level zoom that hides all state context.
const MARKER_ZOOM = 4

const props = withDefaults(defineProps<Props>(), {
  latitude: null,
  longitude: null,
  interactive: true,
})

const emit = defineEmits<{
  'update:latitude': [value: number]
  'update:longitude': [value: number]
  dragend: [payload: DragendPayload]
}>()

const settingsStore = useSettingsStore()
const mapContainer = ref<HTMLDivElement | null>(null)
const mapLoadFailed = ref(false)
const isMapReady = ref(false)
const isUnavailable = ref(false)
// When true, the unavailable overlay is "forced" by an upstream API failure (geocoder, etc.).
// In that case, map movements (flyTo) should not auto-clear the overlay.
const isForceUnavailable = ref(false)
let mapboxglLib: typeof mapboxgl | null = null
let map: mapboxgl.Map | null = null
let marker: mapboxgl.Marker | null = null
let readyTimeout: ReturnType<typeof setTimeout> | null = null
const READY_TIMEOUT_MS = 30000

function failInit() {
  if (readyTimeout) {
    clearTimeout(readyTimeout)
    readyTimeout = null
  }
  if (marker) {
    marker.remove()
    marker = null
  }
  if (map) {
    map.remove()
    map = null
  }
  mapLoadFailed.value = true
}

function getCenter() {
  if (props.latitude !== null && props.longitude !== null) {
    return { lng: props.longitude, lat: props.latitude }
  }
  return DEFAULT_CENTER
}

function getZoom() {
  if (props.latitude !== null && props.longitude !== null) {
    return MARKER_ZOOM
  }
  return DEFAULT_ZOOM
}

function initMap() {
  if (!mapContainer.value || !mapboxglLib) {
    return
  }

  if (!settingsStore.mapboxToken) {
    mapLoadFailed.value = true
    return
  }

  mapboxglLib.accessToken = settingsStore.mapboxToken

  const center = getCenter()

  map = new mapboxglLib.Map({
    container: mapContainer.value,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [center.lng, center.lat],
    zoom: getZoom(),
    interactive: props.interactive,
  })

  map.addControl(new mapboxglLib.NavigationControl(), 'top-right')

  map.on('load', () => {
    if (readyTimeout) {
      clearTimeout(readyTimeout)
      readyTimeout = null
    }
    isMapReady.value = true
  })

  map.on('error', () => {
    if (!isMapReady.value) {
      failInit()
    } else {
      markUnavailable()
    }
  })

  if (props.interactive) {
    map.on('click', (event) => {
      // Don't add a marker here — the parent's reverse-geocode handler
      // decides: on success it calls placeMarker(), on failure the
      // geocoder watcher flips the map into the unavailable state. This
      // avoids a marker flash when the API is down.
      const { lat, lng } = event.lngLat
      emit('update:latitude', lat)
      emit('update:longitude', lng)
      emit('dragend', { latitude: lat, longitude: lng })
    })
  }

  if (props.latitude !== null && props.longitude !== null) {
    addMarker(props.latitude, props.longitude)
  }
}

function addMarker(latitude: number, longitude: number) {
  if (marker) {
    marker.remove()
  }

  marker = new mapboxglLib.Marker({ draggable: props.interactive })
    .setLngLat([longitude, latitude])
    .addTo(map)

  if (props.interactive) {
    marker.on('dragend', () => {
      const lngLat = marker.getLngLat()
      emit('update:latitude', lngLat.lat)
      emit('update:longitude', lngLat.lng)
      emit('dragend', { latitude: lngLat.lat, longitude: lngLat.lng })
    })
  }
}

/**
 * Fly to a location and place/move the marker.
 *
 * @param {number} latitude
 * @param {number} longitude
 */
function flyTo(latitude: number, longitude: number) {
  if (!map) {
    return
  }

  if (!isForceUnavailable.value) {
    isUnavailable.value = false
  }

  map.flyTo({
    center: [longitude, latitude],
    zoom: MARKER_ZOOM,
    duration: 1500,
  })

  addMarker(latitude, longitude)
  emit('update:latitude', latitude)
  emit('update:longitude', longitude)
}

async function loadMap() {
  mapLoadFailed.value = false
  isMapReady.value = false
  // If the browser is offline, don't wait for dynamic imports / timeouts.
  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    failInit()
    return
  }
  // The map can't initialize without a Mapbox token. If it's missing — e.g. the
  // settings fetch was denied earlier — re-fetch it here so Retry can recover
  // once the token becomes available. Without this, Retry only re-imports the
  // (already-cached) map chunk and fails again at the same token check, which
  // reads as "nothing happens" on click.
  if (!settingsStore.mapboxToken) {
    await settingsStore.fetchSettings()
    if (!settingsStore.mapboxToken) {
      failInit()
      return
    }
  }
  // Master timeout covers the whole init path: the dynamic `mapbox-gl`
  // import (which can hang if the chunk never resolves) and the map's own
  // load/error events. If nothing becomes ready within the window, we
  // force the fallback view with a Retry button instead of spinning.
  if (readyTimeout) clearTimeout(readyTimeout)
  readyTimeout = setTimeout(() => {
    if (!isMapReady.value) {
      failInit()
    }
  }, READY_TIMEOUT_MS)
  try {
    const [mb] = await Promise.all([
      import('mapbox-gl'),
      import('mapbox-gl/dist/mapbox-gl.css'),
    ])
    mapboxglLib = mb.default
    initMap()
  } catch {
    failInit()
  }
}

onMounted(() => {
  loadMap()
})

onUnmounted(() => {
  if (readyTimeout) {
    clearTimeout(readyTimeout)
    readyTimeout = null
  }
  if (marker) {
    marker.remove()
    marker = null
  }
  if (map) {
    map.remove()
    map = null
  }
})

/**
 * Remove the marker and fly back to the default overview.
 */
function reset() {
  if (!map) {
    return
  }
  if (marker) {
    marker.remove()
    marker = null
  }
  map.flyTo({
    center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
    zoom: DEFAULT_ZOOM,
    duration: 1000,
  })
}

/**
 * Mark the map as unavailable — used when an upstream API (geocoder) fails.
 * Keeps the loaded map visible but blurred, with an overlaid indicator.
 */
function markUnavailable() {
  if (marker) {
    marker.remove()
    marker = null
  }
  isForceUnavailable.value = true
  isUnavailable.value = true
}

function markAvailable() {
  isForceUnavailable.value = false
  isUnavailable.value = false
}

function placeMarker(latitude: number, longitude: number) {
  if (!map) return
  addMarker(latitude, longitude)
}

/**
 * Pan/zoom to a location WITHOUT placing a marker — used for coarse moves like
 * recentring on a country before an exact address is known.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {number} zoom
 */
function panTo(latitude: number, longitude: number, zoom: number = MARKER_ZOOM) {
  if (!map) {
    return
  }
  // No marker — this is a coarse "show me the area" move, not a pinned location.
  if (marker) {
    marker.remove()
    marker = null
  }
  if (!isForceUnavailable.value) {
    isUnavailable.value = false
  }
  map.flyTo({
    center: [longitude, latitude],
    zoom,
    duration: 1500,
  })
}

defineExpose({ flyTo, panTo, reset, placeMarker, isMapReady, mapLoadFailed, isUnavailable, markUnavailable, markAvailable })
</script>

<template>
  <div
    v-if="mapLoadFailed"
    class="base-mapbox base-mapbox--fallback"
  >
    <svg
      class="base-mapbox__fallback-icon"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17 9c0 1.06-.39 2.32-1 3.62l1.49 1.49C18.37 12.36 19 10.57 19 9c0-3.87-3.13-7-7-7-1.84 0-3.5.71-4.75 1.86l1.43 1.43C9.56 4.5 10.72 4 12 4c2.76 0 5 2.24 5 5zm-5-2.5c-.59 0-1.13.21-1.56.56l3.5 3.5c.35-.43.56-.97.56-1.56 0-1.38-1.12-2.5-2.5-2.5zM3.41 2.86 2 4.27l3.18 3.18C5.07 7.95 5 8.47 5 9c0 5.25 7 13 7 13s1.67-1.85 3.38-4.35L18.73 21l1.41-1.41L3.41 2.86zM12 18.88C9.99 16.3 7.2 12.14 7.02 9.29l6.92 6.92c-.65.98-1.33 1.89-1.94 2.67z" />
    </svg>
    <span class="base-mapbox__fallback-text">Location unavailable</span>
    <Button
      label="Retry"
      severity="secondary"
      size="small"
      icon="pi pi-refresh"
      @click="loadMap"
    />
  </div>
  <div
    v-else
    class="base-mapbox"
  >
    <div
      ref="mapContainer"
      class="base-mapbox__canvas"
      :class="{ 'base-mapbox__canvas--blurred': isUnavailable }"
    />
    <div
      v-if="isUnavailable"
      class="base-mapbox__unavailable-overlay"
    >
      <svg
        class="base-mapbox__overlay-icon"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M17 9c0 1.06-.39 2.32-1 3.62l1.49 1.49C18.37 12.36 19 10.57 19 9c0-3.87-3.13-7-7-7-1.84 0-3.5.71-4.75 1.86l1.43 1.43C9.56 4.5 10.72 4 12 4c2.76 0 5 2.24 5 5zm-5-2.5c-.59 0-1.13.21-1.56.56l3.5 3.5c.35-.43.56-.97.56-1.56 0-1.38-1.12-2.5-2.5-2.5zM3.41 2.86 2 4.27l3.18 3.18C5.07 7.95 5 8.47 5 9c0 5.25 7 13 7 13s1.67-1.85 3.38-4.35L18.73 21l1.41-1.41L3.41 2.86zM12 18.88C9.99 16.3 7.2 12.14 7.02 9.29l6.92 6.92c-.65.98-1.33 1.89-1.94 2.67z" />
      </svg>
      <span class="base-mapbox__overlay-text">Location unavailable</span>
    </div>
  </div>
</template>

<style scoped>
.base-mapbox {
    position: relative;
    width: 100%;
    height: 300px;
    border-radius: var(--p-border-radius-sm);
    overflow: hidden;
}

.base-mapbox__canvas {
    width: 100%;
    height: 100%;
    transition: filter var(--p-transition-duration);
}

.base-mapbox__canvas--blurred {
    /* Blur only the map imagery, keep Mapbox controls crisp/visible */
}

.base-mapbox__canvas--blurred :deep(canvas.mapboxgl-canvas) {
    filter: blur(1px);
}

.base-mapbox__canvas--blurred :deep(.mapboxgl-ctrl-group) {
    background: var(--p-surface-0);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(0, 0, 0, 0.08);
}

.base-mapbox__canvas--blurred :deep(.mapboxgl-ctrl-group button) {
    color: var(--p-surface-800);
}

.base-mapbox__unavailable-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-3);
    pointer-events: none;
}

.base-mapbox__unavailable-overlay::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--p-surface-0);
    opacity: var(--p-opacity-60, 0.6);
}

/* Keep Mapbox's own UI (zoom controls + logo/attribution) above the overlay
   so users can still see them clearly during the unavailable state. */
.base-mapbox :deep(.mapboxgl-ctrl-top-right),
.base-mapbox :deep(.mapboxgl-ctrl-bottom-left),
.base-mapbox :deep(.mapboxgl-ctrl-bottom-right) {
    z-index: 2;
}

.base-mapbox__overlay-icon {
    position: relative;
    width: var(--p-font-size-5xl);
    height: var(--p-font-size-5xl);
    color: var(--p-surface-500);
}

.base-mapbox__overlay-text {
    position: relative;
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-surface-500);
}

.base-mapbox--fallback {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-3);
    background: var(--p-surface-100);
}

.base-mapbox__fallback-icon {
    width: var(--p-font-size-3xl);
    height: var(--p-font-size-3xl);
    color: var(--p-surface-400);
}

.base-mapbox__fallback-text {
    font-size: var(--p-font-size-sm);
    color: var(--p-surface-500);
}
</style>
