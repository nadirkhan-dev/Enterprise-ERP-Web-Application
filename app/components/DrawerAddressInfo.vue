<script setup lang="ts">
import { readField } from '@directus/sdk'

interface Props {
  visible?: boolean
  address?: Record<string, any> | null
  businessPartnerId?: number | null
  /** The customer/supplier's name — powers the "find by business name" search. */
  businessPartnerName?: string | null
  defaultShippingJunctionId?: number | null
  defaultBillingJunctionId?: number | null
  /** Suppliers have billing-only addresses — hide the shipping toggles. */
  isSupplier?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  address: null,
  businessPartnerId: null,
  businessPartnerName: null,
  defaultShippingJunctionId: null,
  defaultBillingJunctionId: null,
  isSupplier: false,
})
const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: [payload?: { mode: 'create' | 'update' | 'delete'; record?: Record<string, any>; id?: number | string }]
}>()

const toast = useToast()
const directus = useDirectus()
const { updateBusinessPartner, fetchPartnerAddresses } = useBusinessPartners()
const referenceData = useReferenceDataStore()
// Character-limit counters (CONNECT-536) — Directus soft limits for `addresses`.
const { limitFor } = useCharLimits('addresses')
// inactive_note lives on the junction, not the addresses collection.
const { limitFor: limitForJunction } = useCharLimits('business_partners_addresses')

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const isEditMode = computed(() => props.address !== null)
const isSaving = ref(false)
const submitted = ref(false)
const hasLoadError = ref(false)

const {
  geocodeAddress,
  geocodeAddressDebounced,
  reverseGeocodeAddress,
  searchAddresses,
  isGeocoderUnavailable,
} = useGeocoder()
const locationStore = useLocationStore()

// Browsers ignore autocomplete="off" on detected address fields and pop their own
// saved-address overlay over our Mapbox suggestions. `new-password` is the documented
// workaround; the data-* flags opt out of common password managers. AutoComplete
// hard-codes autocomplete="off" on its input, so it must be overridden via passthrough;
// plain inputs take the attributes directly.
const AUTOFILL_OFF = {
  autocomplete: 'new-password',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const
const AUTOFILL_OFF_PT = { pcInputText: { root: { ...AUTOFILL_OFF } } } as const

// Version-proof enforcement of the autofill opt-out. Passing the attributes via
// props/pt only works if they reach the real <input>, and PrimeVue's AutoComplete
// hard-codes autocomplete="off" on its input AND re-applies it on every re-render
// — so a one-time stamp reverts and the browser sees an address-typed field again,
// which is exactly what makes it pop the "Save address?" prompt when the drawer
// closes. This directive stamps the opt-out straight onto the <input>, gives it a
// generic non-address name (defeating field-name heuristics), and holds both in
// place with a MutationObserver so they can never revert.
interface NoAutofillInput extends HTMLInputElement {
  _noAutofillObserver?: MutationObserver
}

function applyNoAutofill(input: HTMLInputElement): void {
  for (const [attribute, value] of Object.entries(AUTOFILL_OFF)) {
    // Only write when different so re-asserting from the observer can't loop.
    if (input.getAttribute(attribute) !== value) {
      input.setAttribute(attribute, value)
    }
  }
  if (!input.name.startsWith('naf-')) {
    input.name = `naf-${Math.random().toString(36).slice(2, 10)}`
  }
}

function stampNoAutofill(element: HTMLElement): void {
  const input = (element.matches('input') ? element : element.querySelector('input')) as NoAutofillInput | null
  if (!input) { return }
  applyNoAutofill(input)
  if (!input._noAutofillObserver) {
    const observer = new MutationObserver(() => applyNoAutofill(input))
    observer.observe(input, { attributes: true, attributeFilter: ['autocomplete', 'name'] })
    input._noAutofillObserver = observer
  }
}

function cleanupNoAutofill(element: HTMLElement): void {
  const input = (element.matches('input') ? element : element.querySelector('input')) as NoAutofillInput | null
  input?._noAutofillObserver?.disconnect()
}

const vNoAutofill = {
  mounted: stampNoAutofill,
  updated: stampNoAutofill,
  unmounted: cleanupNoAutofill,
}
const mapRef = ref<any>(null)
const mapInstanceKey = ref(0)
const isMapChunkFailed = ref(false)
let mapChunkTimeout: ReturnType<typeof setTimeout> | null = null
const MAP_CHUNK_TIMEOUT_MS = 8000

function clearMapChunkTimeout() {
  if (mapChunkTimeout) {
    clearTimeout(mapChunkTimeout)
    mapChunkTimeout = null
  }
}

function armMapChunkTimeout() {
  clearMapChunkTimeout()
  isMapChunkFailed.value = false
  if (typeof navigator !== 'undefined' && 'onLine' in navigator && !navigator.onLine) {
    isMapChunkFailed.value = true
    return
  }
  mapChunkTimeout = setTimeout(() => {
    // If the lazy-loaded map component chunk fails to load (offline on first render),
    // the ref never becomes available and the placeholder spinner would run forever.
    if (!mapRef.value) {
      isMapChunkFailed.value = true
    }
  }, MAP_CHUNK_TIMEOUT_MS)
}

function retryMapChunk() {
  mapInstanceKey.value += 1
  armMapChunkTimeout()
}

// Any geocoder API failure should flip the live map into its "Location
// unavailable" fallback — clicks on a broken map are misleading otherwise.
watch(
  [isGeocoderUnavailable, mapRef],
  ([isUnavailable]) => {
    if (isUnavailable) {
      mapRef.value?.markUnavailable?.()
    } else {
      mapRef.value?.markAvailable?.()
    }
  },
  { immediate: true },
)

watch(mapRef, (value) => {
  if (value) {
    clearMapChunkTimeout()
  }
})
let isReverseGeocoding = false
const addressSuggestions = ref([])
const isSearching = ref(false)
// True when a search (typed or pasted) returned no matches — flags the Street
// field red so the user fills the address fields manually.
const noAddressMatch = ref(false)
const autocompleteWrapperRef = ref<HTMLElement | null>(null)
const autocompleteOverlayStyle = computed(() => {
  const width = autocompleteWrapperRef.value?.offsetWidth
  return width ? { maxWidth: `${width-50}px` } : {}
})

const form = reactive({
  isShipping: true,
  isBilling: false,
  isDefaultShipping: false,
  isDefaultBilling: false,
  status: 'active',
  inactiveNote: '',
  country: null,
  street: '',
  unitSuite: '',
  city: '',
  state: null,
  postalCode: '',
  tags: [],
  latitude: null,
  longitude: null,
})

const errors = reactive({
  country: '',
  street: '',
  city: '',
  state: '',
  postalCode: '',
  inactiveNote: '',
})
useClearErrorsOnEdit(form, errors)
watch(() => form.isShipping, (isShipping) => { if (!isShipping) form.isDefaultShipping = false })
watch(() => form.isBilling, (isBilling) => { if (!isBilling) form.isDefaultBilling = false })

// Once the user starts filling the address by hand (any field below Street), the
// no-match error has done its job — clear it so the red doesn't linger after a
// valid manual entry.
watch(
  () => [form.city, form.state, form.postalCode, form.unitSuite],
  () => { if (noAddressMatch.value) { noAddressMatch.value = false } },
)

// Phase 1b: an address that is the ONLY one of its type must stay its default —
// you can't leave billing/shipping addresses with no default. Counts exclude the
// address being edited and are (re)loaded each time the drawer opens.
const otherBillingCount = ref(0)
const otherShippingCount = ref(0)

async function loadAddressTypeCounts() {
  otherBillingCount.value = 0
  otherShippingCount.value = 0
  if (!props.businessPartnerId) { return }
  const { data } = await fetchPartnerAddresses(props.businessPartnerId, { limit: -1 })
  const currentId = props.address?.id ?? null
  for (const junction of data ?? []) {
    if (junction.id === currentId) { continue }
    if (junction.is_billing_address) { otherBillingCount.value += 1 }
    if (junction.is_shipping_address) { otherShippingCount.value += 1 }
  }
}

// Is this address the partner's currently-saved default billing/shipping?
const isSavedDefaultBilling = computed(
  () => props.address?.id != null && props.address.id === props.defaultBillingJunctionId,
)
const isSavedDefaultShipping = computed(
  () => props.address?.id != null && props.address.id === props.defaultShippingJunctionId,
)

// Lock the "default" toggle on (can't be unchecked) when this address is the
// current default OR the only one of its type. A default is never removed by
// unchecking — it's moved by setting ANOTHER address as the default. This avoids
// the dead-end where unchecking a default snaps back on save.
const lockDefaultBilling = computed(
  () => form.isBilling && (otherBillingCount.value === 0 || isSavedDefaultBilling.value),
)
const lockDefaultShipping = computed(
  () => form.isShipping && (otherShippingCount.value === 0 || isSavedDefaultShipping.value),
)

function enforceDefaultLocks() {
  if (lockDefaultBilling.value) { form.isDefaultBilling = true }
  if (lockDefaultShipping.value) { form.isDefaultShipping = true }
}

// Re-apply when the user toggles the address type after the drawer is open.
watch([() => form.isBilling, () => form.isShipping], enforceDefaultLocks)

// Latitude/longitude are auto-derived by the geocoder (which runs async on
// open), so they're excluded from the dirty snapshot — otherwise a freshly
// opened address would read as dirty the moment geocoding resolves. The
// user-editable fields (incl. those updated by map drag / address search)
// fully capture intentional edits.
const {
  isDirty,
  showResumePrompt,
  markClosedAnyway,
  continueEditing,
  discardResume,
  markSaved,
} = useDrawerResumeGuard({
  isOpen: localVisible,
  recordKey: () => props.address?.id ?? null,
  snapshot: () => ({
    isShipping: form.isShipping,
    isBilling: form.isBilling,
    isDefaultShipping: form.isDefaultShipping,
    isDefaultBilling: form.isDefaultBilling,
    status: form.status,
    inactiveNote: form.inactiveNote,
    country: form.country,
    street: form.street,
    unitSuite: form.unitSuite,
    city: form.city,
    state: form.state,
    postalCode: form.postalCode,
    tags: form.tags,
  }),
  // Form population only — the map lifecycle / chunk timeout lives in a separate
  // always-run watch so it still fires when resuming preserved edits.
  populate: async () => {
    addressSuggestions.value = []
    noAddressMatch.value = false
    if (props.address) {
      isInitialLoad = true
      // Prefill the visible address content FIRST — synchronous, no network — so
      // the fields render immediately on edit. The address-type + default flags
      // below depend on a network count, so they settle a moment later.
      form.country = props.address.countryId || null
      form.street = props.address.street || ''
      form.unitSuite = props.address.unitSuite || ''
      form.city = props.address.city || ''
      form.postalCode = props.address.postalCode || ''
      form.tags = props.address.tags || []
      form.status = props.address.status || 'active'
      form.inactiveNote = props.address.inactiveNote || ''
      form.latitude = props.address.latitude ?? null
      form.longitude = props.address.longitude ?? null

      // Wait for regions to load before setting state
      if (props.address.countryId) {
        await loadRegions(props.address.countryId)
        form.state = props.address.regionId || null
      }
      nextTick(async () => {
        isInitialLoad = false

        // Auto-geocode if no saved coordinates
        if (form.latitude === null || form.longitude === null) {
          // No country → skip the Mapbox backfill (same guard as the address
          // search; holds even if the US default is ever removed).
          const selectedCountry = countryOptions.value.find((c) => c.id === form.country)
          if (form.street.trim() && form.city.trim() && selectedCountry) {
            const selectedRegion = regionOptions.value.find((r) => r.id === form.state)
            const coordinates = await geocodeAddress({
              street: form.street,
              city: form.city,
              state: selectedRegion?.name || '',
              postalCode: form.postalCode,
              country: selectedCountry.name || '',
            })
            if (coordinates) {
              form.latitude = coordinates.latitude
              form.longitude = coordinates.longitude
              mapRef.value?.flyTo(coordinates.latitude, coordinates.longitude)
            }
          }
        } else {
          mapRef.value?.flyTo(form.latitude, form.longitude)
          // Probe the geocoder so an API outage surfaces the "Location
          // unavailable" overlay immediately on edit open.
          reverseGeocodeAddress(form.latitude, form.longitude)
        }
      })

      // Count the partner's OTHER billing/shipping addresses (network) — needed
      // only for the default-lock rules, not for display — then set the type +
      // default flags. Kept before the flags so the reactive lock watcher and
      // enforceDefaultLocks() below both see the correct counts.
      await loadAddressTypeCounts()
      form.isShipping = props.address.isShipping ?? true
      form.isBilling = props.address.isBilling ?? false
      form.isDefaultShipping = props.address.id === props.defaultShippingJunctionId
      form.isDefaultBilling = props.address.id === props.defaultBillingJunctionId
    } else {
      // Create: no existing data to prefill, so keep counts first — they gate the
      // sole-of-type default lock — then seed the blank form.
      await loadAddressTypeCounts()
      isInitialLoad = true
      const usCountry = countryOptions.value.find((c) => c.name === 'United States')
      Object.assign(form, {
        // Supplier addresses are billing-only (no shipping toggle in the UI).
        isShipping: !props.isSupplier,
        isBilling: props.isSupplier,
        isDefaultShipping: false,
        isDefaultBilling: false,
        // New addresses are always active — the selector is shown disabled.
        status: 'active',
        inactiveNote: '',
        country: usCountry?.id || null,
        street: '',
        unitSuite: '',
        city: '',
        state: null,
        postalCode: '',
        tags: [],
        latitude: null,
        longitude: null,
      })
      if (usCountry) {
        await loadRegions(usCountry.id)
      }
      mapRef.value?.reset()
      isInitialLoad = false
    }

    // Force-on any default whose address is the only one of its type (covers
    // create defaults and edit's just-populated values); counts are loaded above.
    enforceDefaultLocks()
  },
})

// Full list — drives the id/name lookups below (geocode, reverse-geocode,
// US default), which must resolve any saved country regardless of status.
const countryOptions = computed(() => referenceData.countryOptions)
// The Country dropdown offers only SupplyHub-active countries. When editing an
// address whose saved country has since been deactivated, keep that one country
// in the list so the field shows its value instead of reading as empty.
const countrySelectOptions = computed(() => {
  const active = referenceData.activeCountryOptions
  if (form.country == null || active.some((country) => country.id === form.country)) {
    return active
  }
  const selected = countryOptions.value.find((country) => country.id === form.country)
  if (!selected) {
    return active
  }
  return [...active, selected].sort((a, b) => a.name.localeCompare(b.name))
})
const regionOptions = ref([])
const isLoadingRegions = ref(false)
// The selected country has states/regions to choose from. When it doesn't, the
// State/Region field is hidden and Postal Code shifts up to take its place; when
// it does, a state selection becomes required.
const hasRegions = computed(() => regionOptions.value.length > 0)

const tagPresets = ref<string[]>([])

// Module-scope cache — static schema metadata fetched once per session.
let tagPresetsCache: string[] | null = null
let tagPresetsPromise: Promise<string[]> | null = null

async function fetchTagPresets() {
  if (tagPresetsCache) {
    tagPresets.value = tagPresetsCache
    return
  }
  if (!tagPresetsPromise) {
    tagPresetsPromise = (async () => {
      const { data: field, error } = await tryCatch(
        (directus as any).request(readField('business_partners_addresses', 'tags')),
      )
      if (error) {
        if (isServerError(error)) {
          hasLoadError.value = true
        }
        return []
      }
      if (!field) return []
      const presets = (field as any)?.meta?.options?.presets
      return Array.isArray(presets)
        ? presets.filter((preset): preset is string => typeof preset === 'string')
        : []
    })()
  }
  const resolved = await tagPresetsPromise
  tagPresetsCache = resolved
  tagPresets.value = resolved
}

// Enter-to-add: PrimeVue's typeahead is disabled so no suggestion list ever
// opens. Push the trimmed input as a tag (case-insensitive dedupe against
// existing tags).
// Commit on Enter or Tab — Tab is supported because Enter reads as "submit".
// For Tab, only intercept when there's text to commit (so an empty field still
// tabs away); preventing the default keeps focus in the field for adding more.
function handleTagCommit(event: KeyboardEvent) {
  const input = event.target as HTMLInputElement | null
  if (!input) return
  if (event.key === 'Tab') {
    if (!input.value.trim()) return
    event.preventDefault()
  }
  setTimeout(() => {
    const value = input.value.trim()
    if (!value) return
    const normalized = value.toLowerCase()
    const exists = (form.tags as string[]).some((tag) => tag.toLowerCase() === normalized)
    if (!exists) {
      form.tags = [...(form.tags as string[]), value]
    }
    input.value = ''
  }, 0)
}

function isTagSelected(preset: string) {
  const normalized = preset.toLowerCase()
  return (form.tags as string[]).some((tag) => tag.toLowerCase() === normalized)
}

function addTagFromPreset(preset: string) {
  if (isTagSelected(preset)) return
  form.tags = [...(form.tags as string[]), preset]
}

// Kick off once per drawer instance; subsequent opens reuse the module-scope cache.
fetchTagPresets()

function formatRegionLabel(region) {
  if (region.code) {
    return `${region.name} (${region.code})`
  }
  return region.name
}

function loadRegions(countryId) {
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

// Track whether this is the initial population to avoid clearing state
let isInitialLoad = false

watch(
  () => form.country,
  (newCountryId, oldCountryId) => {
    if (newCountryId) {
      loadRegions(newCountryId)
    } else {
      regionOptions.value = []
    }
    // Only clear state when user manually changes country, not on initial population
    if (!isInitialLoad && oldCountryId !== null && newCountryId !== oldCountryId) {
      form.state = null
    }
  },
)

// Geocode when address fields change
watch(
  () => [form.street, form.city, form.state, form.postalCode, form.country],
  async () => {
    if (isInitialLoad || isReverseGeocoding) {
      return
    }
    if (!form.street.trim() || !form.city.trim()) {
      return
    }

    const selectedCountry = countryOptions.value.find((c) => c.id === form.country)
    // No country → no Mapbox call (same guard as the address search; holds even
    // if the US default is ever removed).
    if (!selectedCountry) { return }
    const selectedRegion = regionOptions.value.find((r) => r.id === form.state)

    const coordinates = await geocodeAddressDebounced({
      street: form.street,
      city: form.city,
      state: selectedRegion?.name || '',
      postalCode: form.postalCode,
      country: selectedCountry?.name || '',
    })

    if (coordinates) {
      form.latitude = coordinates.latitude
      form.longitude = coordinates.longitude
      mapRef.value?.flyTo(coordinates.latitude, coordinates.longitude)
    }
  },
)

// Map lifecycle + transient UI state — must run on EVERY open/close (including
// when resuming preserved edits), so it stays outside the resume guard's
// populate(). Form population is handled by the guard.
watch(
  () => props.visible,
  (isOpen) => {
    submitted.value = false
    hasLoadError.value = false
    Object.assign(errors, { country: '', street: '', city: '', state: '', postalCode: '', inactiveNote: '' })

    if (isOpen) {
      armMapChunkTimeout()
    } else {
      clearMapChunkTimeout()
      isMapChunkFailed.value = false
    }
  },
)

function validateForm() {
  let isValid = true
  Object.assign(errors, { country: '', street: '', city: '', state: '', postalCode: '', inactiveNote: '' })

  if (!form.country) {
    errors.country = 'Country is required'
    isValid = false
  }
  if (!form.street.trim()) {
    errors.street = 'Street is required'
    isValid = false
  }
  if (!form.city.trim()) {
    errors.city = 'City is required'
    isValid = false
  }
  // State/Region is required only when the selected country has regions to pick
  // from (the field is hidden otherwise).
  if (hasRegions.value && !form.state) {
    errors.state = 'State/Region is required'
    isValid = false
  }
  if (!form.postalCode.trim()) {
    errors.postalCode = 'Postal code is required'
    isValid = false
  }
  // Inactive addresses must carry a reason (backend-required; maps to the SAP
  // U_SupplyHub_InactiveNote UDF). Only reachable in edit mode — new addresses
  // are always active.
  if (form.status === 'inactive' && !form.inactiveNote.trim()) {
    errors.inactiveNote = 'Inactive note is required'
    isValid = false
  }

  return isValid
}

async function onSave() {
  submitted.value = true
  if (!validateForm()) {
    return
  }

  isSaving.value = true

  if (isEditMode.value) {
    await handleEdit()
  } else {
    await handleCreate()
  }

  isSaving.value = false
}

async function handleCreate() {
  // Addresses store proper-case (CONNECT-602); postal code stays uppercase
  // (conventionally case-insensitive).
  const addressPayload: Record<string, any> = {
    street_line_1: form.street.trim(),
    city: form.city.trim(),
    postal_code: form.postalCode.trim().toUpperCase(),
    countries_id: form.country,
    regions_id: form.state || null,
    latitude: form.latitude,
    longitude: form.longitude,
  }

  const unitSuite = form.unitSuite.trim()
  if (unitSuite) {
    addressPayload.street_line_2 = unitSuite
  }

  // Nested under the business_partner so the SAP sync flow (which triggers on
  // business_partners updates) picks the address up.
  const { error } = await updateBusinessPartner(props.businessPartnerId!, {
    addresses: {
      create: [
        {
          is_shipping_address: form.isShipping,
          is_billing_address: form.isBilling,
          status: form.status,
          inactive_note: form.status === 'inactive' ? form.inactiveNote.trim() : null,
          tags: form.tags,
          addresses_id: addressPayload,
        },
      ],
    },
  })

  if (error) {
    toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
    return
  }
  // Resolve defaults from the fresh list so the first billing/shipping address
  // auto-becomes its own default; an explicit "default" choice for the new
  // address wins. (The nested create doesn't return the junction id, so the
  // newest junction by id is the one we just added.)
  const { data: partnerAddresses } = await fetchPartnerAddresses(props.businessPartnerId!, { limit: -1 })
  const junctions = (partnerAddresses ?? []) as AddressDefaultJunction[]
  const newestJunctionId = junctions.reduce(
    (maxId, address) => (address.id > maxId ? address.id : maxId),
    0,
  )
  const defaultUpdates = resolveAddressDefaultUpdates(
    junctions,
    {
      billing: props.defaultBillingJunctionId ?? null,
      shipping: props.defaultShippingJunctionId ?? null,
    },
    {
      billing: form.isDefaultBilling ? newestJunctionId : undefined,
      shipping: form.isDefaultShipping ? newestJunctionId : undefined,
    },
  )
  if (Object.keys(defaultUpdates).length) {
    await updateBusinessPartner(props.businessPartnerId!, defaultUpdates)
  }

  toast.add({ severity: 'success', summary: 'Success', detail: 'Address created successfully', life: 3000 })
  markSaved()
  emit('saved', { mode: 'create' })
  localVisible.value = false
}
type AddressDefaultJunction = { id: number, is_billing_address?: boolean, is_shipping_address?: boolean }

// Enforce "if addresses of a type exist, exactly one is its default" from the
// fresh junction list: pick the user's explicit choice, else keep the current
// valid default, else the first by sort; none of that type → null. Returns only
// the pointers that changed so we never write a no-op. This single rule covers
// auto-defaulting the first billing/shipping address, refusing to leave the last
// one un-defaulted, and auto-promoting another when the default is removed.
function resolveAddressDefaultUpdates(
  junctions: AddressDefaultJunction[],
  current: { billing: number | null, shipping: number | null },
  prefer: { billing?: number | null, shipping?: number | null } = {},
): Record<string, number | null> {
  const pick = (
    isType: (junction: AddressDefaultJunction) => boolean,
    currentId: number | null,
    preferId: number | null | undefined,
  ): number | null => {
    const candidates = junctions.filter(isType)
    if (!candidates.length) { return null }
    if (preferId && candidates.some(junction => junction.id === preferId)) { return preferId }
    if (currentId && candidates.some(junction => junction.id === currentId)) { return currentId }
    return candidates[0]!.id // list is pre-sorted by addresses_sort, id
  }

  const billing = pick(junction => Boolean(junction.is_billing_address), current.billing, prefer.billing)
  const shipping = pick(junction => Boolean(junction.is_shipping_address), current.shipping, prefer.shipping)

  const payload: Record<string, number | null> = {}
  if (billing !== current.billing) { payload.default_billing_business_partners_addresses_id = billing }
  if (shipping !== current.shipping) { payload.default_shipping_business_partners_addresses_id = shipping }
  return payload
}

// Re-fetch the partner's addresses and persist any default-pointer changes the
// invariant requires. `preferJunctionId` + `explicit` carry the user's "make
// this the default billing/shipping" choice for a specific junction.
async function syncAddressDefaults(
  preferJunctionId: number | null,
  explicit: { billing: boolean, shipping: boolean },
) {
  const { data: partnerAddresses } = await fetchPartnerAddresses(props.businessPartnerId!, { limit: -1 })
  const updates = resolveAddressDefaultUpdates(
    (partnerAddresses ?? []) as AddressDefaultJunction[],
    {
      billing: props.defaultBillingJunctionId ?? null,
      shipping: props.defaultShippingJunctionId ?? null,
    },
    {
      billing: explicit.billing ? preferJunctionId : undefined,
      shipping: explicit.shipping ? preferJunctionId : undefined,
    },
  )
  if (Object.keys(updates).length) {
    await updateBusinessPartner(props.businessPartnerId!, updates)
  }
}

async function handleEdit() {
  const unitSuite = form.unitSuite.trim()

  const { error } = await updateBusinessPartner(props.businessPartnerId!, {
    addresses: {
      update: [
        {
          id: props.address.id,
          is_shipping_address: form.isShipping,
          is_billing_address: form.isBilling,
          status: form.status,
          inactive_note: form.status === 'inactive' ? form.inactiveNote.trim() : null,
          tags: form.tags,
          addresses_id: {
            id: props.address.addressId,
            street_line_1: form.street.trim(),
            street_line_2: unitSuite || '',
            city: form.city.trim(),
            postal_code: form.postalCode.trim().toUpperCase(),
            countries_id: form.country,
            regions_id: form.state || null,
            latitude: form.latitude,
            longitude: form.longitude,
          },
        },
      ],
    },
  })

  if (error) {
    toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
    return
  }

  await syncAddressDefaults(props.address.id, {
    billing: form.isDefaultBilling,
    shipping: form.isDefaultShipping,
  })

  toast.add({ severity: 'success', summary: 'Success', detail: 'Address updated successfully', life: 3000 })
  markSaved()
  emit('saved', { mode: 'update', id: props.address.id })
  localVisible.value = false
}

async function handleMarkerDragEnd({ latitude, longitude }) {
  const addressParts = await reverseGeocodeAddress(latitude, longitude)
  if (!addressParts) {
    return
  }

  // Reverse-geocode succeeded, so the click/drag produced a valid location —
  // place the marker now. (Click events intentionally don't place a marker
  // eagerly so we don't get a flash-and-remove effect when the API is down.)
  mapRef.value?.placeMarker?.(latitude, longitude)

  isReverseGeocoding = true

  form.street = addressParts.street
  form.city = addressParts.city
  form.postalCode = addressParts.postalCode

  const matchedCountry = countryOptions.value.find(
    (c) => c.name.toLowerCase() === addressParts.country.toLowerCase(),
  )
  if (matchedCountry) {
    form.country = matchedCountry.id
    await loadRegions(matchedCountry.id)

    const matchedRegion = regionOptions.value.find(
      (r) => r.name.toLowerCase() === addressParts.state.toLowerCase(),
    )
    if (matchedRegion) {
      form.state = matchedRegion.id
    }
  }

  nextTick(() => { isReverseGeocoding = false })
}

async function onAddressSearch(event) {
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
  const selectedCountry = countryOptions.value.find((c) => c.id === form.country)
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
  // No validated match → prompt the user to complete the fields manually.
  noAddressMatch.value = suggestions.length === 0
  isSearching.value = false
}

// When a pasted address resolves to a spot Mapbox can't pin precisely (common for
// rural PR streets), the customer's business may still exist as an exact POI. If
// we know the name, look it up and — when the business sits in the same city/ZIP
// the pasted address resolved to — surface that exact pin at the top so the paste
// auto-applies it instead of the imprecise street. The city/ZIP corroboration
// keeps a genuinely different-location address from snapping to the main site.
async function preferBusinessPoiForPaste() {
  const name = props.businessPartnerName?.trim()
  const topAddress = addressSuggestions.value[0]
  // The business pin is only a FALLBACK. If the address search already found a
  // precise (house-number) match, trust it and don't override with the POI —
  // only step in when the best match is street-level or absent.
  if (
    !name
    || !topAddress
    || topAddress.isPreciseAddress
    || topAddress.isBusiness
  ) {
    return
  }

  const selectedCountry = countryOptions.value.find((c) => c.id === form.country)
  const nameResults = await searchAddresses(name, {
    country: selectedCountry?.code || null,
    proximity: locationStore.coordinates,
  })
  const poi = nameResults.find((suggestion) => suggestion.isBusiness)
  if (!poi) { return }

  const sameZip = !!poi.postalCode && poi.postalCode === topAddress.postalCode
  const sameCity = !!poi.city && poi.city.toLowerCase() === topAddress.city.toLowerCase()
  if (sameZip || sameCity) {
    addressSuggestions.value = [poi, ...addressSuggestions.value]
  }
}

// Users often paste a full address copied from another system (e.g. Shopify),
// which arrives multi-line. A single-line input mangles newlines, so flatten the
// paste into a clean comma-separated query and run the address search on it. The
// pasted text still lands in the Street field, so if nothing matches the user can
// edit it and fill the remaining fields by hand.
async function onAddressPaste(event) {
  const pasted = event.clipboardData?.getData('text') ?? ''
  if (!pasted.includes('\n') && pasted.trim().length < 3) {
    return
  }
  const normalized = pasted
    .replace(/[\r\n]+/g, ', ') // newlines → comma separators
    .replace(/\s{2,}/g, ' ') // collapse runs of whitespace
    .replace(/\s*,\s*(?:,\s*)+/g, ', ') // dedupe stacked commas
    .replace(/^[,\s]+|[,\s]+$/g, '') // trim stray leading/trailing commas
    .trim()
  if (!normalized) {
    return
  }
  event.preventDefault()

  // Suppress the field-change geocoder while we resolve this paste. Writing the
  // Street field otherwise schedules a debounced background geocode of the raw
  // pasted text — and on a repeat paste the City is already filled, so it geocodes
  // the full "street + city" string (which Mapbox mis-pins for rural PR) and lands
  // ~500ms later, overwriting the precise coordinates applied below. The paste sets
  // coordinates itself via the applied suggestion, so this geocode is unwanted.
  // applyAddressSuggestion clears the guard on its own; the no-match branch too.
  isReverseGeocoding = true
  form.street = normalized
  await onAddressSearch({ query: normalized })
  // Prefer the customer's exact business pin when it matches where the pasted
  // address resolves — Mapbox often can't pin a rural street but has the POI.
  await preferBusinessPoiForPaste()
  // A pasted address is meant to populate the form, not just open a dropdown:
  // auto-apply the best match. The remaining suggestions stay available so the
  // user can pick a different one if the top guess is wrong; if there were no
  // matches, the manual-entry nudge (noAddressMatch) is already showing.
  if (addressSuggestions.value.length > 0) {
    await applyAddressSuggestion(addressSuggestions.value[0])
  } else {
    nextTick(() => { isReverseGeocoding = false })
  }
}

// Fill the form from a chosen/validated Mapbox suggestion: structured fields, the
// region mapped to its Directus reference id, coordinates, and the map pin. The
// country is left as the user selected it.
async function applyAddressSuggestion(selected) {
  if (!selected || typeof selected === 'string') {
    return
  }

  noAddressMatch.value = false
  isReverseGeocoding = true

  form.street = selected.street
  form.city = selected.city
  form.postalCode = selected.postalCode
  form.latitude = selected.latitude
  form.longitude = selected.longitude

  // Country is intentionally preserved — a pasted or selected suggestion never
  // changes the country the user chose. Only map the returned region within the
  // already-selected country's regions.
  await loadRegions(form.country)

  const matchedRegion = regionOptions.value.find(
    (r) => r.name.toLowerCase() === selected.state.toLowerCase(),
  )
  if (matchedRegion) {
    form.state = matchedRegion.id
  }

  mapRef.value?.flyTo(selected.latitude, selected.longitude)

  nextTick(() => { isReverseGeocoding = false })
}

function onAddressSelect(event) {
  applyAddressSuggestion(event.value)
}

function onCancel() {
  localVisible.value = false
}

async function onDelete() {
  if (!confirm('Are you sure you want to remove this address?')) {
    return
  }

  isSaving.value = true
  const { error } = await updateBusinessPartner(props.businessPartnerId!, {
    addresses: { delete: [props.address.id] },
  })

  if (error) {
    isSaving.value = false
    toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
    return
  }

  // If the deleted address was the default billing/shipping, auto-promote
  // another of that type (and clear the pointer when none remain).
  await syncAddressDefaults(null, { billing: false, shipping: false })
  isSaving.value = false

  toast.add({ severity: 'success', summary: 'Success', detail: 'Address removed successfully', life: 3000 })
  markSaved()
  emit('saved', { mode: 'delete', id: props.address.id })
  localVisible.value = false
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="isEditMode ? (isSupplier ? 'Billing Address' : 'Shipping/Billing Address') : 'Add Address'"
    title-size="xl"
    :has-error="hasLoadError"
    :dirty="isDirty"
    :busy="isSaving"
    :show-resume-prompt="showResumePrompt"
    @save="onSave"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
      <div class="checkbox-grid">
        <!-- Shipping toggles are customer-only; suppliers have billing-only
             addresses, so the two billing checkboxes sit in one row. -->
        <div
          v-if="!isSupplier"
          class="checkbox-field"
        >
          <Checkbox
            v-model="form.isShipping"
            inputId="isShipping"
            :binary="true"
          />
          <label
            for="isShipping"
            class="checkbox-field__label"
          >Shipping Address</label>
        </div>
        <div class="checkbox-field">
          <Checkbox
            v-model="form.isBilling"
            inputId="isBilling"
            :binary="true"
          />
          <label
            for="isBilling"
            class="checkbox-field__label"
          >Billing Address</label>
        </div>
        <!-- "Set as default" enables only once its address type is selected. -->
        <div
          v-if="!isSupplier"
          class="checkbox-field"
          :class="{ 'checkbox-field--disabled': !form.isShipping || lockDefaultShipping }"
        >
          <Checkbox
            v-model="form.isDefaultShipping"
            inputId="isDefaultShipping"
            :binary="true"
            :disabled="!form.isShipping || lockDefaultShipping"
          />
          <label
            for="isDefaultShipping"
            class="checkbox-field__label"
            v-tooltip.top="lockDefaultShipping ? (otherShippingCount === 0 ? 'The only shipping address must stay the default.' : 'Set another address as the default shipping address to change it.') : ''"
          >Set as default shipping address</label>
        </div>
        <div
          class="checkbox-field"
          :class="{ 'checkbox-field--disabled': !form.isBilling || lockDefaultBilling }"
        >
          <Checkbox
            v-model="form.isDefaultBilling"
            inputId="isDefaultBilling"
            :binary="true"
            :disabled="!form.isBilling || lockDefaultBilling"
          />
          <label
            for="isDefaultBilling"
            class="checkbox-field__label"
            v-tooltip.top="lockDefaultBilling ? (otherBillingCount === 0 ? 'The only billing address must stay the default.' : 'Set another address as the default billing address to change it.') : ''"
          >Set as default billing address</label>
        </div>
      </div>

      <!-- Status — editable only when editing an existing address. New addresses
           are always Active (the radios render disabled), matching the "why create
           an inactive address" rule. -->
      <div class="form-row form-row--full">
        <div class="form-field">
          <span class="form-field__label">Status</span>
          <div class="radio-group">
            <div class="radio-option">
              <RadioButton
                v-model="form.status"
                input-id="addressStatusActive"
                value="active"
                :disabled="!isEditMode"
              />
              <label
                for="addressStatusActive"
                class="radio-option__label"
              >Active</label>
            </div>
            <div class="radio-option">
              <RadioButton
                v-model="form.status"
                input-id="addressStatusInactive"
                value="inactive"
                :disabled="!isEditMode"
              />
              <label
                for="addressStatusInactive"
                class="radio-option__label"
              >Inactive</label>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="form.status === 'inactive'"
        class="form-row form-row--full"
      >
        <div class="form-field">
          <div class="form-field__label-row">
            <label
              class="form-field__label form-field__label--required"
            >Inactive Note</label>
            <BaseCharCounter
              :value="form.inactiveNote"
              :max="limitForJunction('inactive_note')"
            />
          </div>
          <Textarea
            v-model="form.inactiveNote"
            v-trim
            placeholder="Reason for marking inactive"
            :rows="3"
            fluid
            :invalid="submitted && !!errors.inactiveNote"
          />
          <span
            v-if="submitted && errors.inactiveNote"
            class="form-field__error"
          >{{ errors.inactiveNote }}</span>
        </div>
      </div>

      <div class="form-row form-row--full">
        <div class="form-field">
          <label
            class="form-field__label form-field__label--required"
          >Country</label>
          <Select
            v-model="form.country"
            :options="countrySelectOptions"
            option-label="name"
            option-value="id"
            placeholder="Select a country"
            filter
            fluid
            :invalid="submitted && !!errors.country"
            panel-class="address-select-panel"
          />
          <span
            v-if="submitted && errors.country"
            class="form-field__error"
          >{{ errors.country }}</span>
        </div>
      </div>

      <div class="form-row form-row--full">
        <div class="form-field">
          <div class="form-field__label-row">
            <label
              class="form-field__label form-field__label--required"
            >Street</label>
            <BaseCharCounter :value="form.street" :max="limitFor('street_line_1')" />
          </div>
          <div
            ref="autocompleteWrapperRef"
            class="autocomplete-icon-wrapper"
          >
            <i class="pi pi-map-marker autocomplete-icon" />
            <AutoComplete
              v-model="form.street"
              v-no-autofill
              :suggestions="addressSuggestions"
              option-label="label"
              fluid
              :delay="300"
              :min-length="3"
              :loading="isSearching"
              :invalid="noAddressMatch || (submitted && !!errors.street)"
              :overlay-style="autocompleteOverlayStyle"
              :pt="AUTOFILL_OFF_PT"
              placeholder="Paste or type a full address"
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
          <span
            v-if="noAddressMatch"
            class="form-field__error"
          >No match found — enter the address in the fields below.</span>
          <span
            v-if="submitted && errors.street"
            class="form-field__error"
          >{{ errors.street }}</span>
        </div>
      </div>

      <div class="form-row form-row--full">
        <div class="form-field">
          <div class="form-field__label-row">
            <label class="form-field__label">Unit/Suite</label>
            <BaseCharCounter :value="form.unitSuite" :max="limitFor('street_line_2')" />
          </div>
          <BaseClearableInput
            v-model="form.unitSuite"
            v-trim
            v-no-autofill
            fluid
            v-bind="AUTOFILL_OFF"
          />
        </div>
      </div>

      <!-- City / State-Region / Postal in one auto-flow grid: when the country
           has regions it reads [City | State] then [Postal | _]; when it has
           none, State is hidden and Postal flows up into its cell → [City | Postal]. -->
      <div class="form-row-2 form-row-2--address">
        <div class="form-field">
          <div class="form-field__label-row">
            <label
              class="form-field__label form-field__label--required"
            >City</label>
            <BaseCharCounter :value="form.city" :max="limitFor('city')" />
          </div>
          <BaseClearableInput
            v-model="form.city"
            v-trim
            v-no-autofill
            fluid
            :invalid="submitted && !!errors.city"
            v-bind="AUTOFILL_OFF"
          />
          <span
            v-if="submitted && errors.city"
            class="form-field__error"
          >{{ errors.city }}</span>
        </div>
        <div
          v-if="hasRegions"
          class="form-field"
        >
          <label class="form-field__label form-field__label--required">State/Region</label>
          <Select
            v-model="form.state"
            :options="regionOptions"
            option-label="displayLabel"
            option-value="id"
            placeholder="Select a state"
            filter
            fluid
            :loading="isLoadingRegions"
            :invalid="submitted && !!errors.state"
            panel-class="address-select-panel"
          />
          <span
            v-if="submitted && errors.state"
            class="form-field__error"
          >{{ errors.state }}</span>
        </div>
        <div class="form-field">
          <div class="form-field__label-row">
            <label class="form-field__label form-field__label--required">Postal Code</label>
            <BaseCharCounter :value="form.postalCode" :max="limitFor('postal_code')" />
          </div>
          <BaseClearableInput
            v-model="form.postalCode"
            v-trim
            v-no-autofill
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            fluid
            :invalid="submitted && !!errors.postalCode"
            v-bind="AUTOFILL_OFF"
          />
          <span
            v-if="submitted && errors.postalCode"
            class="form-field__error"
          >{{ errors.postalCode }}</span>
        </div>
      </div>

      <div class="form-row form-row--full">
        <div class="form-field">
          <label class="form-field__label">Tags</label>
          <AutoComplete
            v-model="form.tags"
            multiple
            fluid
            :typeahead="false"
            @keydown.enter="handleTagCommit"
            @keydown.tab="handleTagCommit"
          >
            <template #chip="{ value, removeCallback }">
              <span class="tag-chip">
                <span>{{ value }}</span>
                <i
                  class="pi pi-times tag-chip__remove icon-hit-area"
                  role="button"
                  tabindex="0"
                  aria-label="Remove tag"
                  @click="removeCallback"
                  @keydown.enter.space.prevent="removeCallback"
                />
              </span>
            </template>
          </AutoComplete>
          <div v-if="tagPresets.length" class="tag-preset-buttons">
            <Button
              v-for="preset in tagPresets"
              :key="preset"
              :label="preset"
              size="small"
              severity="secondary"
              :disabled="isTagSelected(preset)"
              @click="addTagFromPreset(preset)"
            />
          </div>
        </div>
      </div>

      <!-- Map — lazy-loaded to keep mapbox-gl out of the main bundle -->
      <div class="map-placeholder">
        <LazyBaseMapbox
          ref="mapRef"
          :key="mapInstanceKey"
          :latitude="form.latitude"
          :longitude="form.longitude"
          @update:latitude="form.latitude = $event"
          @update:longitude="form.longitude = $event"
          @dragend="handleMarkerDragEnd"
        />
        <div
          v-if="!isMapChunkFailed && !mapRef?.isMapReady && !mapRef?.mapLoadFailed"
          class="map-placeholder__loader"
        >
          <BaseSpinner size="md" />
        </div>
        <div
          v-else-if="isMapChunkFailed && !mapRef"
          class="map-placeholder__error"
        >
          <svg
            class="map-placeholder__error-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M17 9c0 1.06-.39 2.32-1 3.62l1.49 1.49C18.37 12.36 19 10.57 19 9c0-3.87-3.13-7-7-7-1.84 0-3.5.71-4.75 1.86l1.43 1.43C9.56 4.5 10.72 4 12 4c2.76 0 5 2.24 5 5zm-5-2.5c-.59 0-1.13.21-1.56.56l3.5 3.5c.35-.43.56-.97.56-1.56 0-1.38-1.12-2.5-2.5-2.5zM3.41 2.86 2 4.27l3.18 3.18C5.07 7.95 5 8.47 5 9c0 5.25 7 13 7 13s1.67-1.85 3.38-4.35L18.73 21l1.41-1.41L3.41 2.86zM12 18.88C9.99 16.3 7.2 12.14 7.02 9.29l6.92 6.92c-.65.98-1.33 1.89-1.94 2.67z" />
          </svg>
          <div class="map-placeholder__error-text">Location unavailable</div>
          <Button
            label="Retry"
            severity="secondary"
            size="small"
            icon="pi pi-refresh"
            @click="retryMapChunk"
          />
        </div>
      </div>

    <template #footer>
      <BaseActionButtons
        :show-destructive="isEditMode"
        :save-loading="isSaving"
        :save-disabled="isSaving"
        @save="onSave"
        @cancel="onCancel"
        @delete="onDelete"
      />
    </template>
  </BaseDrawer>
</template>

<style scoped>
/* Body gap — responsive override */
:deep(.drawer-body) {
    @media (min-width: 768px) {
        gap: var(--p-spacing-5);
    }
}

.checkbox-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--p-spacing-4);

    @media (min-width: 768px) {
        gap: var(--p-spacing-4) var(--p-spacing-6);
    }
}

.checkbox-field--disabled .checkbox-field__label {
    color: var(--p-text-muted-color);
    cursor: not-allowed;
}

.form-row--full {
    grid-template-columns: 1fr;
}

.form-row--full .form-field {
    width: 100%;
}

/* Form rows — stack on mobile, 2-column on desktop */
.form-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-3);
}

.form-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--p-spacing-3);
}

/* City / State-Region / Postal share one grid so Postal auto-flows into the
   State cell when it's hidden. When both rows are present, keep the vertical
   gap matching the drawer body's field rhythm (not the tighter column gap). */
.form-row-2--address {
    row-gap: var(--p-spacing-4);

    @media (min-width: 768px) {
        row-gap: var(--p-spacing-5);
    }
}

.form-row > .form-field, .form-row-2 > .form-field {
    min-width: 0;
}

.form-field {
    gap: var(--p-spacing-1);
}

.form-field--narrow {
    width: 100%;

    @media (min-width: 768px) {
        width: 220px;
    }
}

.autocomplete-icon-wrapper {
    position: relative;
}

.autocomplete-icon {
    position: absolute;
    left: auto;
    right: var(--p-spacing-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--p-text-muted-color);
    z-index: 1;
    pointer-events: none;

    @media (min-width: 768px) {
        left: var(--p-spacing-3);
        right: auto;
    }
}

.autocomplete-icon-wrapper :deep(.p-autocomplete-input) {
    padding-left: var(--p-spacing-3);
    padding-right: var(--p-spacing-8);

    @media (min-width: 768px) {
        padding-left: var(--p-spacing-8);
        padding-right: var(--p-spacing-3);
    }
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

.map-placeholder {
    position: relative;
    width: 100%;
    height: 300px;
    border-radius: var(--p-border-radius-sm);
    overflow: hidden;
}

.map-placeholder__loader {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--p-surface-100);
}

.map-placeholder__error {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-3);
    background: var(--p-surface-100);
}

.map-placeholder__error-icon {
    width: var(--p-font-size-5xl);
    height: var(--p-font-size-5xl);
    color: var(--p-surface-500);
}

.map-placeholder__error-text {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-surface-700);
}

/* Tags AutoComplete: custom chip + preset buttons */
.tag-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
    padding: var(--p-spacing-1) var(--p-spacing-2);
    border-radius: var(--p-border-radius-md);
    background: var(--p-skyblue-50);
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-medium);
}

.tag-chip__remove {
    cursor: pointer;
    font-size: var(--p-font-size-xs);
    color: var(--p-deepblue-900);
}

.tag-preset-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--p-spacing-2);
    margin-top: var(--p-spacing-1);

    button {
      height: var(--p-spacing-7);
      border-color: var(--p-skyblue-50);
      font-size: var(--p-font-size-xs);
      background: var(--p-skyblue-50);
      color: var(--p-deepblue-900);
    }

    button:hover:not(:disabled) {
      background: var(--p-skyblue-500);
      color: var(--p-neutral-0);
    }
}
</style>
