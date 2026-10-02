type LocationStatus =
  | 'idle'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'unsupported'
  | 'timeout'
  | 'error'

interface LocationState {
  latitude: number | null
  longitude: number | null
  accuracy: number | null
  status: LocationStatus
  errorMessage: string | null
  hasRequested: boolean
  isLocationSharing: boolean
  displayLocation: string | null
  // Live browser geolocation permission: 'granted' | 'denied' | 'prompt'.
  // `null` when the Permissions API is unavailable (e.g. Safari). Drives whether
  // the sharing toggle can re-prompt ('prompt') or must be disabled ('denied').
  permission: PermissionState | null
}

// Low-accuracy is plenty for biasing address search, and avoids the slower,
// battery-hungry GPS fix. A cached fix up to 5 minutes old is fine to reuse.
const GEOLOCATION_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 10000,
  maximumAge: 5 * 60 * 1000,
}

/**
 * Holds the user's coarse location so address autocomplete can bias and rank
 * suggestions toward where they are. Requesting is best-effort and never blocks
 * the app — every failure path (denied, unavailable, timeout, unsupported) is
 * captured in `status` and the rest of the app simply falls back to unbiased
 * search.
 */
export const useLocationStore = defineStore('location', {
  state: (): LocationState => ({
    latitude: null,
    longitude: null,
    accuracy: null,
    status: 'idle',
    errorMessage: null,
    hasRequested: false,
    // Off until location access is actually granted — turned on in the
    // geolocation success path (and by the user via the toggle).
    isLocationSharing: false,
    displayLocation: null,
    permission: null,
  }),
  getters: {
    /** `{ latitude, longitude }` once a fix exists, otherwise `null`. */
    coordinates(state): { latitude: number; longitude: number } | null {
      if (state.latitude == null || state.longitude == null) {
        return null
      }
      return { latitude: state.latitude, longitude: state.longitude }
    },
    hasCoordinates(): boolean {
      return this.coordinates !== null
    },
    /**
     * The browser has hard-blocked location, so it can't be re-prompted in code.
     * The sharing toggle is disabled in this state and a tooltip points the user
     * to their browser settings.
     */
    isPermissionBlocked(state): boolean {
      return state.permission === 'denied'
    },
  },
  actions: {
    /**
     * Read the current geolocation permission without triggering a prompt.
     * Returns `null` when the Permissions API is unavailable (e.g. Safari).
     */
    async readPermissionState(): Promise<PermissionState | null> {
      if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
        return null
      }
      const { data: status } = await tryCatch(
        navigator.permissions.query({ name: 'geolocation' as PermissionName }),
      )
      return status?.state ?? null
    },

    /**
     * Request the user's location via the browser Geolocation API. Only prompts
     * once per session unless `force` is set, and short-circuits when the user
     * has already denied access so we never fire a doomed request.
     */
    async requestLocation(options: { force?: boolean } = {}): Promise<void> {
      const { force = false } = options
      if (!import.meta.client) {
        return
      }
      if ((this.hasRequested && !force) || this.status === 'requesting') {
        return
      }
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        this.status = 'unsupported'
        this.hasRequested = true
        return
      }

      // A previously denied permission can't be re-prompted programmatically, so
      // skip the native call entirely rather than waiting for a guaranteed error.
      if (!force) {
        const permission = await this.readPermissionState()
        if (permission === 'denied') {
          this.status = 'denied'
          this.hasRequested = true
          return
        }
      }

      this.hasRequested = true
      this.status = 'requesting'

      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            this.latitude = position.coords.latitude
            this.longitude = position.coords.longitude
            this.accuracy = position.coords.accuracy
            this.status = 'granted'
            this.permission = 'granted'
            this.isLocationSharing = true
            this.errorMessage = null
            this.reverseGeocode(position.coords.latitude, position.coords.longitude)
            resolve()
          },
          (error) => {
            this.applyError(error)
            resolve()
          },
          GEOLOCATION_OPTIONS,
        )
      })
    },

    /** Reverse geocode coordinates to city/state using Nominatim API. */
    async reverseGeocode(latitude: number, longitude: number): Promise<void> {
      if (!import.meta.client) {
        return
      }
      const { data } = await tryCatch(
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`)
          .then(r => r.json()),
      )
      if (!data?.address) {
        return
      }
      const city = data.address.city || data.address.town || data.address.village || 'Unknown'
      // Prefer the API's two-letter state code (ISO 3166-2, e.g. "US-CA" → "CA")
      // and fall back to the full state/district name when the code isn't given.
      const isoRegion: string | undefined = data.address['ISO3166-2-lvl4']
      const stateCode = isoRegion?.split('-')[1]
      const region = stateCode || data.address.state || data.address.district || ''
      this.displayLocation = region ? `${city}, ${region}` : city
    },

    /** Map a Geolocation error code onto a status + friendly message. */
    applyError(error: GeolocationPositionError): void {
      this.latitude = null
      this.longitude = null
      this.accuracy = null
      switch (error.code) {
        case error.PERMISSION_DENIED:
          this.status = 'denied'
          this.permission = 'denied'
          this.isLocationSharing = false
          this.errorMessage = 'Location permission was denied.'
          break
        case error.POSITION_UNAVAILABLE:
          this.status = 'unavailable'
          this.errorMessage = 'Your location is currently unavailable.'
          break
        case error.TIMEOUT:
          this.status = 'timeout'
          this.errorMessage = 'Timed out while determining your location.'
          break
        default:
          this.status = 'error'
          this.errorMessage = error.message || 'Failed to determine your location.'
      }
    },

    /**
     * Read the live geolocation permission and keep it in sync. Attaches an
     * `onchange` listener so the toggle reacts when the user flips the browser's
     * site permission (e.g. unblocks it in settings) without a page reload.
     */
    async syncPermission(): Promise<void> {
      if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
        this.permission = null
        return
      }
      const { data: status } = await tryCatch(
        navigator.permissions.query({ name: 'geolocation' as PermissionName }),
      )
      if (!status) {
        this.permission = null
        return
      }
      this.applyPermission(status.state)
      status.onchange = () => this.applyPermission(status.state)
    },

    /** Reflect a permission value into state. A hard block forces sharing off. */
    applyPermission(permission: PermissionState): void {
      this.permission = permission
      if (permission === 'denied') {
        this.isLocationSharing = false
        this.clearLocation()
        this.status = 'denied'
      }
    },

    /** Drop the current fix without touching the browser permission. */
    clearLocation(): void {
      this.latitude = null
      this.longitude = null
      this.accuracy = null
      this.displayLocation = null
    },

    /**
     * Drive the sharing toggle.
     * - ON: prompt for / refresh the fix. If the browser blocks it, revert off.
     *   (The toggle is disabled when already hard-blocked, so this only runs from
     *   a 'prompt'/'granted' state.)
     * - OFF: stop sharing and drop the current fix. The browser permission is
     *   left untouched, so it can be turned back on without a re-prompt.
     */
    async setLocationSharing(enabled: boolean): Promise<void> {
      if (enabled) {
        if (this.isPermissionBlocked) {
          this.isLocationSharing = false
          return
        }
        this.isLocationSharing = true
        await this.requestLocation({ force: true })
        if (this.status === 'denied' || !this.hasCoordinates) {
          this.isLocationSharing = false
        }
      } else {
        this.isLocationSharing = false
        this.clearLocation()
      }
    },

    /** Toggle location sharing on/off. */
    toggleLocationSharing(): void {
      this.setLocationSharing(!this.isLocationSharing)
    },
  },
})
