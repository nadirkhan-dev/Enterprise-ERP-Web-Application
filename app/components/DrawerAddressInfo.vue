<script setup lang="ts">
import type { ComparableAddress } from '~/utils/addressDuplicates'

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
  /** The page's junction → row mapper, used to show a blocking match read-only. */
  mapAddresses?: ((rawAddresses: any[]) => any[]) | null
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  address: null,
  businessPartnerId: null,
  businessPartnerName: null,
  defaultShippingJunctionId: null,
  defaultBillingJunctionId: null,
  isSupplier: false,
  mapAddresses: null,
})
const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: [payload?: { mode: 'create' | 'update' | 'delete'; record?: Record<string, any>; id?: number | string }]
}>()

const toast = useToast()
const directus = useDirectus()
const {
  updateBusinessPartner,
  fetchPartnerAddresses,
  createPartnerAddress,
  updatePartnerAddress,
  removePartnerAddress,
} = useBusinessPartners()
const { updateAddress } = useAddresses()
const referenceData = useReferenceDataStore()
// Character-limit counters (CONNECT-536) — Directus soft limits for `addresses`.
const { limitFor } = useCharLimits('addresses')
// inactive_note lives on the junction, not the addresses collection.
const { limitFor: limitForJunction } = useCharLimits('business_partners_addresses')

// Status and its note are separate field grants on that same junction, and each
// control disables on its own: a status-only user may still flip the status —
// the junction PATCH then omits the note field they cannot write. Both read
// false until resolved, leaving the controls disabled rather than offering a
// toggle Directus would refuse on save.
const { loadStatusFieldRights, getStatusFieldRights } = usePermissions()
loadStatusFieldRights()

const canEditStatus = computed(() => getStatusFieldRights('business_partners_addresses').status)
const canEditInactiveNote = computed(() => getStatusFieldRights('business_partners_addresses').inactiveNote)

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const isEditMode = computed(() => props.address !== null)

// "Shipping/Billing Address", "Billing Address", "Shipping Address", or '' for an
// untyped (legacy / SAP-synced) row.
function getAddressTypeLabel(isShipping: boolean, isBilling: boolean): string {
  if (isShipping && isBilling) return 'Shipping/Billing Address'
  if (isBilling) return 'Billing Address'
  if (isShipping) return 'Shipping Address'
  return ''
}
// The edit header names the address type of the record being opened (suppliers
// are billing-only, customers can be shipping, billing, or both). It reads the
// saved address rather than the form so toggling the checkboxes mid-edit doesn't
// rewrite the title.
const drawerTitle = computed(() => {
  // Suppliers have no shipping addresses, so a new one is always billing;
  // a customer picks the type in the form, so the create header stays generic.
  if (!isEditMode.value) return props.isSupplier ? 'Add Billing Address' : 'Add Address'
  const typeLabel = getAddressTypeLabel(props.address.isShipping ?? true, props.address.isBilling ?? false)
  if (typeLabel) return `Edit ${typeLabel}`
  // Untyped rows (legacy / SAP-synced) fall back to the partner's own default:
  // supplier addresses are billing-only.
  return props.isSupplier ? 'Edit Billing Address' : 'Edit Address'
})
const isSaving = ref(false)
const submitted = ref(false)
const hasLoadError = ref(false)

// Creating a new address runs the same stepped duplicate-check flow as contact /
// customer creation (DuplicateCheck.vue): Enter Details → Duplicate Check →
// Confirm & Create. The middle step only appears when the entered address matches
// an existing one on the account (all fields equal); otherwise Next skips it and
// goes straight to Confirm. Editing starts as a single step (Save / Cancel /
// Delete); only when Save finds that a changed address now matches another one on
// the account does it enter the same review, ending in Confirm & Save.
const currentStep = ref(1)
const addressSteps = computed(() => [
  { number: 1, label: 'Enter Details' },
  { number: 2, label: 'Duplicate Check' },
  { number: 3, label: isEditMode.value ? 'Confirm & Save' : 'Confirm & Create' },
])
const isCheckingDuplicates = ref(false)
// Confirm step reuses AddressFormFields (the same component the contact confirm
// uses for its address sections) behind a section-header Edit / Apply / Cancel,
// exactly like ConfirmCreate's Shipping Address. editingAddressConfirm gates the
// fields; the backup restores them on Cancel. lastCheckedAddressKey records the
// address the duplicate check last ran against, so an edit here is re-checked
// before the write rather than silently creating a now-duplicate address.
const editingAddressConfirm = ref(false)
const confirmBackup = ref<Record<string, any> | null>(null)
const lastCheckedAddressKey = ref('')
// Confirm-step acknowledgment — the Create button stays disabled until the user
// confirms the address is accurate, matching the contact confirm's verify gate.
const verifiedAccurate = ref(false)

// Snapshot / restore the address slice of the form, matching ConfirmCreate's
// snapshotAddress + Object.assign-on-cancel pattern.
function startEditAddressConfirm(): void {
  // Editing invalidates the acknowledgment — the user must re-confirm afterwards.
  verifiedAccurate.value = false
  confirmBackup.value = {
    country: form.country,
    street: form.street,
    unitSuite: form.unitSuite,
    city: form.city,
    state: form.state,
    postalCode: form.postalCode,
    latitude: form.latitude,
    longitude: form.longitude,
  }
  editingAddressConfirm.value = true
}

function applyAddressConfirm(): void {
  confirmBackup.value = null
  editingAddressConfirm.value = false
}

function cancelAddressConfirm(): void {
  if (confirmBackup.value) {
    Object.assign(form, confirmBackup.value)
    confirmBackup.value = null
  }
  editingAddressConfirm.value = false
}
// Exact-match address junctions surfaced in the review step, and the user's
// per-row "not a duplicate" dismissals (keyed by junction id). Save is gated
// until every surfaced row is dismissed — mirroring the contact flow.
const addressDuplicateList = ref<{ id: number | string, [key: string]: any }[]>([])
const addressRowSelections = ref<Record<string, string>>({})
// The exact match (every field equal, blanks included) the backend won't allow a
// second copy of. Several can exist on legacy data, so pick the most recently
// added (highest junction id) so the same address is shown every time.
const blockingAddressMatch = computed(() => {
  const blockingRows = addressDuplicateList.value.filter((row) => row.isBlocking)
  if (blockingRows.length === 0) { return null }
  return [...blockingRows].sort((rowA, rowB) => Number(rowB.id) - Number(rowA.id))[0] ?? null
})
const isAddressBlocked = computed(
  () => currentStep.value === 2 && blockingAddressMatch.value !== null,
)

// "View Existing Address" shows the blocking match read-only inside step 2; the
// user's entry stays in the form untouched, so Back simply returns to it.
const existingAddress = ref<Record<string, any> | null>(null)
const isViewingExistingAddress = computed(() => isAddressBlocked.value && existingAddress.value !== null)

const allAddressRowsDismissed = computed(() => {
  if (addressDuplicateList.value.length === 0) { return true }
  return addressDuplicateList.value.every(
    (row) => addressRowSelections.value[row.id] === 'not-duplicate',
  )
})

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
const addressSuggestions = ref<Record<string, any>[]>([])
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

const defaultAddressRoles = computed(() => {
  const roles: string[] = []
  if (isSavedDefaultShipping.value) { roles.push('default shipping address') }
  if (isSavedDefaultBilling.value) { roles.push('default billing address') }
  return roles
})

const isBlockedByDefaultRole = computed(
  () => isEditMode.value && form.status === 'inactive' && defaultAddressRoles.value.length > 0,
)

const defaultAddressWarning = computed(() =>
  isBlockedByDefaultRole.value
    ? buildDefaultAssignmentWarning('address', defaultAddressRoles.value)
    : '',
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

// Dropping a role here clears that role's default too (see the watches above), so
// the type checkbox is a back door around the locked "Set as default" box unless
// it is held to the SAME rule: an address keeps a saved role while it is the only
// address carrying it, or while it holds that role's default. Anything else would
// leave the partner with no address of the type — and no default to point at —
// which is exactly what the default lock exists to prevent.
//
// Only a SAVED role locks, so ticking a role on isn't an irreversible trap before
// it's written. Counts exclude this address, so the role frees up as soon as
// another address carries it and holds the default.
const lockTypeShipping = computed(
  () => (props.address?.isShipping ?? false)
    && (otherShippingCount.value === 0 || isSavedDefaultShipping.value),
)
const lockTypeBilling = computed(
  () => (props.address?.isBilling ?? false)
    && (otherBillingCount.value === 0 || isSavedDefaultBilling.value),
)

const shippingTypeLockTooltip = computed(() => {
  if (!lockTypeShipping.value) { return '' }
  return otherShippingCount.value === 0
    ? 'This is the only shipping address. Add another shipping address first.'
    : 'A default address cannot be unchecked. To remove it as the default, set another address as the default shipping address first.'
})

const billingTypeLockTooltip = computed(() => {
  if (!lockTypeBilling.value) { return '' }
  return otherBillingCount.value === 0
    ? 'This is the only billing address. Add another billing address first.'
    : 'A default address cannot be unchecked. To remove it as the default, set another address as the default billing address first.'
})

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

// Tag + inactive-note suggestions come from the junction's Directus interface
// options, via the same cached field-metadata fetch that powers the counters.
// A 5xx there still escalates to the drawer's error screen, as before.
const { presetsFor: junctionPresetsFor, hasPresetsServerError } = useFieldPresets('business_partners_addresses')
watch(hasPresetsServerError, (failed) => {
  if (failed) { hasLoadError.value = true }
}, { immediate: true })

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

function addTagFromPreset(preset: string) {
  const normalized = preset.toLowerCase()
  if ((form.tags as string[]).some((tag) => tag.toLowerCase() === normalized)) { return }
  form.tags = [...(form.tags as string[]), preset]
}

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
    // Every open starts on the form; clear any prior duplicate-review state so a
    // reopened drawer never resumes mid-flow.
    currentStep.value = 1
    addressDuplicateList.value = []
    addressRowSelections.value = {}
    existingAddress.value = null
    editingAddressConfirm.value = false
    confirmBackup.value = null
    verifiedAccurate.value = false
    lastCheckedAddressKey.value = ''

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
  // are always active. Not demanded from a user who cannot write the note:
  // that would dead-end the save on a disabled field.
  if (canEditInactiveNote.value && form.status === 'inactive' && !form.inactiveNote.trim()) {
    errors.inactiveNote = 'Inactive note is required'
    isValid = false
  }

  return isValid
}

// The shared footer emits one `save` for both the edit Save and the Confirm-step
// Create, so route by mode here (mirroring the contact drawer). Edit validates and
// persists directly; create was already validated on step 1, so it just writes.
async function onSave() {
  if (isEditMode.value) {
    submitted.value = true
    if (!validateForm()) {
      if (currentStep.value === 3) { editingAddressConfirm.value = true }
      return
    }
    // From the form, check whenever the address differs from the saved one; from
    // Confirm, only if it was edited since the last check, so rows already
    // dismissed on the review step don't send the user back there again.
    const needsDuplicateCheck = currentStep.value === 1
      ? hasAddressFieldsChanged()
      : buildAddressKey(candidateComparableAddress()) !== lastCheckedAddressKey.value
    if (needsDuplicateCheck && await routeToDuplicateReview()) { return }
    isSaving.value = true
    await handleEdit()
    isSaving.value = false
    return
  }

  // Create. If the address was edited on the Confirm step, re-validate and
  // re-run the duplicate check before writing — a newly-introduced match routes
  // back to the review step instead of creating a duplicate.
  const editedSinceCheck = buildAddressKey(candidateComparableAddress()) !== lastCheckedAddressKey.value
  if (editedSinceCheck) {
    submitted.value = true
    if (!validateForm()) { editingAddressConfirm.value = true; return }
    if (await routeToDuplicateReview()) { return }
  }

  isSaving.value = true
  await handleCreate()
  isSaving.value = false
}

// The drawer's comparable shape for the address currently entered in the form.
function candidateComparableAddress(): ComparableAddress {
  return {
    streetLine1: form.street,
    streetLine2: form.unitSuite,
    city: form.city,
    postalCode: form.postalCode,
    countryId: form.country,
    regionId: form.state,
  }
}

// Project a business_partners_addresses junction (as returned by
// fetchPartnerAddresses) onto the shape the duplicate check compares. Country and
// region come through as nested relationship objects, so read their ids.
function addressJunctionToComparable(junction: Record<string, any>): ComparableAddress {
  const address = (junction.addresses_id ?? {}) as Record<string, any>
  return {
    streetLine1: address.street_line_1,
    streetLine2: address.street_line_2,
    city: address.city,
    postalCode: address.postal_code,
    countryId: address.countries_id?.id ?? null,
    regionId: address.regions_id?.id ?? null,
  }
}

// Flatten a matched junction into the row shape the DuplicateCheck table renders
// (its columns key off these field names).
function addressJunctionToRow(junction: Record<string, any>): { id: number | string, [key: string]: any } {
  const address = (junction.addresses_id ?? {}) as Record<string, any>
  return {
    id: junction.id,
    streetLine1: address.street_line_1 || '',
    streetLine2: address.street_line_2 || '',
    city: address.city || '',
    region: address.regions_id?.name || '',
    postalCode: address.postal_code || '',
    country: address.countries_id?.name || '',
  }
}

// The entered values DuplicateCheck highlights matched cells against (its
// isDynamicFieldMatch reads form[col.formField]).
const duplicateCheckForm = computed(() => ({
  streetLine1: form.street,
  streetLine2: form.unitSuite,
  city: form.city,
  postalCode: form.postalCode,
  region: regionOptions.value.find((region) => region.id === form.state)?.name || '',
  country: countryOptions.value.find((country) => country.id === form.country)?.name || '',
}))

const ADDRESS_DUPLICATE_COLUMNS = [
  { field: 'streetLine1', header: 'Address Line 1', width: '200px', formField: 'streetLine1' },
  { field: 'streetLine2', header: 'Address Line 2', width: '140px', formField: 'streetLine2' },
  { field: 'city', header: 'City', width: '140px', formField: 'city' },
  { field: 'region', header: 'State/Region', width: '140px', formField: 'region' },
  { field: 'postalCode', header: 'Postal Code', width: '120px', formField: 'postalCode' },
  { field: 'country', header: 'Country', width: '150px', formField: 'country' },
]

// Whether any compared address field differs from the saved address being edited
// (same trimmed, case-insensitive comparison as the duplicate check). Tag, status,
// type and default edits don't count, so they save without a duplicate check.
function hasAddressFieldsChanged(): boolean {
  if (!props.address) { return false }
  const savedAddress: ComparableAddress = {
    streetLine1: props.address.street,
    streetLine2: props.address.unitSuite,
    city: props.address.city,
    postalCode: props.address.postalCode,
    countryId: props.address.countryId,
    regionId: props.address.regionId,
  }
  return buildAddressKey(candidateComparableAddress()) !== buildAddressKey(savedAddress)
}

// Run the duplicate check and, on any match, route to the review step. Returns
// whether it routed, so the caller stops short of the write.
async function routeToDuplicateReview(): Promise<boolean> {
  isCheckingDuplicates.value = true
  const matches = await loadDuplicateMatches()
  isCheckingDuplicates.value = false
  applyDuplicateMatches(matches)
  if (!matches.length) { return false }
  editingAddressConfirm.value = false
  currentStep.value = 2
  return true
}

// Fetch the account's addresses and return those that exactly match the entered
// one, already flattened into duplicate-table rows. Fails open — a lookup error
// yields no matches rather than trapping the user.
async function loadDuplicateMatches(): Promise<{ id: number | string, [key: string]: any }[]> {
  const { data: existingAddresses, error } = await fetchPartnerAddresses(
    props.businessPartnerId!,
    { limit: -1 },
  )
  if (error || !existingAddresses?.length) { return [] }
  // An edit never matches the address it is editing.
  const otherAddresses = (existingAddresses as Record<string, any>[])
    .filter((junction) => junction.id !== props.address?.id)
  const candidate = candidateComparableAddress()
  const candidateKey = buildAddressKey(candidate)
  return findDuplicateAddresses(
    candidate,
    otherAddresses,
    addressJunctionToComparable,
  ).map((junction) => ({
    ...addressJunctionToRow(junction),
    // Country, street lines 1 and 2, city, region and postal code all equal —
    // the backend blocks this outright rather than offering a dismissal.
    isBlocking: buildAddressKey(addressJunctionToComparable(junction)) === candidateKey,
    junction,
  }))
}

// One-line address for the blocked-duplicate cards: "Street, Unit, City, ST 12345".
function formatAddressLine(parts: {
  street?: string | null
  unit?: string | null
  city?: string | null
  regionCode?: string | null
  postalCode?: string | null
}): string {
  const regionAndPostal = [parts.regionCode, parts.postalCode]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
  return [parts.street, parts.unit, parts.city, regionAndPostal]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(', ')
}

const blockedEntrySummary = computed(() => ({
  title: formatAddressLine({
    street: form.street,
    unit: form.unitSuite,
    city: form.city,
    regionCode: regionOptions.value.find((region) => region.id === form.state)?.code,
    postalCode: form.postalCode,
  }),
  subtitle: getAddressTypeLabel(!props.isSupplier && form.isShipping, props.isSupplier || form.isBilling),
}))

const blockedExistingSummary = computed(() => {
  const junction = blockingAddressMatch.value?.junction ?? {}
  const address = junction.addresses_id ?? {}
  return {
    title: formatAddressLine({
      street: address.street_line_1,
      unit: address.street_line_2,
      city: address.city,
      regionCode: address.regions_id?.code,
      postalCode: address.postal_code,
    }),
    subtitle: getAddressTypeLabel(Boolean(junction.is_shipping_address), Boolean(junction.is_billing_address)),
  }
})

// The slice AddressFormFields renders (ids for country / region, like the form).
const existingAddressFields = computed(() => ({
  country: existingAddress.value?.countryId ?? null,
  street: existingAddress.value?.street ?? '',
  unitSuite: existingAddress.value?.unitSuite ?? '',
  city: existingAddress.value?.city ?? '',
  state: existingAddress.value?.regionId ?? null,
  postalCode: existingAddress.value?.postalCode ?? '',
  latitude: existingAddress.value?.latitude ?? null,
  longitude: existingAddress.value?.longitude ?? null,
}))

function handleViewExistingAddress() {
  if (!blockingAddressMatch.value || !props.mapAddresses) { return }
  const [mappedAddress] = props.mapAddresses([blockingAddressMatch.value.junction])
  existingAddress.value = mappedAddress ?? null
}

function handleBackToMatch() {
  existingAddress.value = null
}

// Surface duplicate matches and remember the address they were checked against,
// so an edit on the Confirm step can be detected and re-checked before the write.
function applyDuplicateMatches(matches: { id: number | string, [key: string]: any }[]): void {
  existingAddress.value = null
  addressDuplicateList.value = matches
  addressRowSelections.value = {}
  lastCheckedAddressKey.value = buildAddressKey(candidateComparableAddress())
}

// Step 1 → Next: validate, then look for an exact all-fields duplicate among the
// account's addresses. A match routes to the review step; none skips to Confirm.
async function handleNextStep() {
  submitted.value = true
  if (!validateForm()) { return }

  isCheckingDuplicates.value = true
  const matches = await loadDuplicateMatches()
  isCheckingDuplicates.value = false

  applyDuplicateMatches(matches)
  currentStep.value = matches.length ? 2 : 3
}

// Duplicate step → Next: only once every surfaced row is dismissed.
function handleDuplicateNext() {
  if (!allAddressRowsDismissed.value) { return }
  currentStep.value = 3
}

function handleBackToForm() {
  existingAddress.value = null
  currentStep.value = 1
}

// Drawer-level primary action (BaseDrawer @save, e.g. keyboard submit): route to
// whatever the current step's forward action is. Step 3 create goes through
// onSave, the same handler the footer's Create button emits.
function handlePrimaryAction() {
  if (currentStep.value === 1) { return isEditMode.value ? onSave() : handleNextStep() }
  if (currentStep.value === 2) { return handleDuplicateNext() }
  if (!verifiedAccurate.value) { return } // Confirm step gated on the acknowledgment.
  return onSave()
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

  // Create the junction directly (with the new address nested under addresses_id). Both the
  // junction and the addresses leaf are watched by the SAP sync flow, so there's no need to
  // route this through the parent business partner.
  const { error } = await createPartnerAddress({
    business_partners_id: props.businessPartnerId,
    is_shipping_address: form.isShipping,
    is_billing_address: form.isBilling,
    status: form.status,
    inactive_note: form.status === 'inactive' ? form.inactiveNote.trim() : null,
    tags: form.tags,
    addresses_id: addressPayload,
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

  // Write only the collection(s) that actually changed, each directly to its own table, so an
  // edit fires the fewest sync runs possible: address content -> the `addresses` leaf; junction
  // fields (billing/shipping role, status, inactive note, tags) -> the `business_partners_addresses`
  // junction; default pointers -> the parent business partner (they live there). Both the leaf and
  // the junction are now watched by the SAP sync flow, so neither needs to be nested through the
  // parent any more — a junction-only edit (e.g. active/inactive) now fires a single junction run
  // instead of re-syncing the whole partner. Each comparison mirrors the expression that populated
  // the form from props.address, so an untouched field never triggers a write and a real change
  // always does (nothing is dropped). When both content and a junction field change, the two writes
  // hit two watched tables and produce two runs — collapsed safely by the sync worker.
  const addressChanged
    = form.street !== (props.address.street || '')
    || form.unitSuite !== (props.address.unitSuite || '')
    || form.city !== (props.address.city || '')
    || form.postalCode !== (props.address.postalCode || '')
    || form.country !== (props.address.countryId || null)
    || (form.state || null) !== (props.address.regionId || null)
    || form.latitude !== (props.address.latitude ?? null)
    || form.longitude !== (props.address.longitude ?? null)
  const junctionChanged
    = form.isShipping !== (props.address.isShipping ?? true)
    || form.isBilling !== (props.address.isBilling ?? false)
    || form.status !== (props.address.status || 'active')
    || form.inactiveNote !== (props.address.inactiveNote || '')
    || JSON.stringify(form.tags) !== JSON.stringify(props.address.tags || [])
  const defaultsChanged
    = form.isDefaultBilling !== (props.address.id === props.defaultBillingJunctionId)
    || form.isDefaultShipping !== (props.address.id === props.defaultShippingJunctionId)

  if (addressChanged) {
    const { error } = await updateAddress(props.address.addressId, {
      street_line_1: form.street.trim(),
      street_line_2: unitSuite || '',
      city: form.city.trim(),
      postal_code: form.postalCode.trim().toUpperCase(),
      countries_id: form.country,
      regions_id: form.state || null,
      latitude: form.latitude,
      longitude: form.longitude,
    })
    if (error) {
      toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
      return
    }
  }

  if (junctionChanged) {
    // status / inactive_note only enter the PATCH when the caller holds the
    // grant — Directus rejects a payload containing an unwritable key even
    // when the value is unchanged.
    const junctionPayload: Record<string, any> = {
      is_shipping_address: form.isShipping,
      is_billing_address: form.isBilling,
      tags: form.tags,
    }
    if (canEditStatus.value) {
      junctionPayload.status = form.status
    }
    if (canEditInactiveNote.value) {
      junctionPayload.inactive_note = form.status === 'inactive' ? form.inactiveNote.trim() : null
    }
    const { error } = await updatePartnerAddress(props.address.id, junctionPayload)
    if (error) {
      toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
      return
    }
  }

  if (defaultsChanged) {
    await syncAddressDefaults(props.address.id, {
      billing: form.isDefaultBilling,
      shipping: form.isDefaultShipping,
    })
  }

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

// Users often paste a full address copied from another system (e.g. Shopify) or
// straight out of the Addresses table, so it arrives multi-line or tab-separated.
// A single-line input mangles those breaks, so flatten the paste into a clean
// comma-separated query and run the address search on it.
async function onAddressPaste(event) {
  const pasted = event.clipboardData?.getData('text') ?? ''
  if (!pasted.includes('\n') && pasted.trim().length < 3) {
    return
  }
  const normalized = normalizePastedAddress(pasted)
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
  // A pasted address is meant to populate the form, not just open a dropdown, so
  // auto-apply — but only a suggestion the pasted text actually backs, and from
  // anywhere in the list rather than whichever one Mapbox ranked first. Asked for
  // an address it can't place, Mapbox answers with a real but unrelated one, and
  // applying that silently replaced what the user pasted. The full list stays in
  // the dropdown either way, so a different match is always one click away.
  const corroborated = pickCorroboratedSuggestion(normalized, addressSuggestions.value)
  if (corroborated) {
    await applyAddressSuggestion(corroborated)
    return
  }
  await applyPastedAddress(normalized)
}

// Nothing Mapbox returned matches the paste, so fill the form from the paste
// itself — the fields still populate, but only ever with the user's own text.
// Only recognised parts are written, so an unparsed field keeps its value rather
// than being cleared. Coordinates are geocoded here rather than left to the
// field-change watcher, which the paste guard suppresses.
async function applyPastedAddress(normalized) {
  const parsed = parsePastedAddress(normalized, {
    regions: regionOptions.value,
    countryAliases: countryOptions.value.flatMap((c) => [c.name, c.code]),
  })

  form.street = parsed.street || normalized
  if (parsed.unitSuite) { form.unitSuite = parsed.unitSuite }
  if (parsed.city) { form.city = parsed.city }
  if (parsed.postalCode) { form.postalCode = parsed.postalCode }
  if (parsed.regionId != null) { form.state = parsed.regionId }

  // A one-line paste has no separator between the street and the city, so the
  // parse can't split them — resolve the city from the postal code before
  // geocoding, which also needs it. Those coordinates double as the fallback pin.
  let postalCoordinates = null
  if (!form.city.trim() && form.postalCode.trim()) {
    postalCoordinates = await resolveCityFromPostalCode()
  }

  await locatePastedAddress(postalCoordinates)

  nextTick(() => { isReverseGeocoding = false })
}

// Coordinates of the postal code on its own, within the selected region and
// country — a point that is always in the right place, if not the exact one.
async function geocodePostalCode() {
  const selectedCountry = countryOptions.value.find((c) => c.id === form.country)
  if (!selectedCountry || !form.postalCode.trim()) { return null }

  const selectedRegion = regionOptions.value.find((r) => r.id === form.state)
  return geocodeAddress({
    postalCode: form.postalCode,
    state: selectedRegion?.name || '',
    country: selectedCountry.name || '',
  })
}

// Name the city a one-line paste never separated from the street. The postal
// code identifies it on its own, so read the place back off its coordinates; the
// name is then peeled off the end of the street, where the paste left it
// ("BLDG. 1330 BAY 3 DOOR 11 ALBANY" → "…DOOR 11" + Albany). Nothing is written
// unless the location answers with the code we asked about. Returns the postal
// code's coordinates either way, for the caller to reuse.
async function resolveCityFromPostalCode() {
  const coordinates = await geocodePostalCode()
  if (!coordinates) { return null }

  const addressParts = await reverseGeocodeAddress(coordinates.latitude, coordinates.longitude)
  if (!addressParts?.city) { return coordinates }
  if (addressParts.postalCode.trim().toUpperCase() !== form.postalCode.trim().toUpperCase()) {
    return coordinates
  }

  form.city = addressParts.city
  form.street = stripTrailingCity(form.street, addressParts.city)
  return coordinates
}

// Does a reverse-geocoded point describe the address now in the form? Compared
// on city and region — the two a wrong-but-plausible geocode gets wrong. A field
// neither side knows can't contradict, so it doesn't count against the point.
function isSamePastedPlace(located) {
  if (!located) { return false }

  const city = form.city.trim().toLowerCase()
  if (city && located.city && located.city.toLowerCase() !== city) { return false }

  const selectedRegion = regionOptions.value.find((r) => r.id === form.state)
  if (selectedRegion && located.state && located.state.toLowerCase() !== selectedRegion.name.toLowerCase()) {
    return false
  }
  return true
}

function applyPasteCoordinates({ latitude, longitude }) {
  form.latitude = latitude
  form.longitude = longitude
  mapRef.value?.flyTo(latitude, longitude)
}

// Pin the pasted address, and fill any field it left blank.
//
// The geocode is verified before it is trusted: asked for "BLDG. 1330 BAY 3 DOOR
// 11, Albany, Georgia" Mapbox answers with Bay Street in Walterboro, South
// Carolina — the right-looking text, a point 500km away. Reverse-geocoding the
// result says which place it actually landed in; when that contradicts the
// address, the postal code's own centroid is the pin instead, and nothing is
// backfilled from a point we don't believe.
async function locatePastedAddress(postalCoordinates) {
  const selectedCountry = countryOptions.value.find((c) => c.id === form.country)
  if (selectedCountry && form.street.trim() && form.city.trim()) {
    const selectedRegion = regionOptions.value.find((r) => r.id === form.state)
    const coordinates = await geocodeAddress({
      street: form.street,
      city: form.city,
      state: selectedRegion?.name || '',
      postalCode: form.postalCode,
      country: selectedCountry.name || '',
    })
    const located = coordinates
      ? await reverseGeocodeAddress(coordinates.latitude, coordinates.longitude)
      : null

    if (coordinates && isSamePastedPlace(located)) {
      applyPasteCoordinates(coordinates)
      backfillPasteGaps(located)
      return
    }
  }

  const fallback = postalCoordinates ?? await geocodePostalCode()
  if (fallback) { applyPasteCoordinates(fallback) }
}

// A pasted address often omits the postal code (and sometimes the state) — a
// copied table row can simply have those cells empty. The point just verified
// knows both, so fill in what the paste left blank.
//
// Only the gaps, and only the administrative fields: the street at those
// coordinates is whatever building they happen to sit on (geocoding
// "10746 S Chemolite Rd" lands on Innovation Road), which is exactly what the
// paste must not be overwritten with.
function backfillPasteGaps(located) {
  if (!form.postalCode.trim() && located.postalCode) {
    form.postalCode = located.postalCode
  }
  if (form.state == null && hasRegions.value && located.state) {
    const matchedRegion = regionOptions.value.find(
      (r) => r.name.toLowerCase() === located.state.toLowerCase(),
    )
    if (matchedRegion) { form.state = matchedRegion.id }
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
  // Delete the junction row directly — the SAP-first delete guard fires on the
  // business_partners_addresses delete either way, and this avoids re-syncing the whole partner.
  const { error } = await removePartnerAddress(props.address.id)

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
    :title="drawerTitle"
    title-size="xl"
    :has-error="hasLoadError"
    :dirty="isDirty || currentStep > 1"
    :busy="isSaving || isCheckingDuplicates"
    :show-resume-prompt="showResumePrompt"
    @save="handlePrimaryAction"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
      <!-- The three-step progress shows in the header for a create, and for an
           edit only once Save routes it into the duplicate review. -->
      <template
        v-if="!isEditMode || currentStep > 1"
        #header
      >
        <StepProgress
          :steps="addressSteps"
          :current-step="currentStep"
          :error-step="isAddressBlocked ? 2 : null"
        />
      </template>

      <!-- Step 1 — Enter Details. v-show (not v-if) keeps the map and geocoding
           mounted while the duplicate / confirm steps are on screen. The wrapper
           re-establishes the drawer-body flex gap so grouping the fields under one
           element doesn't collapse the spacing between them. -->
      <div
        v-show="currentStep === 1"
        class="address-form-step"
      >
      <div class="checkbox-grid">
        <!-- Shipping toggles are customer-only; suppliers have billing-only
             addresses, so the two billing checkboxes sit in one row. -->
        <div
          v-if="!isSupplier"
          class="checkbox-field"
          :class="{ 'checkbox-field--disabled': lockTypeShipping }"
        >
          <Checkbox
            v-model="form.isShipping"
            inputId="isShipping"
            :binary="true"
            :disabled="lockTypeShipping"
          />
          <label
            for="isShipping"
            class="checkbox-field__label"
            v-tooltip.top="shippingTypeLockTooltip"
          >Shipping Address</label>
        </div>
        <div
          class="checkbox-field"
          :class="{ 'checkbox-field--disabled': lockTypeBilling }"
        >
          <Checkbox
            v-model="form.isBilling"
            inputId="isBilling"
            :binary="true"
            :disabled="lockTypeBilling"
          />
          <label
            for="isBilling"
            class="checkbox-field__label"
            v-tooltip.top="billingTypeLockTooltip"
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
            v-tooltip.top="lockDefaultShipping ? (otherShippingCount === 0 ? 'The only shipping address must stay the default. Add another shipping address first.' : 'A default address cannot be unchecked. To remove it as the default, set another address as the default shipping address first.') : ''"
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
            v-tooltip.top="lockDefaultBilling ? (otherBillingCount === 0 ? 'The only billing address must stay the default. Add another billing address first.' : 'A default address cannot be unchecked. To remove it as the default, set another address as the default billing address first.') : ''"
          >Set as default billing address</label>
        </div>
      </div>

      <Message
        v-if="defaultAddressWarning"
        severity="warn"
        icon="pi pi-info-circle"
        :closable="false"
        class="drawer-warning-banner"
      >
        {{ defaultAddressWarning }}
      </Message>

      <!-- Status — editable only when editing an existing address. New addresses
           are always Active (the radios render disabled), matching the "why create
           an inactive address" rule. -->
      <div class="form-row-2">
        <div class="form-field">
          <span class="form-field__label">Status</span>
          <div class="radio-group">
            <div class="radio-option">
              <RadioButton
                v-model="form.status"
                input-id="addressStatusActive"
                value="active"
                :disabled="!isEditMode || !canEditStatus"
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
                :disabled="!isEditMode || !canEditStatus"
              />
              <label
                for="addressStatusInactive"
                class="radio-option__label"
              >Inactive</label>
            </div>
          </div>
        </div>
        <div
          class="form-field"
          :class="{ 'form-field--reserved': form.status !== 'inactive' }"
          :aria-hidden="form.status !== 'inactive'"
        >
          <div class="form-field__label-row">
            <label
              class="form-field__label form-field__label--required"
            >Inactive Notes</label>
            <BaseCharCounter
              :value="form.inactiveNote"
              :max="limitForJunction('inactive_note')"
            />
          </div>
          <InputText
            v-model="form.inactiveNote"
            v-trim
            placeholder="Enter the reason why it's inactive"
            fluid
            :tabindex="form.status === 'inactive' ? undefined : -1"
            :invalid="submitted && !!errors.inactiveNote"
            :disabled="!canEditInactiveNote"
          />
          <BaseSuggestionChips
            :suggestions="junctionPresetsFor('inactive_note')"
            :selected="[form.inactiveNote]"
            :disabled="!canEditInactiveNote"
            @select="form.inactiveNote = $event"
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
          <BaseSuggestionChips
            :suggestions="junctionPresetsFor('tags')"
            :selected="form.tags as string[]"
            @select="addTagFromPreset"
          />
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
      </div>
      <!-- /Step 1 -->

      <!-- Step 2 — Duplicate Check (only when the entered or edited address
           matched another one on the account). An exact match shows the blocked
           view; otherwise the shared review table. The drawer footer drives
           navigation, so hide-nav. -->
      <!-- "View Existing Address" - the blocking match, read-only. -->
      <div
        v-if="isViewingExistingAddress && existingAddress"
        class="address-confirm"
      >
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Existing Address</span>
        </div>
        <div class="checkbox-grid">
          <div
            v-if="!isSupplier"
            class="checkbox-field checkbox-field--disabled"
          >
            <Checkbox
              :model-value="existingAddress.isShipping"
              binary
              disabled
              input-id="existing-address-shipping"
            />
            <label
              for="existing-address-shipping"
              class="checkbox-field__label"
            >Shipping Address</label>
          </div>
          <div class="checkbox-field checkbox-field--disabled">
            <Checkbox
              :model-value="existingAddress.isBilling"
              binary
              disabled
              input-id="existing-address-billing"
            />
            <label
              for="existing-address-billing"
              class="checkbox-field__label"
            >Billing Address</label>
          </div>
        </div>
        <div class="form-field">
          <span class="form-field__label">Status</span>
          <StatusTag
            :status="existingAddress.status"
            :inactive-note="existingAddress.inactiveNote"
          />
        </div>
        <AddressFormFields
          :address="existingAddressFields"
          :country-options="countryOptions"
          disabled
          layout="stacked"
          id-prefix="existing-address"
        />
        <div
          v-if="existingAddress.tags.length"
          class="form-field"
        >
          <span class="form-field__label">Tags</span>
          <div class="existing-address__tags">
            <span
              v-for="tag in existingAddress.tags"
              :key="tag"
              class="tag-chip"
            >{{ tag }}</span>
          </div>
        </div>
      </div>
      <DuplicateBlockedMatch
        v-else-if="isAddressBlocked"
        record-label="Address"
        :entry="blockedEntrySummary"
        :existing="blockedExistingSummary"
      />
      <DuplicateCheck
        v-else-if="currentStep === 2"
        :form="duplicateCheckForm"
        :duplicate-list="addressDuplicateList"
        :row-selections="addressRowSelections"
        :can-proceed-to-final-review="allAddressRowsDismissed"
        :is-advancing-to-review="false"
        variant="address"
        hide-card
        hide-nav
        :columns="ADDRESS_DUPLICATE_COLUMNS"
        @update:row-selections="addressRowSelections = $event"
      >
        <!-- "Your Entry" above the duplicate table, matching the contact flow: the
             entered address shown as disabled inputs so the user compares the
             match against exactly what they typed. Same AddressFormFields as the
             Confirm step, just locked. -->
        <template #summary>
          <div class="address-confirm">
            <div class="drawer-section__heading">
              <span class="drawer-section__title">Your Entry</span>
            </div>
            <AddressFormFields
              :address="form"
              :country-options="countryOptions"
              disabled
              layout="stacked"
              id-prefix="duplicate-address"
            />
          </div>
        </template>
      </DuplicateCheck>

      <!-- Step 3 — Confirm & Create (Confirm & Save when editing). Reuses AddressFormFields (the same component
           the contact confirm renders its address sections with) behind a
           section-header Edit / Apply / Cancel, exactly like ConfirmCreate's
           Shipping Address. Edits feed straight into the form; onSave re-runs the
           duplicate check if anything changed. -->
      <div
        v-if="currentStep === 3"
        class="create-form-section"
      >
        <div class="confirm-section-header">
          <div class="drawer-section__heading">
            <span class="drawer-section__title">Review Address</span>
          </div>
          <div
            v-if="editingAddressConfirm"
            class="confirm-section-header__actions"
          >
            <Button
              icon="pi pi-check"
              label="Apply"
              size="small"
              class="confirm-edit-btn"
              @click="applyAddressConfirm"
            />
            <Button
              icon="pi pi-times"
              label="Cancel"
              size="small"
              severity="secondary"
              outlined
              class="confirm-edit-btn"
              @click="cancelAddressConfirm"
            />
          </div>
          <Button
            v-else
            icon="pi pi-pencil"
            label="Edit"
            size="small"
            severity="info"
            class="confirm-edit-btn"
            @click="startEditAddressConfirm"
          />
        </div>

        <AddressFormFields
          :address="form"
          :errors="errors"
          :submitted="submitted"
          :country-options="countryOptions"
          :required-active="true"
          :disabled="!editingAddressConfirm"
          layout="stacked"
          id-prefix="confirm-address"
        />

        <!-- Acknowledgment gate — Create stays disabled until this is checked,
             matching the contact confirm's verify checkbox. -->
        <div
          class="confirm-verify"
          :class="{ 'confirm-verify--checked': verifiedAccurate }"
          @click="verifiedAccurate = !verifiedAccurate"
        >
          <Checkbox
            v-model="verifiedAccurate"
            binary
            input-id="address-verified"
            @click.stop
          />
          <span
            class="confirm-verify__label"
            for="address-verified"
          >
            I've verified the information above is accurate
          </span>
        </div>
      </div>

    <!-- Stepped footer, modeled on the contact drawer: full-width "Next Step" on
         the form, Back / Review on the duplicate step, Create (or Save) / Cancel
         on confirm, and the original Save / Cancel / Delete on the edit form. -->
    <template #footer>
      <BaseActionButtons
        v-if="isEditMode && currentStep === 1"
        show-destructive
        :save-loading="isSaving || isCheckingDuplicates"
        :save-disabled="isSaving || isCheckingDuplicates || isBlockedByDefaultRole"
        @save="onSave"
        @cancel="onCancel"
        @delete="onDelete"
      />

      <div
        v-else-if="isViewingExistingAddress"
        class="drawer-footer-actions"
      >
        <Button
          severity="secondary"
          outlined
          @click="handleBackToMatch"
        >
          <i class="pi pi-arrow-left" />
          Back to Duplicate
        </Button>
      </div>

      <div
        v-else-if="currentStep === 2"
        class="drawer-footer-actions"
      >
        <Button
          severity="secondary"
          outlined
          @click="handleBackToForm"
        >
          <i class="pi pi-arrow-left" />
          Back to Form
        </Button>
        <Button
          v-if="isAddressBlocked"
          @click="handleViewExistingAddress"
        >
          View Existing Address
          <i class="pi pi-arrow-right" />
        </Button>
        <Button
          v-else
          :disabled="!allAddressRowsDismissed"
          @click="handleDuplicateNext"
        >
          Final Review
          <i class="pi pi-arrow-right" />
        </Button>
      </div>

      <div
        v-else-if="currentStep === 3"
        class="drawer-footer-actions"
      >
        <Button
          :disabled="isSaving || !verifiedAccurate"
          @click="onSave"
        >
          <BaseSpinner
            v-if="isSaving"
            size="sm"
          />
          <i
            v-else
            class="pi pi-check"
          />
          {{ isEditMode ? 'Save Address' : 'Create Address' }}
        </Button>
        <Button
          label="Cancel"
          icon="pi pi-times"
          severity="secondary"
          outlined
          @click="onCancel"
        />
      </div>

      <Button
        v-else-if="currentStep === 1"
        :disabled="isCheckingDuplicates"
        @click="handleNextStep"
      >
        Next Step
        <span class="step-next-icon">
          <BaseSpinner
            v-if="isCheckingDuplicates"
            size="sm"
          />
          <i
            v-else
            class="pi pi-arrow-right"
          />
        </span>
      </Button>
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

/* Step 1 wrapper — reproduces the drawer-body flex column + gap (base spacing-4,
   spacing-5 from tablet up, mirroring the :deep(.drawer-body) override above) so
   grouping the form fields under one element keeps their original spacing. */
.address-form-step {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);

    @media (min-width: 768px) {
        gap: var(--p-spacing-5);
    }
}

/* Step 2 "Your Entry" summary block. */
.address-confirm {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.existing-address__tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--p-spacing-2);
}

.confirm-verify {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    margin-top: var(--p-spacing-1);
    background: var(--p-surface-0);
    border: 1px solid var(--p-surface-200);
    padding: var(--p-spacing-2) var(--p-spacing-3);
    border-radius: var(--p-border-radius-sm);
    cursor: pointer;
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out),
                border-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out);

    @media (min-width: 768px) {
        margin-top: var(--p-spacing-3);
    }
}

/* Hover previews toward the checked state using the same skyblue the box tints to
   when selected (skipped once checked so it doesn't fight that state). */
.confirm-verify:not(.confirm-verify--checked):hover {
    background: var(--p-skyblue-50);
    border-color: var(--p-skyblue-200);
}

.confirm-verify--checked {
    background: var(--p-skyblue-50);
    border-color: var(--p-primary-500);
}

.confirm-verify__label {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
    cursor: pointer;
    user-select: none;
}

/* Confirm-step section header + Edit/Apply/Cancel buttons — copied from
   ConfirmCreate so the address confirm section matches the contact confirm's
   Shipping/Billing sections exactly. */
.confirm-section-header {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    flex-wrap: wrap;
}

.confirm-section-header .drawer-section__heading {
    flex: 1;
    min-width: 0;
}

.confirm-section-header .drawer-section__title {
    color: var(--p-deepblue-900);
}

.confirm-section-header__actions {
    display: flex;
    gap: var(--p-spacing-2);
    flex-shrink: 0;
}

.confirm-section-header__actions :deep(.confirm-edit-btn.p-button) {
    display: flex;
    /* Match the Contact Information drawer's Edit button (p-button-sm padding). */
    padding: var(--button-sm-padding-y, 5.25px) var(--button-sm-padding-x, 8.75px);
    align-items: center;
    gap: var(--button-gap, 7px);
    width: auto;
    height: auto;
    min-width: auto;
}

/* The Cancel action (secondary/outlined) carries the same canonical filled-
   secondary treatment as BaseActionButtons' Cancel — gray-50 fill by default
   (not only on hover), transparent border, deepblue text, tideblue-50 hover. */
.confirm-section-header__actions :deep(.confirm-edit-btn.p-button-outlined.p-button-secondary) {
    background: var(--p-gray-50);
    border-color: transparent;
    color: var(--p-deepblue-900);
}

.confirm-section-header__actions :deep(.confirm-edit-btn.p-button-outlined.p-button-secondary:hover),
.confirm-section-header__actions :deep(.confirm-edit-btn.p-button-outlined.p-button-secondary:focus-visible) {
    background: var(--p-tideblue-50);
    border-color: transparent;
    color: var(--p-deepblue-900);
}

:deep(.confirm-edit-btn.p-button) {
    display: flex;
    border-color: transparent;
    width: var(--button-icon-only-width, 35px);
    padding: var(--button-padding-y, 7px) 0;
    justify-content: center;
    align-items: center;
    flex-shrink: 0;

    @media (min-width: 768px) {
        width: auto;
        height: auto;
        min-width: auto;
        /* Match the Contact Information drawer's Edit button (p-button-sm padding). */
        padding: var(--button-sm-padding-y, 5.25px) var(--button-sm-padding-x, 8.75px);
        gap: var(--button-gap, 7px);
    }
}

/* Stepped-footer layout, matching the contact drawer's footer: centered and
   full-width on mobile, left-aligned and auto-width from tablet up. */
.step-next-icon {
    display: inline-flex;
    align-items: center;
    margin-left: var(--p-spacing-0-5);
}

.drawer-footer-actions {
    display: flex;
    justify-content: center;
    align-items: stretch;
    gap: var(--p-spacing-3);
    width: 100%;

    @media (min-width: 768px) {
        justify-content: flex-start;
    }
}

.drawer-footer-actions > * {
    flex: 1;
    white-space: nowrap;

    @media (min-width: 768px) {
        flex: none;
    }
}

/* Secondary buttons in the stepped footer (Back to Form, Cancel) use the app's
   canonical filled-secondary treatment — the same as BaseActionButtons' Cancel:
   gray-50 fill, transparent border, deepblue text, and the standard tideblue-50
   hover used across the app. */
.drawer-footer-actions :deep(.p-button-outlined.p-button-secondary) {
    border-color: transparent;
    background: var(--p-gray-50);
    color: var(--p-deepblue-900);
}

.drawer-footer-actions :deep(.p-button-outlined.p-button-secondary:hover),
.drawer-footer-actions :deep(.p-button-outlined.p-button-secondary:focus-visible) {
    border-color: transparent;
    background: var(--p-tideblue-50);
    color: var(--p-deepblue-900);
}

.checkbox-field--disabled .checkbox-field__label {
    color: var(--p-text-muted-color);
    cursor: not-allowed;
}

.checkbox-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--p-spacing-4);

    @media (min-width: 768px) {
        gap: var(--p-spacing-4) var(--p-spacing-6);
    }
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

</style>
