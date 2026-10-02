<script setup lang="ts">
import type { RegionOption } from '~/utils/addressPaste'

interface Props {
  /**
   * Reactive address slice owned by the parent form. Mutated in place (same
   * pattern CreateCustomerStep1 uses for `form`). Shape:
   * { country, street, unitSuite, city, state, postalCode, latitude, longitude }
   */
  address: Record<string, any>
  errors?: Record<string, string>
  submitted?: boolean
  disabled?: boolean
  countryOptions: Record<string, any>[]
  /** Unique prefix for input ids so shipping/billing/mobile fields never collide. */
  idPrefix: string
  /**
   * Address entry is optional. Only once the user shows intent to provide an
   * address (they start filling it in) do the database-required fields display
   * their asterisk. Driven by the parent so the marker tracks the whole slice.
   */
  requiredActive?: boolean
  /**
   * Field arrangement from tablet up.
   *
   * `paired` (default) puts two fields per row: Country | Street, Unit | City,
   * State | Postal.
   *
   * `stacked` gives Country, Street and Unit/Suite the full width and pairs
   * City | State with Postal beneath — the arrangement DrawerAddressInfo's own
   * "Enter Details" step uses, so its later steps can read identically to the
   * one the user typed into.
   */
  layout?: 'paired' | 'stacked'
}

const props = withDefaults(defineProps<Props>(), {
  errors: () => ({}),
  submitted: false,
  disabled: false,
  requiredActive: false,
  layout: 'paired',
})

const referenceData = useReferenceDataStore()

// The Country dropdown offers only SupplyHub-active countries — the set meant for
// address selection (see referenceData.activeCountryOptions). When editing an
// address whose saved country has since been deactivated, keep that one in the
// list so the field shows its value instead of reading as empty. Lookups below
// still read the full `countryOptions` prop, so any saved country resolves for
// geocoding/regions regardless of status. Mirrors DrawerAddressInfo's pattern.
const countrySelectOptions = computed(() => {
  const active = props.countryOptions.filter((country) => country.status === 'active')
  const selectedId = props.address.country
  if (selectedId == null || active.some((country) => country.id === selectedId)) {
    return active
  }
  const selected = props.countryOptions.find((country) => country.id === selectedId)
  return selected
    ? [...active, selected].sort((a, b) => a.name.localeCompare(b.name))
    : active
})

const locationStore = useLocationStore()
const { searchAddresses, geocodeAddressDebounced, reverseGeocodeAddress } = useGeocoder()
// Character-limit counters (CONNECT-536) — Directus soft limits for `addresses`.
const { limitFor } = useCharLimits('addresses')

// Browsers ignore autocomplete="off" on detected address fields and pop their own
// saved-address overlay over the Mapbox suggestions. Mirror DrawerAddressInfo's
// hardened opt-out so a labelled Street/City/Postal field is never classified as
// an address (which is what triggers Chrome's "Save address?" prompt).
const AUTOFILL_OFF = {
  autocomplete: 'new-password',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const
const AUTOFILL_OFF_PT = { pcInputText: { root: { ...AUTOFILL_OFF } } } as const

function stampNoAutofill(element: HTMLElement): void {
  const input = element.matches('input') ? element : element.querySelector('input')
  if (!input) { return }
  for (const [attribute, value] of Object.entries(AUTOFILL_OFF)) {
    input.setAttribute(attribute, value)
  }
}
const vNoAutofill = {
  mounted: stampNoAutofill,
  updated: stampNoAutofill,
}

const regionOptions = ref<Record<string, any>[]>([])
const isLoadingRegions = ref(false)
// The selected country has states/regions to choose from. When it doesn't, the
// State field is hidden and Postal Code takes its place; when it does, a state
// selection becomes required.
const hasRegions = computed(() => regionOptions.value.length > 0)

const addressSuggestions = ref<Record<string, any>[]>([])
const isSearching = ref(false)
// True when a search returned no matches — flags the Street field red so the user
// fills the address in by hand.
const noAddressMatch = ref(false)

// Once the user starts filling the address by hand (any field below Street), the
// no-match error has done its job — clear it so the red doesn't linger after a
// valid manual entry.
watch(
  () => [props.address.city, props.address.state, props.address.postalCode, props.address.unitSuite],
  () => { if (noAddressMatch.value) { noAddressMatch.value = false } },
)

// Guards so programmatic field writes (suggestion apply, reverse geocode, initial
// country population) don't re-trigger the state-clear / geocode watchers.
let isInitialLoad = true
let isApplyingSuggestion = false

const autocompleteWrapperRef = ref<HTMLElement | null>(null)
const autocompleteOverlayStyle = computed(() => {
  const width = autocompleteWrapperRef.value?.offsetWidth
  return width ? { maxWidth: `${width - 50}px` } : {}
})

function formatRegionLabel(region: Record<string, any>) {
  return region.code ? `${region.name} (${region.code})` : region.name
}

function loadRegions(countryId: number | null) {
  if (!countryId) {
    regionOptions.value = []
    return
  }
  isLoadingRegions.value = true
  const regions = referenceData.getRegionsByCountry(countryId)
  regionOptions.value = regions.map((region) => ({
    ...region,
    displayLabel: formatRegionLabel(region),
  }))
  isLoadingRegions.value = false
}

onMounted(() => {
  if (props.address.country) {
    loadRegions(props.address.country)
  }
  // Release the initial-load guard after the first tick so the country/state the
  // parent pre-populated (US default or a restored draft) isn't wiped.
  nextTick(() => { isInitialLoad = false })
})

watch(
  () => props.address.country,
  (newCountryId, oldCountryId) => {
    if (newCountryId) {
      loadRegions(newCountryId)
    } else {
      regionOptions.value = []
    }
    // Clear the state only on a genuine user-driven country change.
    if (!isInitialLoad && !isApplyingSuggestion && oldCountryId != null && newCountryId !== oldCountryId) {
      props.address.state = null
    }
  },
)

// Derive coordinates as the address fields settle so the created record carries
// lat/long (matching the Address drawer), even though no map is shown here.
watch(
  () => [props.address.street, props.address.city, props.address.state, props.address.postalCode, props.address.country],
  async () => {
    if (props.disabled || isInitialLoad || isApplyingSuggestion) { return }
    if (!props.address.street.trim() || !props.address.city.trim()) { return }

    const selectedCountry = props.countryOptions.find((c) => c.id === props.address.country)
    // No country → no Mapbox call (same guard as the address search; holds even
    // if the US default is ever removed).
    if (!selectedCountry) { return }
    const selectedRegion = regionOptions.value.find((r) => r.id === props.address.state)

    const coordinates = await geocodeAddressDebounced({
      street: props.address.street,
      city: props.address.city,
      state: selectedRegion?.name || '',
      postalCode: props.address.postalCode,
      country: selectedCountry?.name || '',
    })
    if (coordinates) {
      props.address.latitude = coordinates.latitude
      props.address.longitude = coordinates.longitude
    }
  },
)

async function onAddressSearch(event: { query: string }) {
  const query = event.query
  if (!query || query.length < 3) {
    addressSuggestions.value = []
    noAddressMatch.value = false
    return
  }
  // Every search — typed or pasted — is scoped to the currently-selected country
  // and never falls back to a global lookup, so a pasted address can't switch the
  // country out from under the user. With no country defined there is nothing to
  // scope the search to, so skip the Mapbox call entirely.
  const selectedCountry = props.countryOptions.find((c) => c.id === props.address.country)
  if (!selectedCountry) {
    addressSuggestions.value = []
    noAddressMatch.value = false
    return
  }
  isSearching.value = true
  const suggestions = await searchAddresses(query, {
    country: selectedCountry.code || null,
    proximity: locationStore.coordinates,
  })
  addressSuggestions.value = suggestions
  noAddressMatch.value = suggestions.length === 0
  isSearching.value = false
}

// Pasted addresses arrive multi-line (copied from another system) or tab-separated
// (copied from a table). Flatten to a comma-separated query, run the search, and
// auto-apply the best corroborated match.
async function onAddressPaste(event: ClipboardEvent) {
  const pasted = event.clipboardData?.getData('text') ?? ''
  if (!pasted.includes('\n') && pasted.trim().length < 3) { return }
  const normalized = normalizePastedAddress(pasted)
  if (!normalized) { return }
  event.preventDefault()
  // Suppress the field-change geocoder while resolving the paste: writing Street
  // schedules a debounced geocode of the raw pasted text, and on a repeat paste
  // (City already filled) that runs the full "street + city" string and lands late,
  // overwriting the coordinates the applied suggestion sets. applyAddressSuggestion
  // clears the guard itself; the no-match branch clears it too.
  isApplyingSuggestion = true
  props.address.street = normalized
  await onAddressSearch({ query: normalized })
  // Auto-apply only a suggestion the pasted text actually backs, scanning the
  // whole list rather than trusting Mapbox's #1 — asked for an address it can't
  // place, Mapbox answers with a real but unrelated one, and applying that
  // silently replaced what the user pasted. (Mirrors DrawerAddressInfo.)
  const corroborated = pickCorroboratedSuggestion(normalized, addressSuggestions.value)
  if (corroborated) {
    await applyAddressSuggestion(corroborated)
    return
  }
  await applyPastedAddress(normalized)
}

// Nothing Mapbox returned matches the paste, so fill the fields from the paste
// itself — populated with the user's own text, never a wrong address. Only
// recognised parts are written, so an unparsed field keeps its value. Coordinates
// are geocoded here rather than left to the field-change watcher, which the paste
// guard suppresses.
async function applyPastedAddress(normalized: string) {
  const parsed = parsePastedAddress(normalized, {
    regions: regionOptions.value as RegionOption[],
    countryAliases: props.countryOptions.flatMap((country) => [country.name, country.code]),
  })

  props.address.street = parsed.street || normalized
  if (parsed.unitSuite) { props.address.unitSuite = parsed.unitSuite }
  if (parsed.city) { props.address.city = parsed.city }
  if (parsed.postalCode) { props.address.postalCode = parsed.postalCode }
  if (parsed.regionId != null) { props.address.state = parsed.regionId }

  // A one-line paste has no separator between the street and the city, so the
  // parse can't split them — resolve the city from the postal code before
  // geocoding, which also needs it. Those coordinates double as the fallback pin.
  let postalCoordinates = null
  if (!props.address.city.trim() && props.address.postalCode.trim()) {
    postalCoordinates = await resolveCityFromPostalCode()
  }

  await locatePastedAddress(postalCoordinates)

  nextTick(() => { isApplyingSuggestion = false })
}

// Coordinates of the postal code on its own, within the selected region and
// country — a point that is always in the right place, if not the exact one.
async function geocodePostalCode() {
  const selectedCountry = props.countryOptions.find((c) => c.id === props.address.country)
  if (!selectedCountry || !props.address.postalCode.trim()) { return null }

  const selectedRegion = regionOptions.value.find((r) => r.id === props.address.state)
  return geocodeAddressDebounced({
    postalCode: props.address.postalCode,
    state: selectedRegion?.name || '',
    country: selectedCountry.name || '',
  })
}

// Name the city a one-line paste never separated from the street. The postal
// code identifies it on its own, so read the place back off its coordinates; the
// name is then peeled off the end of the street, where the paste left it
// ("BLDG. 1330 BAY 3 DOOR 11 ALBANY" → "…DOOR 11" + Albany). Nothing is written
// unless the location answers with the code we asked about. Returns the postal
// code's coordinates either way, for the caller to reuse. (Mirrors DrawerAddressInfo.)
async function resolveCityFromPostalCode() {
  const coordinates = await geocodePostalCode()
  if (!coordinates) { return null }

  const addressParts = await reverseGeocodeAddress(coordinates.latitude, coordinates.longitude)
  if (!addressParts?.city) { return coordinates }
  if (addressParts.postalCode.trim().toUpperCase() !== props.address.postalCode.trim().toUpperCase()) {
    return coordinates
  }

  props.address.city = addressParts.city
  props.address.street = stripTrailingCity(props.address.street, addressParts.city)
  return coordinates
}

// Does a reverse-geocoded point describe the address now in the form? Compared
// on city and region — the two a wrong-but-plausible geocode gets wrong. A field
// neither side knows can't contradict, so it doesn't count against the point.
function isSamePastedPlace(located: Record<string, any> | null) {
  if (!located) { return false }

  const city = props.address.city.trim().toLowerCase()
  if (city && located.city && located.city.toLowerCase() !== city) { return false }

  const selectedRegion = regionOptions.value.find((r) => r.id === props.address.state)
  if (selectedRegion && located.state && located.state.toLowerCase() !== selectedRegion.name.toLowerCase()) {
    return false
  }
  return true
}

// Derive coordinates for the pasted address, and fill any field it left blank.
//
// The geocode is verified before it is trusted: asked for "BLDG. 1330 BAY 3 DOOR
// 11, Albany, Georgia" Mapbox answers with Bay Street in Walterboro, South
// Carolina — the right-looking text, a point 500km away. Reverse-geocoding the
// result says which place it actually landed in; when that contradicts the
// address, the postal code's own centroid is used instead, and nothing is
// backfilled from a point we don't believe. (Mirrors DrawerAddressInfo.)
async function locatePastedAddress(postalCoordinates: { latitude: number, longitude: number } | null) {
  const selectedCountry = props.countryOptions.find((c) => c.id === props.address.country)
  if (selectedCountry && props.address.street.trim() && props.address.city.trim()) {
    const selectedRegion = regionOptions.value.find((r) => r.id === props.address.state)
    const coordinates = await geocodeAddressDebounced({
      street: props.address.street,
      city: props.address.city,
      state: selectedRegion?.name || '',
      postalCode: props.address.postalCode,
      country: selectedCountry.name || '',
    })
    const located = coordinates
      ? await reverseGeocodeAddress(coordinates.latitude, coordinates.longitude)
      : null

    if (coordinates && isSamePastedPlace(located)) {
      props.address.latitude = coordinates.latitude
      props.address.longitude = coordinates.longitude
      backfillPasteGaps(located!)
      return
    }
  }

  const fallback = postalCoordinates ?? await geocodePostalCode()
  if (fallback) {
    props.address.latitude = fallback.latitude
    props.address.longitude = fallback.longitude
  }
}

// A pasted address often omits the postal code (and sometimes the state) — a
// copied table row can simply have those cells empty. The point just verified
// knows both, so fill in what the paste left blank.
//
// Only the gaps, and only the administrative fields: the street at those
// coordinates is whatever building they happen to sit on, which is exactly what
// the paste must not be overwritten with. (Mirrors DrawerAddressInfo.)
function backfillPasteGaps(located: Record<string, any>) {
  if (!props.address.postalCode.trim() && located.postalCode) {
    props.address.postalCode = located.postalCode
  }
  if (props.address.state == null && hasRegions.value && located.state) {
    const matchedRegion = regionOptions.value.find(
      (r) => r.name.toLowerCase() === located.state.toLowerCase(),
    )
    if (matchedRegion) { props.address.state = matchedRegion.id }
  }
}

// Fill the form from a chosen Mapbox suggestion: structured fields, the region
// mapped to its Directus reference id, and coordinates. The country is left as
// the user selected it.
async function applyAddressSuggestion(selected: any) {
  if (!selected || typeof selected === 'string') { return }

  noAddressMatch.value = false
  isApplyingSuggestion = true

  props.address.street = selected.street
  props.address.city = selected.city
  props.address.postalCode = selected.postalCode
  props.address.latitude = selected.latitude
  props.address.longitude = selected.longitude

  // Country is intentionally preserved — a pasted or selected suggestion never
  // changes the country the user chose. Only map the returned region within the
  // already-selected country's regions.
  await loadRegions(props.address.country)
  const matchedRegion = regionOptions.value.find(
    (r) => r.name.toLowerCase() === selected.state.toLowerCase(),
  )
  if (matchedRegion) {
    props.address.state = matchedRegion.id
  }

  nextTick(() => { isApplyingSuggestion = false })
}

function onAddressSelect(event: { value: any }) {
  applyAddressSuggestion(event.value)
}
</script>

<template>
  <div
    class="create-form-fields"
    :class="{ 'create-form-fields--stacked': layout === 'stacked' }"
  >
    <div class="create-form-row">
      <div class="form-field">
        <label
          :for="`${idPrefix}-country`"
          class="form-field__label"
        >
          Country
        </label>
        <Select
          :id="`${idPrefix}-country`"
          v-model="address.country"
          :options="countrySelectOptions"
          option-label="name"
          option-value="id"
          placeholder="Select a country"
          filter
          fluid
          :disabled="disabled"
          :invalid="submitted && !!errors.country"
          panel-class="address-select-panel"
        />
        <small
          v-if="submitted && errors.country"
          class="form-field__error"
        >{{ errors.country }}</small>
      </div>
      <div class="form-field">
        <div class="form-field__label-row">
          <label
            :for="`${idPrefix}-street`"
            class="form-field__label"
          >
            Street <span
              v-if="requiredActive"
              class="form-field__required"
            >*</span>
          </label>
          <BaseCharCounter
            :value="address.street"
            :max="limitFor('street_line_1')"
          />
        </div>
        <div
          ref="autocompleteWrapperRef"
          class="autocomplete-icon-wrapper"
        >
          <i class="pi pi-map-marker autocomplete-icon" />
          <AutoComplete
            :id="`${idPrefix}-street`"
            v-model="address.street"
            v-no-autofill
            :suggestions="addressSuggestions"
            option-label="label"
            fluid
            :delay="300"
            :min-length="3"
            :loading="isSearching"
            :disabled="disabled"
            :invalid="noAddressMatch || (submitted && !!errors.street)"
            :overlay-style="autocompleteOverlayStyle"
            :pt="AUTOFILL_OFF_PT"
            placeholder="Enter street"
            @focus="locationStore.requestLocation()"
            @paste="onAddressPaste"
            @complete="onAddressSearch"
            @option-select="onAddressSelect"
          >
            <template #option="slotProps">
              <div class="address-suggestion">
                <i class="pi pi-map-marker" />
                <span>{{ slotProps.option.label }}</span>
              </div>
            </template>
          </AutoComplete>
        </div>
        <small
          v-if="noAddressMatch"
          class="form-field__error"
        >No match found — enter the address in the fields below.</small>
        <small
          v-if="submitted && errors.street"
          class="form-field__error"
        >{{ errors.street }}</small>
      </div>
    </div>

    <div class="create-form-row">
      <div class="form-field">
        <div class="form-field__label-row">
          <label
            :for="`${idPrefix}-unit`"
            class="form-field__label"
          >Unit/Suite</label>
          <BaseCharCounter
            :value="address.unitSuite"
            :max="limitFor('street_line_2')"
          />
        </div>
        <BaseClearableInput
          :id="`${idPrefix}-unit`"
          v-model="address.unitSuite"
          v-trim
          v-no-autofill
          :disabled="disabled"
          placeholder="Enter unit or suite"
          fluid
          v-bind="AUTOFILL_OFF"
        />
      </div>
      <div class="form-field">
        <div class="form-field__label-row">
          <label
            :for="`${idPrefix}-city`"
            class="form-field__label"
          >
            City <span
              v-if="requiredActive"
              class="form-field__required"
            >*</span>
          </label>
          <BaseCharCounter
            :value="address.city"
            :max="limitFor('city')"
          />
        </div>
        <BaseClearableInput
          :id="`${idPrefix}-city`"
          v-model="address.city"
          v-trim
          v-no-autofill
          :disabled="disabled"
          :invalid="submitted && !!errors.city"
          placeholder="Enter city"
          fluid
          v-bind="AUTOFILL_OFF"
        />
        <small
          v-if="submitted && errors.city"
          class="form-field__error"
        >{{ errors.city }}</small>
      </div>
    </div>

    <div class="create-form-row">
      <!-- State/Region hides when the selected country has no regions; Postal
           Code then shifts up to take its place in this row. -->
      <div
        v-if="hasRegions"
        class="form-field"
      >
        <label
          :for="`${idPrefix}-state`"
          class="form-field__label"
        >
          State <span
            v-if="requiredActive"
            class="form-field__required"
          >*</span>
        </label>
        <Select
          :id="`${idPrefix}-state`"
          v-model="address.state"
          :options="regionOptions"
          option-label="displayLabel"
          option-value="id"
          placeholder="Select state"
          filter
          fluid
          :loading="isLoadingRegions"
          :disabled="disabled"
          :invalid="submitted && !!errors.state"
          panel-class="address-select-panel"
        />
        <small
          v-if="submitted && errors.state"
          class="form-field__error"
        >{{ errors.state }}</small>
      </div>
      <div class="form-field">
        <div class="form-field__label-row">
          <label
            :for="`${idPrefix}-postal`"
            class="form-field__label"
          >
            Postal Code <span
              v-if="requiredActive"
              class="form-field__required"
            >*</span>
          </label>
          <BaseCharCounter
            :value="address.postalCode"
            :max="limitFor('postal_code')"
          />
        </div>
        <BaseClearableInput
          :id="`${idPrefix}-postal`"
          v-model="address.postalCode"
          v-trim
          v-no-autofill
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          :disabled="disabled"
          :invalid="submitted && !!errors.postalCode"
          placeholder="Enter postal code"
          fluid
          v-bind="AUTOFILL_OFF"
        />
        <small
          v-if="submitted && errors.postalCode"
          class="form-field__error"
        >{{ errors.postalCode }}</small>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* `stacked` layout — the row wrappers step out of the way with display:contents
   so all six fields become cells of one grid, and the three that run full width
   span both columns. City | State then pair with Postal flowing beneath, which
   is what DrawerAddressInfo's Enter Details step shows; when the country has no
   regions, State is absent and Postal flows up beside City, exactly as it does
   there. Mobile is untouched: one field per row either way, since a half-width
   field is too narrow to read (see .create-form-row-2 in create-form.css). */
.create-form-fields--stacked {
    @media (min-width: 768px) {
        display: grid;
        grid-template-columns: 1fr 1fr;
        column-gap: var(--p-spacing-6);
        row-gap: var(--p-spacing-3);

        > .create-form-row {
            display: contents;
        }

        /* Country and Street, then Unit/Suite. */
        > .create-form-row:first-child > .form-field,
        > .create-form-row:nth-child(2) > .form-field:first-child {
            grid-column: 1 / -1;
        }
    }
}

.autocomplete-icon-wrapper {
    position: relative;
}

.autocomplete-icon {
    position: absolute;
    right: var(--p-spacing-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--p-gray-400);
    z-index: 1;
    pointer-events: none;
}

/* Reserve room on the right for the pin icon; keep the standard left padding. */
.autocomplete-icon-wrapper :deep(.p-autocomplete-input) {
    padding-right: var(--p-spacing-8);
}

.address-suggestion {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    overflow: hidden;
}

.address-suggestion span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* No-region countries hide the State field, leaving Postal Code alone in the
   row. On desktop the row is flex with flex:1 fields, so a lone Postal would
   stretch to full width — pin it to the same half-width (State's old slot) it
   had when the two were paired. Mobile stacks one-per-row, so it's unaffected. */
.create-form-row > .form-field:only-child {
    @media (min-width: 768px) {
        flex: 0 1 calc(50% - var(--p-spacing-6) / 2);
    }
}
</style>
