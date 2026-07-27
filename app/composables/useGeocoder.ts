interface GeoCoordinates {
  latitude: number
  longitude: number
}

interface AddressParts {
  street?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
}

interface AddressSuggestion extends Required<AddressParts> {
  label: string
  latitude: number
  longitude: number
  // True when the match is a business/POI (vs a plain street/address). The
  // "find by business name" flow prefers this — it carries the exact business pin.
  isBusiness: boolean
  // True when Mapbox returned a precise, house-number-level address (feature_type
  // "address") rather than a street-level approximation. A paste trusts this as an
  // exact match and skips the business-name fallback.
  isPreciseAddress: boolean
}

// Mapbox Search Box API shapes (search/searchbox/v1). Unlike the old Geocoding v5
// response, context is an object keyed by level (place, region, postcode, …) and
// coordinates arrive as a { latitude, longitude } object on properties.
interface SearchBoxContextEntry {
  name?: string
  address_number?: string
  street_name?: string
  region_code?: string
  region_code_full?: string
  country_code?: string
}

interface SearchBoxContext {
  address?: SearchBoxContextEntry
  street?: SearchBoxContextEntry
  neighborhood?: SearchBoxContextEntry
  locality?: SearchBoxContextEntry
  postcode?: SearchBoxContextEntry
  place?: SearchBoxContextEntry
  district?: SearchBoxContextEntry
  region?: SearchBoxContextEntry
  country?: SearchBoxContextEntry
}

interface SearchBoxFeature {
  geometry?: { coordinates?: [number, number] }
  properties: {
    name: string
    name_preferred?: string
    address?: string
    full_address?: string
    place_formatted?: string
    feature_type: string
    coordinates?: { latitude: number; longitude: number; accuracy?: string }
    context?: SearchBoxContext
  }
}

interface SearchBoxResponse {
  features: SearchBoxFeature[]
}

interface SearchAddressesOptions {
  country?: string | null
  limit?: number
  /**
   * Bias results toward this point. Mapbox weights nearer results higher while
   * still allowing a clearly-better distant match to lead — so, unlike the old
   * Geocoding API, we no longer re-sort by distance ourselves.
   */
  proximity?: GeoCoordinates | null
}

const SEARCH_BOX_BASE = 'https://api.mapbox.com/search/searchbox/v1'

// Feature types we surface in the address search: street-level results plus
// businesses (POI). Businesses matter for a B2B address field — many customers
// (especially rural Puerto Rico) have an imprecise street address but an exact
// business pin in Mapbox, so searching the company name lands the right spot.
// Places, regions and districts are still dropped (no usable street line).
//
// We filter client-side rather than via the request's `types` param on purpose:
// `types` measurably reorders Mapbox's results (it can push a wrong-city match to
// the top), whereas filtering the returned list preserves Mapbox's own ranking.
const SEARCHABLE_FEATURE_TYPES = new Set(['address', 'street', 'poi'])

// Module-level so every useGeocoder() consumer reacts to the same failure —
// the address drawer watches this to flip the map into its fallback state.
const isGeocoderUnavailable = ref(false)

async function fetchMapboxJson(url: string): Promise<SearchBoxResponse> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Mapbox request failed: ${response.status} ${response.statusText}`)
  }
  return (await response.json()) as SearchBoxResponse
}

function toProperCase(value: string): string {
  return value.replace(/[^\s,]+/g, (word) => {
    const hasLowercase = (/[a-z]/).test(word)
    const hasDigit = (/\d/).test(word)
    if (hasLowercase || hasDigit) { return word }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  })
}

// Pull [lat, lng] from a Search Box feature — prefer the structured coordinates
// object, fall back to GeoJSON geometry ([lng, lat]).
function extractCoordinates(feature: SearchBoxFeature): GeoCoordinates | null {
  const point = feature?.properties?.coordinates
  if (point && typeof point.latitude === 'number' && typeof point.longitude === 'number') {
    return { latitude: point.latitude, longitude: point.longitude }
  }
  const geometry = feature?.geometry?.coordinates
  if (Array.isArray(geometry) && geometry.length === 2) {
    return { latitude: geometry[1], longitude: geometry[0] }
  }
  return null
}

// Map a Search Box feature onto our structured address parts. For a business
// (POI) `name` is the company name and the street lives in `address`; for
// address/street features `name` IS the street line (e.g. "Carr 493 Km 1.4 Bl a"
// or "30 Rockefeller Plaza"). City/state/postal/country come from the context.
function extractAddressParts(feature: SearchBoxFeature): Required<AddressParts> {
  const properties = feature?.properties
  const context = properties?.context ?? {}
  const street = properties?.feature_type === 'poi'
    ? (properties.address ?? context.street?.name ?? '')
    : (properties?.name ?? '')
  return {
    street: toProperCase(street),
    city: toProperCase(context.place?.name ?? ''),
    // PR businesses return with no `region` (Mapbox files Puerto Rico as its own
    // country), but the app models PR as a state — fall back to the country name,
    // which for PR is exactly the region the form expects. Harmless elsewhere: a
    // mainland "United States" fallback simply won't match any US region.
    state: toProperCase(context.region?.name ?? context.country?.name ?? ''),
    postalCode: context.postcode?.name ?? '',
    country: toProperCase(context.country?.name ?? ''),
  }
}

// Dropdown label. For a business, lead with its name — the address alone wouldn't
// tell the user which company it is; `full_address` carries the street/city/ZIP.
function buildLabel(feature: SearchBoxFeature): string {
  const { name, full_address, place_formatted, feature_type } = feature.properties
  if (feature_type === 'poi') {
    return [name, full_address ?? place_formatted].filter(Boolean).join(' — ')
  }
  return full_address ?? [name, place_formatted].filter(Boolean).join(', ')
}

/**
 * Composable for geocoding addresses via the Mapbox Search Box API.
 */
export function useGeocoder() {
  const settingsStore = useSettingsStore()
  const toast = tryCatchSync(() => useToast()).data
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function notifyGeocoderFailure(error: Error) {
    isGeocoderUnavailable.value = true
    showApiFailureToast(toast, error.message || 'Location services are unavailable.')
  }

  function markGeocoderAvailable() {
    isGeocoderUnavailable.value = false
  }

  // No token means one of two things: the settings fetch failed (a real error
  // we must surface), or the backend simply has no `mapbox_key` configured
  // (nothing to report). Only the former flips the map into its failure state
  // and shows a toast — with Directus's own message — while an unconfigured key
  // stays a silent no-op.
  function handleMissingToken() {
    if (settingsStore.settingsErrorMessage) {
      notifyGeocoderFailure(new Error(settingsStore.settingsErrorMessage))
    }
  }

  /**
   * Geocode an address into lat/lng coordinates.
   */
  async function geocodeAddress(addressParts: AddressParts = {}): Promise<GeoCoordinates | null> {
    const { street = '', city = '', state = '', postalCode = '', country = '' } = addressParts

    const query = [street, city, state, postalCode, country]
      .filter(Boolean)
      .join(', ')

    if (!query.trim()) {
      return null
    }

    const token = settingsStore.mapboxToken
    if (!token) {
      handleMissingToken()
      return null
    }

    const params = new URLSearchParams({ q: query, access_token: token, limit: '1' })
    const { data: response, error } = await tryCatch(fetchMapboxJson(`${SEARCH_BOX_BASE}/forward?${params}`))

    if (error) {
      notifyGeocoderFailure(error)
      return null
    }

    const coordinates = response?.features?.length ? extractCoordinates(response.features[0]) : null
    if (!coordinates) {
      return null
    }
    markGeocoderAvailable()
    return coordinates
  }

  /**
   * Debounced geocode — waits 500ms after the last call before executing.
   */
  function geocodeAddressDebounced(
    addressParts: AddressParts = {},
  ): Promise<GeoCoordinates | null> {
    return new Promise((resolve) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(async () => {
        const coordinates = await geocodeAddress(addressParts)
        resolve(coordinates)
      }, 500)
    })
  }

  /**
   * Reverse-geocode coordinates into structured address parts.
   */
  async function reverseGeocodeAddress(
    latitude: number,
    longitude: number,
  ): Promise<Required<AddressParts> | null> {
    const token = settingsStore.mapboxToken
    if (!token) {
      handleMissingToken()
      return null
    }

    const params = new URLSearchParams({
      longitude: String(longitude),
      latitude: String(latitude),
      access_token: token,
      limit: '1',
    })
    const { data: response, error } = await tryCatch(fetchMapboxJson(`${SEARCH_BOX_BASE}/reverse?${params}`))

    if (error) {
      notifyGeocoderFailure(error)
      return null
    }
    if (!response?.features?.length) {
      return null
    }

    markGeocoderAvailable()
    return extractAddressParts(response.features[0])
  }

  /**
   * Search for address suggestions via the Mapbox Search Box API.
   *
   * @param query - The user's search input
   * @param options
   */
  async function searchAddresses(
    query: string,
    options: SearchAddressesOptions = {},
  ): Promise<AddressSuggestion[]> {
    const token = settingsStore.mapboxToken
    if (!token) {
      handleMissingToken()
      return []
    }
    if (!query.trim()) {
      return []
    }

    const { country = null, limit = 5, proximity = null } = options
    const params = new URLSearchParams({
      q: query,
      access_token: token,
      auto_complete: 'true',
      limit: String(limit),
    })
    if (country) {
      // Puerto Rico is a US territory but Mapbox files it under its own country
      // code "PR", so a plain country=us search misses PR businesses/addresses.
      // Include PR alongside US so Puerto Rico customers resolve.
      params.set('country', country.toLowerCase() === 'us' ? 'us,pr' : country)
    }
    if (proximity) {
      params.set('proximity', `${proximity.longitude},${proximity.latitude}`)
    }

    const { data: response, error } = await tryCatch(fetchMapboxJson(`${SEARCH_BOX_BASE}/forward?${params}`))

    if (error) {
      notifyGeocoderFailure(error)
      return []
    }
    if (!response?.features?.length) {
      return []
    }

    markGeocoderAvailable()
    // Keep Mapbox's ranking; just drop non-address levels and shape each hit.
    return response.features
      .filter((feature) => SEARCHABLE_FEATURE_TYPES.has(feature.properties.feature_type))
      .map((feature) => {
        const coordinates = extractCoordinates(feature)
        return {
          label: buildLabel(feature),
          ...extractAddressParts(feature),
          latitude: coordinates?.latitude ?? 0,
          longitude: coordinates?.longitude ?? 0,
          isBusiness: feature.properties.feature_type === 'poi',
          isPreciseAddress: feature.properties.feature_type === 'address',
        }
      })
  }

  return {
    geocodeAddress,
    geocodeAddressDebounced,
    reverseGeocodeAddress,
    searchAddresses,
    isGeocoderUnavailable,
  }
}
