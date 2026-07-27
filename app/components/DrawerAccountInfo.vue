<script setup lang="ts">
import type { ContactForm, ContactErrors } from '~/composables/useContactForm'

interface Props {
  visible: boolean
  customer: Record<string, any>
  businessPartnerId: number | null
  // Shipping accounts come pre-loaded with the partner, so the drawer seeds its
  // editable list from these instead of fetching on open.
  shippingAccounts?: ShippingAccountView[]
  defaultParcelJunctionId?: number | null
  defaultLtlJunctionId?: number | null
  // Mapped address/contact lists (junction id + display fields) used to populate
  // the default-pointer Selects, plus the partner's current default pointers.
  addresses?: Record<string, any>[]
  contacts?: Record<string, any>[]
  // Partner-level phone numbers (mapped junction rows) — seeds the phone editor.
  phoneNumbers?: Record<string, any>[]
  defaultShippingAddressJunctionId?: number | null
  defaultBillingAddressJunctionId?: number | null
  defaultSalesContactJunctionId?: number | null
  defaultBillingContactJunctionId?: number | null
  // 'customer' (default) shows the full form; 'supplier' hides customer-only
  // fields (Shopify, Account Rep, National Account, Shipping Accounts) and
  // sources the group dropdown from supplier groups.
  relationshipType?: 'customer' | 'supplier'
}

const props = withDefaults(defineProps<Props>(), {
  customer: () => ({}),
  businessPartnerId: null,
  shippingAccounts: () => [],
  defaultParcelJunctionId: null,
  defaultLtlJunctionId: null,
  addresses: () => [],
  contacts: () => [],
  phoneNumbers: () => [],
  defaultShippingAddressJunctionId: null,
  defaultBillingAddressJunctionId: null,
  defaultSalesContactJunctionId: null,
  defaultBillingContactJunctionId: null,
  relationshipType: 'customer',
})

const isSupplier = computed(() => props.relationshipType === 'supplier')
const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()
const toast = useToast()
const { updateBusinessPartner } = useBusinessPartners()
const { fetchBusinessPartnerGroups } = useBusinessPartnerGroups()
// Character-limit counters (CONNECT-536) — Directus soft limits for the partner
// and, for the inline shipping-account form, the shipping_accounts collection.
const { limitFor } = useCharLimits('business_partners')
const { limitFor: shippingLimitFor } = useCharLimits('shipping_accounts')
const isSaving = ref(false)
const hasLoadError = ref(false)

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const form = reactive({
  status: 'active',
  shopifyLogin: false,
  companyName: '',
  website: '',
  accountRep: '',
  isNationalAccount: false,
  companyPhone: '',
  customerGroup: '',
  defaultShippingAddress: null as number | null,
  defaultBillingAddress: null as number | null,
  defaultSalesContact: null as number | null,
  defaultBillingContact: null as number | null,
})

const customerGroupOptions = ref([])

// Homeowners are individuals: a website and the national-account flag don't
// apply, so both are disabled while a homeowner group is selected. Existing
// values are left untouched (not wiped) to avoid destroying data on open.
const isHomeowner = computed(
  () => customerGroupOptions.value.find((g) => g.id === form.customerGroup)?.name?.toLowerCase() === 'homeowner',
)

// Default-pointer Select options, derived from the partner's mapped lists. A
// default shipping address must be a shipping address (and likewise billing),
// mirroring the Directus field filters; contacts populate both contact Selects.
const shippingAddressOptions = computed(() =>
  (props.addresses || [])
    .filter((address) => address.isShipping)
    .map((address) => ({ id: address.id, label: formatAddressLabel(address) })),
)
const billingAddressOptions = computed(() =>
  (props.addresses || [])
    .filter((address) => address.isBilling)
    .map((address) => ({ id: address.id, label: formatAddressLabel(address) })),
)
const contactOptions = computed(() =>
  (props.contacts || []).map((contact) => ({
    id: contact.id,
    label: contact.jobTitle ? `${contact.name}, ${contact.jobTitle}` : contact.name,
  })),
)

const {
  isDirty,
  showResumePrompt,
  markClosedAnyway,
  continueEditing,
  discardResume,
  markSaved,
} = useDrawerResumeGuard({
  isOpen: localVisible,
  recordKey: () => props.businessPartnerId,
  // Include the open shipping inline-form's dirtiness so editing only a shipping
  // field still counts as unsaved work to preserve.
  snapshot: () => ({
    ...form,
    accountRepSelection: accountRepSelection.value,
    accountManagerSelection: accountManagerSelection.value,
    shippingDirty: hasUnsavedShippingChanges.value,
    phonesDirty: hasUnsavedPhoneChanges.value,
  }),
  populate: async () => {
    hasLoadError.value = false

    // Prefill everything from the already-available props FIRST so the drawer
    // renders populated instantly — the customer, phones, and shipping accounts
    // are all in hand, no network needed. The fetches below only load dropdown
    // *option* lists (customer groups, shipping carriers/methods), so they run
    // afterwards rather than blocking the initial display.
    form.status = props.customer.status || 'active'
    form.shopifyLogin = props.customer.shopifyLogin || false
    form.companyName = props.customer.companyName || ''
    form.website = props.customer.website || ''
    form.accountRep = props.customer.accountRep || ''
    // Reset the one-way account-manager control to its "keep current" state each
    // time the drawer opens — never carry a prior "Unassign" choice across opens.
    accountRepSelection.value = ACCOUNT_REP_KEEP
    // Seed the reassign dropdown (operations) to the partner's current manager,
    // or the Unassigned sentinel when there is none.
    accountManagerSelection.value = props.customer.accountManagerId ?? ACCOUNT_MANAGER_UNASSIGNED
    form.isNationalAccount = props.customer.isNationalAccount || false
    form.companyPhone = props.customer.companyPhone || ''
    form.customerGroup = props.customer.customerGroupId || null
    form.defaultShippingAddress = props.defaultShippingAddressJunctionId ?? null
    form.defaultBillingAddress = props.defaultBillingAddressJunctionId ?? null
    form.defaultSalesContact = props.defaultSalesContactJunctionId ?? null
    form.defaultBillingContact = props.defaultBillingContactJunctionId ?? null
    // Seed the editable phone + shipping lists from the partner data the page
    // already fetched — synchronous, no per-open round-trip.
    editingAccountId.value = null
    seedShippingAccountsFromProps()
    seedPhonesFromProps()

    // Customer-group options for the group Select. A server error here shows the
    // full error screen (the prefilled form underneath stays hidden).
    const { data: groups, error: groupsError } = await fetchBusinessPartnerGroups({
      relationshipType: props.relationshipType,
    })
    if (groupsError) {
      if (isServerError(groupsError)) {
        hasLoadError.value = true
      }
      return
    }
    if (groups) {customerGroupOptions.value = groups}

    // Shipping select options (cached); the editable list itself was seeded above.
    const { data: shippingOptions, error: optionsError } = await fetchShippingOptions()
    if (!optionsError && shippingOptions) {
      carrierOptions.value = shippingOptions.carriers
      groupOptions.value = shippingOptions.groups
      methodOptions.value = shippingOptions.methods
    }
  },
})

// Account Representative (aka SAP "Sales Employee") is a one-way, self-service
// control: a sales person may only UNASSIGN themselves from their own customer —
// never reassign it to someone else, and never touch a customer that isn't
// theirs. So the clear/revert action is available only when the logged-in user
// is this customer's current account manager, and its sole actionable choice is
// "Unassign", which clears business_partners.account_manager_id to null (the SAP
// sync then maps null → SlpCode 12, the UNASSIGNED sales employee). Once cleared,
// the customer is no longer "theirs", so the control reverts to disabled.
const authStore = useAuthStore()
const ACCOUNT_REP_KEEP = 'keep'
// 'keep' = leave the current account manager as-is; null = the user has cleared
// (unassigned) themselves via the Select's × clear icon.
const accountRepSelection = ref<string | null>(ACCOUNT_REP_KEEP)

const isOwnCustomer = computed(() =>
  !isSupplier.value
  && !!authStore.user?.id
  && props.customer?.accountManagerId != null
  && props.customer.accountManagerId === authStore.user.id,
)

// The rep shows in a read-only field — there's nothing to pick, so it's not a
// dropdown. On the user's own customer the sole action is the one-way "Unassign":
// a × clears the rep to null. Once cleared, the × becomes a revert (↺) so the
// choice stays reversible until Save, at which point null persists as
// account_manager_id = null (SAP maps that to SlpCode 12, UNASSIGNED).
const isAccountRepCleared = computed(() => accountRepSelection.value === null)

const accountRepDisplay = computed(() => {
  if (isAccountRepCleared.value) { return 'Unassigned' }
  const rep = form.accountRep
  return rep && rep !== '—' ? rep : 'Unassigned'
})

function unassignAccountRep() {
  accountRepSelection.value = null
}

function revertAccountRep() {
  accountRepSelection.value = ACCOUNT_REP_KEEP
}

// ── Account-manager reassignment ─────────────────────────────────────────────
// The drawer branches on the caller's update capability for this partner type
// (resolved from field-permissions, not policy names):
//   'any'           → reassign to any user in the partner's department, or unassign
//                     (Sales Manager + Operations Manager on customers; Operations
//                     Manager on suppliers)
//   'clear-to-null' → the one-way self-unassign above (Sales, on their own customer)
//   'none'          → no control at all
// Account managers come from a SAP department: Sales (1) for customers, Logistics
// (8) for suppliers.
const SALES_DEPARTMENT_ID = 1
const LOGISTICS_DEPARTMENT_ID = 8

const { loadAccountManagerCapabilities, getUpdateAccountManagerCapability } = usePermissions()
loadAccountManagerCapabilities()

const updateCapability = computed(() =>
  getUpdateAccountManagerCapability(isSupplier.value ? 'supplier' : 'customer'),
)

const { fetchAccountManagers } = useDirectusUsers()
const accountManagers = ref<Array<{ id: string, first_name: string | null, last_name: string | null }>>([])
const isAccountManagersLoading = ref(false)

// Sentinel for the "Unassigned" option — a real null option value reads as "no
// selection" in the Select (shows the placeholder), so carry a string here and
// map it back to null in the payload.
const ACCOUNT_MANAGER_UNASSIGNED = '__unassigned__'
const accountManagerSelection = ref<string>(ACCOUNT_MANAGER_UNASSIGNED)

const showAccountManagerSelect = computed(() => updateCapability.value === 'any')

const accountManagerOptions = computed(() => {
  const options = accountManagers.value.map(manager => ({
    label: `${manager.first_name ?? ''} ${manager.last_name ?? ''}`.trim() || 'Unnamed',
    value: manager.id as string,
  }))
  // Keep the current manager selectable even if they've since left the
  // department (and so aren't in the fetched list).
  const currentId = props.customer?.accountManagerId
  if (currentId && !options.some(option => option.value === currentId)) {
    options.unshift({ label: form.accountRep || 'Current account manager', value: currentId })
  }
  options.push({ label: 'Unassigned', value: ACCOUNT_MANAGER_UNASSIGNED })
  return options
})

async function loadAccountManagers() {
  if (accountManagers.value.length || isAccountManagersLoading.value) { return }
  isAccountManagersLoading.value = true
  const { data, error } = await fetchAccountManagers(
    isSupplier.value ? LOGISTICS_DEPARTMENT_ID : SALES_DEPARTMENT_ID,
  )
  isAccountManagersLoading.value = false
  if (error || !data) {
    console.error('Failed to load account managers:', error?.message)
    return
  }
  accountManagers.value = data
}

// Fetch the assignable managers once the drawer is open for a reassign-capable
// user (Sales-dept for customers, Logistics-dept for suppliers).
watch(
  () => localVisible.value && showAccountManagerSelect.value,
  (shouldLoad) => {
    if (shouldLoad) { loadAccountManagers() }
  },
  { immediate: true },
)

// Phone numbers (reuses the contact drawer's phone editor)
// Partner-level phones via the business_partners_phone_numbers M2M. Add / edit /
// remove + masking + validation in local state, persisted on Save as a nested
// phone_numbers create/update/delete on the partner (see buildPhoneNumbersPayload).
const referenceData = useReferenceDataStore()
const phoneCountryOptions = computed(() => referenceData.countryOptions)
const { fetchRules: fetchPhoneRules, getRules: getPhoneRules } = useFieldValidation()
const phoneSubmitted = ref(false)
fetchPhoneRules('phone_numbers')

const phoneForm = reactive<ContactForm>({
  status: 'active',
  firstName: '',
  lastName: '',
  jobTitle: '',
  email: '',
  address: null,
  phoneNumbers: [],
  allowTransactionalEmail: false,
  allowMarketingEmail: false,
  allowTransactionalSms: false,
  allowMarketingSms: false,
  notes: '',
  inactiveNote: '',
  isPrimaryContact: false,
})

const phoneErrors = reactive<ContactErrors>({
  firstName: '',
  lastName: '',
  jobTitle: '',
  email: '',
  inactiveNote: '',
  phoneNumbers: '',
  phoneCountry: '',
  phoneNumber: '',
  phoneExtension: '',
})

const {
  isMobile: isPhoneMobile,
  dragHandle: phoneDragHandle,
  editingPhoneId: phoneEditingId,
  phoneEditForm,
  editingPhoneCountryIso,
  editingPhoneCountryCode,
  showPhoneErrorBanner,
  isEditingPhoneEntryInvalid,
  editPhoneNumber,
  addPhoneNumber,
  removePhoneNumber,
  closePhoneEdit,
  discardPhoneEdit,
  updatePhoneEditFromInput,
  getFormattedPhone,
  newPhones,
  modifiedPhoneIds,
  deletedJunctionIds,
  buildPhonePayload,
  snapshotOriginalPhones,
  getOriginalPhoneData,
  resetPhoneState,
  validatePhoneFields,
} = useContactPhoneEditor({
  form: phoneForm,
  errors: phoneErrors,
  countryOptions: phoneCountryOptions,
  submitted: phoneSubmitted,
  normalizePhone: digitsOnly,
  getPhoneRules: () => getPhoneRules('phone_numbers'),
})

// Seed the phone editor from the partner's mapped phone list (existing rows are
// not "new"), sorted by their stored order, and snapshot the originals so the
// save layer can diff edits/reorders. Mirrors the contact drawer.
function seedPhonesFromProps() {
  resetPhoneState()
  const phones = (props.phoneNumbers || []).map((phone) => ({
    id: phone.id,
    junctionId: phone.junctionId ?? null,
    phoneRecordId: phone.phoneRecordId ?? null,
    type: phone.type || '',
    number: phone.number || '',
    rawNumber: phone.rawNumber || '',
    extension: phone.extension || '',
    smsCapable: phone.smsCapable || false,
    countryId: phone.countryId || null,
    sort: phone.sort ?? null,
    // Partner-level phones have no default concept (the section hides the
    // toggle); keep the field for PhoneRow shape parity.
    isDefault: phone.isDefault ?? false,
    isNew: false,
  }))
  phones.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  // Normalize the baseline to 1-based contiguous order so an untouched open is
  // never flagged dirty (and no spurious sort-only updates are sent) even when
  // the stored phone_numbers_sort values aren't already 1..n.
  phones.forEach((phone, index) => { phone.sort = index + 1 })
  phoneForm.phoneNumbers = phones
  snapshotOriginalPhones(phoneForm.phoneNumbers)
}

// Any unsaved phone change — new draft, deletion, in-place edit, or reorder
// (sort derives from array order). Drives the close/resume guard.
const hasUnsavedPhoneChanges = computed(() => {
  if (newPhones.value.length > 0 || deletedJunctionIds.value.size > 0 || modifiedPhoneIds.value.size > 0) {
    return true
  }
  const originalPhoneData = getOriginalPhoneData()
  return phoneForm.phoneNumbers.some(
    (phone, index) => !phone.isNew && originalPhoneData[phone.id]?.sort !== index + 1,
  )
})

// Build the nested phone_numbers create/update/delete payload for the partner
// PATCH. Sort derives from the row's position; updates target the existing
// junction (and its phone record by id); deletes carry queued junction ids.
function buildPhoneNumbersPayload(): Record<string, any> {
  const sortByPhoneId = new Map<number, number>()
  phoneForm.phoneNumbers.forEach((phone, index) => sortByPhoneId.set(phone.id, index + 1))

  const originalPhoneData = getOriginalPhoneData()
  const reorderedIds = phoneForm.phoneNumbers
    .filter((phone) => !phone.isNew && originalPhoneData[phone.id]?.sort !== sortByPhoneId.get(phone.id))
    .map((phone) => phone.id)
  const updateIds = new Set<number>([...modifiedPhoneIds.value, ...reorderedIds])

  const phoneUpdates: Record<string, any>[] = []
  for (const phoneId of updateIds) {
    const phone = phoneForm.phoneNumbers.find((entry) => entry.id === phoneId)
    if (!phone || phone.isNew) { continue }
    phoneUpdates.push({
      id: phone.junctionId,
      phone_numbers_sort: sortByPhoneId.get(phone.id) ?? null,
      phone_numbers_id: { id: phone.phoneRecordId, ...buildPhonePayload(phone) },
    })
  }

  const phoneCreates = newPhones.value.map((phone) => ({
    phone_numbers_sort: sortByPhoneId.get(phone.id) ?? null,
    phone_numbers_id: buildPhonePayload(phone),
  }))

  const payload: Record<string, any> = {}
  if (phoneUpdates.length) { payload.update = phoneUpdates }
  if (phoneCreates.length) { payload.create = phoneCreates }
  if (deletedJunctionIds.value.size) { payload.delete = [...deletedJunctionIds.value] }
  return payload
}

// Shipping accounts (wired to Directus)
const {
  fetchOptions: fetchShippingOptions,
  createForPartner: createShippingAccount,
  updateAccount: updateShippingAccount,
  removeAccount: removeShippingAccount,
} = useShippingAccounts()

// Shipping accounts are edited entirely in local state and only persisted when
// the user clicks Save (like the phone-number editor). Drafts get a unique
// negative junction id until they're created on Save; removed existing accounts
// are queued here and deleted on Save.
let draftKeySeq = 0
function nextDraftKey() { return --draftKeySeq }

type EditableShippingAccount = ShippingAccountView & { isDraft?: boolean }

const shippingAccounts = ref<EditableShippingAccount[]>([])
const deletedAccounts = ref<Array<{ junctionId: number, accountId: number }>>([])
const carrierOptions = ref<ShippingOption[]>([])
const groupOptions = ref<ShippingOption[]>([])
const methodOptions = ref<ShippingMethodOption[]>([])

const editingAccountId = ref<number | null>(null)
const editForm = reactive({
  status: 'active',
  carrierId: null as number | null,
  groupId: SHIPPING_GROUP_PARCEL as number,
  accountNumber: '',
  methodId: null as number | null,
  isDefault: false,
})

const filteredMethodOptions = computed(() =>
  methodOptions.value.filter(
    (method) => method.carrierId === editForm.carrierId && method.groupId === editForm.groupId,
  ),
)
const filteredCarrierOptions = computed(() =>
  carrierOptions.value.filter((carrier) => {
    const carrierMethods = methodOptions.value.filter((method) => method.carrierId === carrier.id)
    if (carrierMethods.length === 0) { return true }
    return carrierMethods.some((method) => method.groupId === editForm.groupId)
  }),
)

// Default Method is optional in Directus (nullable). Only require it when the
// selected carrier + group actually offers methods — carriers with none (e.g.
// Priority Courier Express) leave the field disabled and save without it.
const isShippingEntryValid = computed(() => {
  if (!editForm.carrierId || !editForm.accountNumber.trim()) { return false }
  if (filteredMethodOptions.value.length > 0 && !editForm.methodId) { return false }
  return true
})

// Per-field errors for the inline shipping edit form. Populated only on a save
// attempt (validateShippingEntry) and cleared the moment a field is edited.
const shippingErrors = reactive({
  carrierId: '',
  accountNumber: '',
  methodId: '',
})

function validateShippingEntry() {
  shippingErrors.carrierId = editForm.carrierId ? '' : 'Shipping carrier is required.'
  shippingErrors.accountNumber = editForm.accountNumber.trim() ? '' : 'Account number is required.'
  shippingErrors.methodId = (filteredMethodOptions.value.length > 0 && !editForm.methodId)
    ? 'Default method is required.'
    : ''
  return !shippingErrors.carrierId && !shippingErrors.accountNumber && !shippingErrors.methodId
}

function clearShippingErrors() {
  shippingErrors.carrierId = ''
  shippingErrors.accountNumber = ''
  shippingErrors.methodId = ''
}

// Hide a field's error the moment the user edits it.
useClearErrorsOnEdit(editForm as Record<string, any>, shippingErrors as Record<string, string>)
watch(() => editForm.groupId, () => {
  if (editForm.carrierId && !filteredCarrierOptions.value.some((carrier) => carrier.id === editForm.carrierId)) {
    editForm.carrierId = null
  }
})

watch([() => editForm.carrierId, () => editForm.groupId], () => {
  if (editForm.methodId && !filteredMethodOptions.value.some((method) => method.id === editForm.methodId)) {
    editForm.methodId = null
  }
})

// Whether the *open* inline form has unsaved edits relative to its card.
const isShippingEditDirty = computed(() => {
  if (editingAccountId.value === null) { return false }
  const open = shippingAccounts.value.find((account) => account.junctionId === editingAccountId.value)
  if (!open) { return false }
  if (open.isDraft) {
    return Boolean(editForm.carrierId || editForm.accountNumber.trim() || editForm.methodId || editForm.isDefault)
  }
  return (
    editForm.status !== open.status
    || editForm.carrierId !== open.carrierId
    || editForm.groupId !== (open.groupId ?? SHIPPING_GROUP_PARCEL)
    || editForm.accountNumber.trim() !== open.accountNumber
    || editForm.methodId !== open.methodId
    || editForm.isDefault !== open.isDefault
  )
})

// Any unsaved shipping change at all (committed-but-not-persisted edits, drafts,
// queued deletions, or an open dirty form) — drives the close/resume guard.
const hasUnsavedShippingChanges = computed(() => {
  if (deletedAccounts.value.length > 0) { return true }
  const originalById = new Map((props.shippingAccounts || []).map((account) => [account.junctionId, account]))
  for (const card of shippingAccounts.value) {
    if (card.isDraft) { return true }
    const original = originalById.get(card.junctionId)
    if (!original) { continue }
    if (accountFieldsChanged(card, original) || card.isDefault !== original.isDefault) { return true }
  }
  return isShippingEditDirty.value
})

// Seed the editable list from the pre-loaded prop (shallow-copy each row so
// in-drawer edits/drafts never mutate the parent's data), and reset the
// pending-deletion queue.
function seedShippingAccountsFromProps() {
  shippingAccounts.value = (props.shippingAccounts || []).map((account) => ({ ...account }))
  deletedAccounts.value = []
}

// Resolve display names for the form's selected ids (committed into a card).
function resolveOption(options: { id: number, name: string }[], id: number | null): string {
  return options.find((option) => option.id === id)?.name || ''
}

// Whether a saved card's persisted fields differ from the original (drives both
// the "needs an update on Save" decision and the unsaved-changes guard).
function accountFieldsChanged(card: EditableShippingAccount, original: ShippingAccountView): boolean {
  return (
    card.status !== original.status
    || card.carrierId !== original.carrierId
    || card.groupId !== original.groupId
    || card.accountNumber !== original.accountNumber
    || card.methodId !== original.methodId
  )
}

function resetEditForm() {
  editForm.status = 'active'
  editForm.carrierId = null
  editForm.groupId = SHIPPING_GROUP_PARCEL
  editForm.accountNumber = ''
  editForm.methodId = null
  editForm.isDefault = false
  clearShippingErrors()
}

function editShippingAccount(account: ShippingAccountView) {
  editingAccountId.value = account.junctionId
  editForm.status = account.status
  editForm.carrierId = account.carrierId
  editForm.groupId = account.groupId ?? SHIPPING_GROUP_PARCEL
  editForm.accountNumber = account.accountNumber
  editForm.methodId = account.methodId
  editForm.isDefault = account.isDefault
  clearShippingErrors()
}

function openAddForm() {
  // Commit/close any open edit first, then start a fresh draft.
  handleFormClose()
  const draftKey = nextDraftKey()
  shippingAccounts.value.push({
    junctionId: draftKey,
    accountId: -1,
    status: 'active',
    carrierId: null,
    carrierName: '',
    groupId: SHIPPING_GROUP_PARCEL,
    groupName: '',
    accountNumber: '',
    methodId: null,
    methodName: '',
    sort: null,
    isDefault: false,
    isDraft: true,
  })
  resetEditForm()
  editingAccountId.value = draftKey
}

// Copy the form values into its card and enforce one default per shipping group.
// Purely local — nothing is persisted until Save.
function commitEditFormToCard(card: EditableShippingAccount) {
  card.status = editForm.status
  card.carrierId = editForm.carrierId
  card.carrierName = resolveOption(carrierOptions.value, editForm.carrierId)
  card.groupId = editForm.groupId
  card.groupName = resolveOption(groupOptions.value, editForm.groupId)
  card.accountNumber = editForm.accountNumber.trim()
  card.methodId = editForm.methodId
  card.methodName = resolveOption(methodOptions.value, editForm.methodId)
  card.isDefault = editForm.isDefault
  if (editForm.isDefault) {
    shippingAccounts.value.forEach((other) => {
      if (other.junctionId !== card.junctionId && other.groupId === card.groupId) {
        other.isDefault = false
      }
    })
  }
}

// Closing the inline editor commits valid edits to the card in the UI; nothing
// touches Directus until Save. Incomplete drafts are dropped; an incomplete
// existing edit just reverts (the card keeps its values).
// Paste fires before the pasted text is inserted; defer past the input/v-model
// update (a macrotask) so we normalize the freshly-pasted value, not the stale one.
function handleWebsitePaste() {
  setTimeout(() => { form.website = normalizeWebsite(form.website) }, 0)
}

function handleFormClose() {
  const open = shippingAccounts.value.find((account) => account.junctionId === editingAccountId.value)
  if (!open) {
    editingAccountId.value = null
    return
  }
  if (isShippingEntryValid.value) {
    commitEditFormToCard(open)
  } else if (open.isDraft) {
    shippingAccounts.value = shippingAccounts.value.filter((account) => account.junctionId !== open.junctionId)
  }
  editingAccountId.value = null
}

// Local-only delete: drafts vanish; existing accounts are queued and removed
// from Directus on Save.
function deleteShippingAccount(account: EditableShippingAccount) {
  if (!account.isDraft) {
    deletedAccounts.value.push({ junctionId: account.junctionId, accountId: account.accountId })
  }
  shippingAccounts.value = shippingAccounts.value.filter((entry) => entry.junctionId !== account.junctionId)
  if (editingAccountId.value === account.junctionId) { editingAccountId.value = null }
}

// Junction id of the default account for a group (or null to clear). Drafts have
// real ids by the time this runs (assigned in persistShippingChanges).
function defaultJunctionForGroup(groupId: number): number | null {
  const card = shippingAccounts.value.find((account) => account.isDefault && account.groupId === groupId)
  return card && card.junctionId > 0 ? card.junctionId : null
}

function buildShippingAccountLabel(account: EditableShippingAccount): string {
  return account.accountNumber
    ? `${account.carrierName}: ${account.accountNumber}`
    : account.carrierName
}

const parcelAccountOptions = computed(() =>
  shippingAccounts.value
    .filter((account) => account.groupId === SHIPPING_GROUP_PARCEL)
    .map((account) => ({ id: account.junctionId, label: buildShippingAccountLabel(account) })),
)
const ltlAccountOptions = computed(() =>
  shippingAccounts.value
    .filter((account) => account.groupId === SHIPPING_GROUP_LTL)
    .map((account) => ({ id: account.junctionId, label: buildShippingAccountLabel(account) })),
)

// The default Parcel/LTL account lives on the account cards themselves (their
// group-scoped `isDefault` flag, read at save by `defaultJunctionForGroup`) — the
// same source the per-account "default" checkbox writes. These Defaults selects
// are a second view over that single source: selecting marks the chosen card
// default and clears the others in its group, so dropdown and checkbox stay in
// sync and never produce conflicting writes.
function setDefaultAccountForGroup(groupId: number, junctionId: number | null) {
  shippingAccounts.value.forEach((account) => {
    if (account.groupId === groupId) {
      account.isDefault = account.junctionId === junctionId
    }
  })
}

const defaultParcelAccount = computed<number | null>({
  get: () =>
    shippingAccounts.value.find(
      (account) => account.isDefault && account.groupId === SHIPPING_GROUP_PARCEL,
    )?.junctionId ?? null,
  set: (junctionId) => setDefaultAccountForGroup(SHIPPING_GROUP_PARCEL, junctionId ?? null),
})
const defaultLtlAccount = computed<number | null>({
  get: () =>
    shippingAccounts.value.find(
      (account) => account.isDefault && account.groupId === SHIPPING_GROUP_LTL,
    )?.junctionId ?? null,
  set: (junctionId) => setDefaultAccountForGroup(SHIPPING_GROUP_LTL, junctionId ?? null),
})

// Build the partner PATCH from only the fields that actually changed. Updating
// business_partners triggers the (slow) SAP-sync flow, so when a save touches
// only shipping accounts and no partner field / default pointer changed, this
// returns {} and we skip the PATCH entirely — no SAP flow, fast save.
function buildPartnerPayload(): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  const original = props.customer

  if (form.status !== (original.status || 'active')) {
    payload.status = form.status
  }
  if (form.companyName !== (original.companyName || '')) {
    payload.name = form.companyName.toUpperCase()
  }
  if ((form.website || '') !== (original.website || '')) {
    payload.website = form.website || null
  }
  if (form.isNationalAccount !== (original.isNationalAccount || false)) {
    payload.is_national_account = form.isNationalAccount
  }
  if (form.customerGroup !== (original.customerGroupId ?? null)) {
    payload.business_partner_groups_id = form.customerGroup
  }

  // One-way self-unassign (Sales on their own customer): only ever clears the
  // current user's own customer. Guarded by isOwnCustomer so a stale selection
  // can't touch someone else's account, and only when the tier is capped to
  // clear-to-null — reassign-capable users use the dropdown below.
  if (updateCapability.value === 'clear-to-null' && isOwnCustomer.value && accountRepSelection.value === null) {
    payload.account_manager_id = null
  }

  // Reassignment (Sales Manager / Operations Manager): assign to any manager in
  // the partner's department or unassign. Written only when the selection differs
  // from the partner's current manager.
  if (showAccountManagerSelect.value) {
    const originalManager = props.customer.accountManagerId ?? ACCOUNT_MANAGER_UNASSIGNED
    if (accountManagerSelection.value !== originalManager) {
      payload.account_manager_id =
        accountManagerSelection.value === ACCOUNT_MANAGER_UNASSIGNED ? null : accountManagerSelection.value
    }
  }

  const parcelDefault = defaultJunctionForGroup(SHIPPING_GROUP_PARCEL)
  if (parcelDefault !== (props.defaultParcelJunctionId ?? null)) {
    payload.default_parcel_business_partners_shipping_accounts_id = parcelDefault
  }
  const ltlDefault = defaultJunctionForGroup(SHIPPING_GROUP_LTL)
  if (ltlDefault !== (props.defaultLtlJunctionId ?? null)) {
    payload.default_ltl_business_partners_shipping_accounts_id = ltlDefault
  }

  // Default address / contact pointers — write only when changed (null clears).
  if (form.defaultShippingAddress !== (props.defaultShippingAddressJunctionId ?? null)) {
    payload.default_shipping_business_partners_addresses_id = form.defaultShippingAddress
  }
  if (form.defaultBillingAddress !== (props.defaultBillingAddressJunctionId ?? null)) {
    payload.default_billing_business_partners_addresses_id = form.defaultBillingAddress
  }
  if (form.defaultSalesContact !== (props.defaultSalesContactJunctionId ?? null)) {
    payload.default_sales_business_partners_contacts_id = form.defaultSalesContact
  }
  if (form.defaultBillingContact !== (props.defaultBillingContactJunctionId ?? null)) {
    payload.default_billing_business_partners_contacts_id = form.defaultBillingContact
  }

  return payload
}

// Persist the queued shipping changes — deletes, then creates (capturing the new
// junction/account ids onto the cards), then updates of changed accounts. These
// hit the junction/account collections only, so they don't trigger the SAP-sync
// flow (that's the single partner PATCH in onSave). Returns an error message or
// null.
async function persistShippingChanges(partnerId: number): Promise<string | null> {
  // Drain the queue, removing each only after it succeeds so a retry after a
  // partial failure doesn't re-delete an already-removed account.
  while (deletedAccounts.value.length > 0) {
    const removed = deletedAccounts.value[0]
    const { error } = await removeShippingAccount(removed.junctionId, removed.accountId)
    if (error) { return error.message }
    deletedAccounts.value.shift()
  }

  const originalById = new Map((props.shippingAccounts || []).map((account) => [account.junctionId, account]))
  for (let index = 0; index < shippingAccounts.value.length; index++) {
    const card = shippingAccounts.value[index]
    const input = {
      status: card.status,
      carrierId: card.carrierId as number,
      groupId: card.groupId as number,
      accountNumber: card.accountNumber,
      methodId: card.methodId,
    }
    if (card.isDraft) {
      const { data: saved, error } = await createShippingAccount(partnerId, input, index)
      if (error) { return error.message }
      card.junctionId = saved?.id ?? card.junctionId
      card.accountId = saved?.shipping_accounts_id ?? card.accountId
      card.isDraft = false
    } else {
      const original = originalById.get(card.junctionId)
      if (original && accountFieldsChanged(card, original)) {
        const { error } = await updateShippingAccount(card.accountId, input)
        if (error) { return error.message }
      }
    }
  }
  return null
}

async function onSave() {
  isSaving.value = true

  // Commit any open inline edit; block on a partially-filled form.
  if (editingAccountId.value !== null) {
    const open = shippingAccounts.value.find((account) => account.junctionId === editingAccountId.value)
    if (open) {
      const isEmptyDraft = open.isDraft
        && !editForm.carrierId && !editForm.accountNumber.trim() && !editForm.methodId && !editForm.isDefault
      if (isShippingEntryValid.value) {
        commitEditFormToCard(open)
        editingAccountId.value = null
      } else if (isEmptyDraft) {
        shippingAccounts.value = shippingAccounts.value.filter((account) => account.junctionId !== open.junctionId)
        editingAccountId.value = null
      } else {
        isSaving.value = false
        // Surface red field errors on the inline form, plus a toast summary.
        validateShippingEntry()
        toast.add({
          severity: 'error',
          summary: 'Validation Error',
          detail: 'Shipping Carrier and Account Number are required (Default Method when available).',
          life: 4000,
        })
        return
      }
    }
  }

  // Commit any open phone edit; an empty/invalid number blocks the save and
  // surfaces the phone error banner + red input (mirrors the contact drawer).
  if (phoneEditingId.value !== null) {
    phoneSubmitted.value = true
    if (!validatePhoneFields()) { isSaving.value = false; return }
    closePhoneEdit()
    if (phoneEditingId.value !== null) { isSaving.value = false; return }
  }

  const partnerId = props.businessPartnerId
  if (!partnerId) { isSaving.value = false; return }

  // Shipping CRUD first (fast collection ops), then the one partner PATCH.
  const shippingError = await persistShippingChanges(partnerId)
  if (shippingError) {
    isSaving.value = false
    toast.add({ severity: 'error', summary: 'Failed', detail: shippingError, life: 5000 })
    return
  }

  // Only PATCH the partner when a partner field, default pointer, or phone
  // changed — that's the call that triggers the slow SAP-sync flow. A
  // shipping-only save (nothing else changed) skips it entirely. Phones are
  // nested on the same PATCH so they're picked up by the flow too.
  const partnerPayload = buildPartnerPayload()
  const phoneNumbersPayload = buildPhoneNumbersPayload()
  if (Object.keys(phoneNumbersPayload).length > 0) {
    partnerPayload.phone_numbers = phoneNumbersPayload
  }
  if (Object.keys(partnerPayload).length > 0) {
    const { error } = await updateBusinessPartner(partnerId, partnerPayload)
    if (error) {
      isSaving.value = false
      toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
      return
    }
  }
  isSaving.value = false
  toast.add({
    severity: 'success',
    summary: 'Success',
    detail: 'Account information updated',
    life: 3000,
  })
  markSaved()
  emit('saved')
  localVisible.value = false
}

function onCancel() {
  localVisible.value = false
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    title="Account Information"
    title-size="xl"
    body-gap="5"
    :has-error="hasLoadError"
    :dirty="isDirty"
    :busy="isSaving"
    :show-resume-prompt="showResumePrompt"
    @save="onSave"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
      <div class="drawer-section">
        <!-- Status / Has Shopify Login -->
        <div class="form-row">
          <div class="form-field">
            <span class="form-field__label">Status</span>
            <div class="radio-group">
              <div class="radio-option">
                <RadioButton
                  v-model="form.status"
                  inputId="statusActive"
                  value="active"
                />
                <label
                  for="statusActive"
                  class="radio-option__label"
                >Active</label>
              </div>
              <div class="radio-option">
                <RadioButton
                  v-model="form.status"
                  inputId="statusInactive"
                  value="inactive"
                />
                <label
                  for="statusInactive"
                  class="radio-option__label"
                >Inactive</label>
              </div>
            </div>
          </div>
          <div
            v-if="!isSupplier"
            class="form-field"
          >
            <span class="form-field__label">Has Shopify Login</span>
            <div class="radio-group">
              <div class="radio-option">
                <RadioButton
                  v-model="form.shopifyLogin"
                  inputId="shopifyYes"
                  :value="true"
                  disabled
                />
                <label
                  for="shopifyYes"
                  class="radio-option__label"
                >Yes</label>
              </div>
              <div class="radio-option">
                <RadioButton
                  v-model="form.shopifyLogin"
                  inputId="shopifyNo"
                  :value="false"
                  disabled
                />
                <label
                  for="shopifyNo"
                  class="radio-option__label"
                >No</label>
              </div>
            </div>
          </div>
        </div>

        <!-- Company Name / Account Rep (mobile) -->
        <div class="form-row account-row--mobile">
          <div class="form-field">
            <div class="form-field__label-row">
              <label
                class="form-field__label form-field__label--required"
              >Company Name</label>
              <BaseCharCounter :value="form.companyName" :max="limitFor('name')" />
            </div>
            <BaseClearableInput
              v-model="form.companyName"
              v-trim
              v-no-autofill
              autocomplete="off"
              fluid
            />
          </div>
          <div class="form-field">
            <label class="form-field__label">Account Representative</label>
            <!-- Reassign to any manager in the partner's department (Sales Manager /
                 Operations Manager); everyone else keeps the one-way self-unassign. -->
            <Select
              v-if="showAccountManagerSelect"
              v-model="accountManagerSelection"
              :options="accountManagerOptions"
              option-label="label"
              option-value="value"
              :placeholder="isAccountManagersLoading ? 'Loading…' : 'Select account manager'"
              :loading="isAccountManagersLoading"
              :filter="accountManagerOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              panel-class="address-select-panel"
              fluid
            />
            <div
              v-else
              class="account-rep"
            >
              <InputText
                :model-value="accountRepDisplay"
                readonly
                :disabled="!isOwnCustomer"
                class="account-rep__field"
                :class="{ 'account-rep__field--reserved': isOwnCustomer }"
                fluid
              />
              <span
                v-if="isOwnCustomer"
                class="account-rep__action"
              >
                <BaseIconButton
                  v-if="isAccountRepCleared"
                  icon="pi pi-replay"
                  label="Restore account representative"
                  @click="revertAccountRep"
                />
                <BaseIconButton
                  v-else
                  icon="pi pi-times"
                  label="Unassign account representative"
                  @click="unassignAccountRep"
                />
              </span>
            </div>
          </div>
        </div>

        <div class="form-row form-row--full account-row--mobile">
          <div class="form-field">
            <div class="form-field__label-row">
              <label class="form-field__label">Website</label>
              <BaseCharCounter :value="form.website" :max="limitFor('website')" />
            </div>
            <IconField>
              <InputText
                v-model="form.website"
                v-no-autofill
                :disabled="isHomeowner"
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                fluid
                @blur="form.website = normalizeWebsite(form.website)"
                @paste="handleWebsitePaste"
              />
              <InputIcon class="pi pi-globe" />
            </IconField>
          </div>
        </div>

        <!-- Company Name / Website (desktop) -->
        <div class="form-row account-row--desktop">
          <div class="form-field">
            <div class="form-field__label-row">
              <label
                class="form-field__label form-field__label--required"
              >Company Name</label>
              <BaseCharCounter :value="form.companyName" :max="limitFor('name')" />
            </div>
            <BaseClearableInput
              v-model="form.companyName"
              v-trim
              v-no-autofill
              autocomplete="off"
              fluid
            />
          </div>
          <div class="form-field">
            <div class="form-field__label-row">
              <label class="form-field__label">Website</label>
              <BaseCharCounter :value="form.website" :max="limitFor('website')" />
            </div>
            <IconField>
              <InputText
                v-model="form.website"
                v-no-autofill
                :disabled="isHomeowner"
                autocomplete="off"
                autocapitalize="none"
                autocorrect="off"
                spellcheck="false"
                fluid
                @blur="form.website = normalizeWebsite(form.website)"
                @paste="handleWebsitePaste"
              />
              <InputIcon class="pi pi-globe" />
            </IconField>
          </div>
        </div>

        <!-- Account Representative — enabled only for the logged-in user's own
             customer, where the sole action is the one-way "Unassign". -->
        <div class="form-row form-row--full account-row--desktop">
          <div class="form-field">
            <label class="form-field__label">Account Representative</label>
            <!-- Reassign to any manager in the partner's department (Sales Manager /
                 Operations Manager); everyone else keeps the one-way self-unassign. -->
            <Select
              v-if="showAccountManagerSelect"
              v-model="accountManagerSelection"
              :options="accountManagerOptions"
              option-label="label"
              option-value="value"
              :placeholder="isAccountManagersLoading ? 'Loading…' : 'Select account manager'"
              :loading="isAccountManagersLoading"
              :filter="accountManagerOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              panel-class="address-select-panel"
              fluid
            />
            <div
              v-else
              class="account-rep"
            >
              <InputText
                :model-value="accountRepDisplay"
                readonly
                :disabled="!isOwnCustomer"
                class="account-rep__field"
                :class="{ 'account-rep__field--reserved': isOwnCustomer }"
                fluid
              />
              <span
                v-if="isOwnCustomer"
                class="account-rep__action"
              >
                <BaseIconButton
                  v-if="isAccountRepCleared"
                  icon="pi pi-replay"
                  label="Restore account representative"
                  @click="revertAccountRep"
                />
                <BaseIconButton
                  v-else
                  icon="pi pi-times"
                  label="Unassign account representative"
                  @click="unassignAccountRep"
                />
              </span>
            </div>
          </div>
        </div>

        <div
          v-if="!isSupplier"
          class="form-row form-row--full"
        >
          <div
            class="checkbox-field"
            :class="{ 'checkbox-field--disabled': isHomeowner }"
          >
            <Checkbox
              v-model="form.isNationalAccount"
              inputId="nationalAccount"
              :binary="true"
              :disabled="isHomeowner"
            />
            <label
              for="nationalAccount"
              class="checkbox-field__label"
            >
              This is a national customer account
            </label>
          </div>
        </div>

        <!-- Company Phone / Customer Group — customers only. -->
        <div
          v-if="!isSupplier"
          class="form-row"
        >
          <div class="form-field">
            <label class="form-field__label">Company Phone</label>
            <PhoneNumberInput
              :model-value="{ countriesId: null, number: form.companyPhone, extension: null }"
              country-iso="US"
              hide-country
              hide-extension
              @update:model-value="form.companyPhone = $event.number"
            />
          </div>
          <div class="form-field">
            <label
              class="form-field__label form-field__label--required"
            >{{ isSupplier ? 'Supplier Group' : 'Customer Group' }}</label>
            <Select
              v-model="form.customerGroup"
              :options="customerGroupOptions"
              option-label="name"
              option-value="id"
              :filter="customerGroupOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              clear-icon="pi pi-times"
              panel-class="address-select-panel"
              fluid
            />
          </div>
        </div>
      </div>

      <div class="drawer-section drawer-account__defaults">
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Defaults</span>
        </div>

        <!-- Sales / Billing Contact -->
        <div class="form-row">
          <div class="form-field">
            <label class="form-field__label">Sales Contact</label>
            <Select
              v-model="form.defaultSalesContact"
              :options="contactOptions"
              option-label="label"
              option-value="id"
              placeholder="Select Sales Contact"
              show-clear
              :filter="contactOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              clear-icon="pi pi-times"
              panel-class="address-select-panel"
              fluid
            />
          </div>
          <div class="form-field">
            <label class="form-field__label">Billing Contact</label>
            <Select
              v-model="form.defaultBillingContact"
              :options="contactOptions"
              option-label="label"
              option-value="id"
              placeholder="Select Billing Contact"
              show-clear
              :filter="contactOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              clear-icon="pi pi-times"
              panel-class="address-select-panel"
              fluid
            />
          </div>
        </div>

        <!-- Default Parcel / LTL Shipping Account (customer-only). These mirror
             the per-account "default" checkbox in the Shipping Accounts section
             below — both drive the same card `isDefault` flag. -->
        <div
          v-if="!isSupplier"
          class="form-row"
        >
          <div class="form-field">
            <label class="form-field__label">Parcel Shipping Account</label>
            <Select
              v-model="defaultParcelAccount"
              :options="parcelAccountOptions"
              option-label="label"
              option-value="id"
              placeholder="Select Shipping Parcel Account"
              show-clear
              :filter="parcelAccountOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              clear-icon="pi pi-times"
              panel-class="address-select-panel"
              fluid
            />
          </div>
          <div class="form-field">
            <label class="form-field__label">LTL Shipping Account</label>
            <Select
              v-model="defaultLtlAccount"
              :options="ltlAccountOptions"
              option-label="label"
              option-value="id"
              placeholder="Select LTL Shipping Account"
              show-clear
              :filter="ltlAccountOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              clear-icon="pi pi-times"
              panel-class="address-select-panel"
              fluid
            />
          </div>
        </div>

        <!-- Shipping / Billing Address — customers only. -->
        <div
          v-if="!isSupplier"
          class="form-row"
        >
          <div class="form-field">
            <label class="form-field__label">Shipping Address</label>
            <Select
              v-model="form.defaultShippingAddress"
              :options="shippingAddressOptions"
              option-label="label"
              option-value="id"
              placeholder="Select Shipping Address"
              show-clear
              :filter="shippingAddressOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              clear-icon="pi pi-times"
              panel-class="address-select-panel"
              fluid
            />
          </div>
          <div class="form-field">
            <label class="form-field__label">Billing Address</label>
            <Select
              v-model="form.defaultBillingAddress"
              :options="billingAddressOptions"
              option-label="label"
              option-value="id"
              placeholder="Select Billing Address"
              show-clear
              :filter="billingAddressOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              clear-icon="pi pi-times"
              panel-class="address-select-panel"
              fluid
            />
          </div>
        </div>

        <!-- Billing Address — suppliers only. Suppliers have no shipping address
             (we ship on our own carrier account), so the default billing address
             stands alone full-width. -->
        <div
          v-if="isSupplier"
          class="form-row form-row--full supplier-billing-row"
        >
          <div class="form-field">
            <label class="form-field__label">Billing Address</label>
            <Select
              v-model="form.defaultBillingAddress"
              :options="billingAddressOptions"
              option-label="label"
              option-value="id"
              placeholder="Select Billing Address"
              show-clear
              :filter="billingAddressOptions.length > 10"
              dropdown-icon="pi pi-chevron-down"
              clear-icon="pi pi-times"
              panel-class="address-select-panel"
              fluid
            />
          </div>
        </div>
      </div>

      <!-- Section: Shipping Accounts — customers only. Suppliers don't manage
           shipping accounts (we always ship on our own UPS account). -->
      <div
        v-if="!isSupplier"
        class="drawer-section"
      >
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Shipping Accounts</span>
        </div>

        <div class="shipping-list">
          <div
            v-for="account in shippingAccounts"
            :key="account.junctionId"
            class="shipping-card"
          >
            <div
              v-if="editingAccountId === account.junctionId"
              class="shipping-edit"
            >
              <div class="shipping-edit__close">
                <BaseIconButton
                  icon="pi pi-times"
                  label="Close form"
                  @click="handleFormClose"
                />
              </div>

              <div class="form-row">
                <div class="form-field">
                  <span class="form-field__label">Status</span>
                  <div class="radio-group">
                    <div class="radio-option">
                      <RadioButton
                        v-model="editForm.status"
                        inputId="shippingStatusActive"
                        value="active"
                      />
                      <label
                        for="shippingStatusActive"
                        class="radio-option__label"
                      >Active</label>
                    </div>
                    <div class="radio-option">
                      <RadioButton
                        v-model="editForm.status"
                        inputId="shippingStatusInactive"
                        value="inactive"
                      />
                      <label
                        for="shippingStatusInactive"
                        class="radio-option__label"
                      >Inactive</label>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Row 1: Shipping Carrier + Type -->
              <div class="form-row">
                <div class="form-field">
                  <label
                    class="form-field__label form-field__label--required"
                  >Shipping Carrier</label>
                  <Select
                    v-model="editForm.carrierId"
                    :options="filteredCarrierOptions"
                    option-label="name"
                    option-value="id"
                    placeholder="Select Shipping Carrier"
                    :filter="filteredCarrierOptions.length > 10"
                    :invalid="!!shippingErrors.carrierId"
                    dropdown-icon="pi pi-chevron-down"
                    clear-icon="pi pi-times"
                    panel-class="address-select-panel"
                    fluid
                  />
                  <small
                    v-if="shippingErrors.carrierId"
                    class="form-field__error"
                  >{{ shippingErrors.carrierId }}</small>
                </div>
                <div class="form-field">
                  <label class="form-field__label">Type</label>
                  <div class="radio-group">
                    <div
                      v-for="group in groupOptions"
                      :key="group.id"
                      class="radio-option"
                    >
                      <RadioButton
                        v-model="editForm.groupId"
                        :inputId="`group-${group.id}`"
                        :value="group.id"
                      />
                      <label
                        :for="`group-${group.id}`"
                        class="radio-option__label"
                      >{{ group.name }}</label>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Row 2: Account Number + Default Method -->
              <div class="form-row">
                <div class="form-field">
                  <div class="form-field__label-row">
                    <label
                      class="form-field__label form-field__label--required"
                    >Account Number</label>
                    <BaseCharCounter
                      :value="editForm.accountNumber"
                      :max="shippingLimitFor('account_number')"
                    />
                  </div>
                  <BaseClearableInput
                    v-model="editForm.accountNumber"
                    v-trim
                    :maxlength="shippingLimitFor('account_number') || 20"
                    placeholder="Enter Account Number"
                    autocomplete="off"
                    autocapitalize="none"
                    autocorrect="off"
                    spellcheck="false"
                    :invalid="!!shippingErrors.accountNumber"
                    fluid
                  />
                  <small
                    v-if="shippingErrors.accountNumber"
                    class="form-field__error"
                  >{{ shippingErrors.accountNumber }}</small>
                </div>
                <div class="form-field">
                  <label
                    class="form-field__label"
                    :class="{ 'form-field__label--required': filteredMethodOptions.length > 0 }"
                  >Default Method</label>
                  <Select
                    v-model="editForm.methodId"
                    :options="filteredMethodOptions"
                    option-label="name"
                    option-value="id"
                    placeholder="Enter Default Method"
                    :disabled="!editForm.carrierId || filteredMethodOptions.length === 0"
                    :filter="filteredMethodOptions.length > 10"
                    :invalid="!!shippingErrors.methodId"
                    dropdown-icon="pi pi-chevron-down"
                    clear-icon="pi pi-times"
                    panel-class="address-select-panel"
                    fluid
                  />
                  <small
                    v-if="shippingErrors.methodId"
                    class="form-field__error"
                  >{{ shippingErrors.methodId }}</small>
                </div>
              </div>
            </div>

            <template v-else>
              <div class="shipping-card__header">
                <div class="shipping-card__carrier">
                  <i class="pi pi-equals shipping-card__order" />
                  <i
                    v-if="account.isDefault"
                    class="pi pi-star-fill shipping-card__star"
                  />
                  <span class="shipping-card__name">{{
                    `${account.carrierName} ${account.groupName}`.trim()
                  }}</span>
                </div>
                <div class="shipping-card__actions">
                  <BaseIconButton
                    icon="pi pi-pencil"
                    label="Edit shipping account"
                    class="shipping-card__edit"
                    @click="editShippingAccount(account)"
                  />
                  <!-- TEMPORARY: delete is commented out until the deletion
                       workflow (permissions, confirmation, UX) is finalised.
                       deleteShippingAccount() is intact — uncomment to restore.
                       The Edit action above keeps this row from being empty.
                  <BaseIconButton
                    icon="pi pi-trash"
                    label="Delete shipping account"
                    destructive
                    @click="deleteShippingAccount(account)"
                  />
                  -->
                </div>
              </div>
              <div class="shipping-card__body">
                <div class="shipping-card__detail">
                  <span class="shipping-card__label">Account Number</span>
                  <span class="shipping-card__value">
                    <BaseCopyText
                      :value="account.accountNumber"
                      icon-position="right"
                    />
                  </span>
                </div>

                <div class="shipping-card__detail">
                  <span class="shipping-card__label">Default Method</span>
                  <span class="shipping-card__value">{{
                    account.methodName || '—'
                  }}</span>
                </div>
              </div>
            </template>
          </div>

          <!-- Add Shipping Account card — hidden while a form is open -->
          <div
            v-if="editingAccountId === null"
            class="phone-card phone-card--add"
            @click="openAddForm"
          >
            <Button
              icon="pi pi-plus"
              outlined
              rounded
              class="phone-card--add__button"
            />
            <span class="phone-card--add__label">Add Shipping Account</span>
          </div>
        </div>
      </div>
      <DrawerContactPhonesSection
        :form="phoneForm"
        :errors="phoneErrors"
        :submitted="phoneSubmitted"
        :editing-phone-id="phoneEditingId"
        :phone-edit-form="phoneEditForm"
        :country-options="phoneCountryOptions"
        :editing-country-code="editingPhoneCountryCode"
        :editing-country-iso="editingPhoneCountryIso"
        :drag-handle="phoneDragHandle"
        :is-mobile="isPhoneMobile"
        :formatted-phone="getFormattedPhone"
        :show-phone-error-banner="showPhoneErrorBanner"
        :hide-default="true"
        @edit-phone="editPhoneNumber"
        @remove-phone="removePhoneNumber"
        @add-phone="addPhoneNumber"
        @close-phone-edit="discardPhoneEdit"
        @save-phone-edit="closePhoneEdit"
        @update:phone-input="updatePhoneEditFromInput"
        @update:phone-numbers="phoneForm.phoneNumbers = $event"
      />

    <template #footer>
      <BaseActionButtons
        :save-loading="isSaving"
        :save-disabled="isSaving || isEditingPhoneEntryInvalid"
        @save="onSave"
        @cancel="onCancel"
      />
    </template>
  </BaseDrawer>
</template>

<style scoped>
/* Figma spacing/lg (20px) vertical rhythm: between the rows within a section
   (heading → fields and field-row → field-row). The gap between sections comes
   from BaseDrawer's body-gap="5". */
.drawer-section {
    gap: var(--p-spacing-5);
}

/* Defaults section only: trim the field labels' TOP leading so they hug their
   cap-height (tightens the gap above each label). Bottom is left intact, so
   label → input spacing is unchanged. */
.drawer-account__defaults .form-field__label {
    text-box-trim: trim-start;
    text-box-edge: cap alphabetic;
}

.shipping-list {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
}

.shipping-card {
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    overflow: hidden;
}

.shipping-card__header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--p-spacing-4);
}

.shipping-card__carrier {
    display: flex;
    align-items: center;
}

.shipping-card__order {
    margin-right: var(--p-spacing-4);
    font-size: var(--p-font-size-base);
    color: var(--p-gray-800);
    cursor: grab;
}

/* Only the favorite/default account renders a star, so it's always yellow. */
.shipping-card__star {
    margin-right: var(--p-spacing-2);
    font-size: var(--p-font-size-base);
    color: var(--p-yellow-500);
}

.shipping-card__name {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-book);
    line-height: var(--p-font-line-height-normal);
    color: var(--p-deepblue-900);
    position: relative;
    top: 2px;
}

.shipping-card__actions {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

/* Edit pencil sits in gray rather than the default primary blue. */
.shipping-card__actions :deep(.shipping-card__edit:not(.base-icon-button--disabled)) {
    color: var(--p-gray-800);
}

.shipping-card__body {
    display: flex;
    flex-direction: row;
    align-items: center;
    padding: 0 var(--p-spacing-4) var(--p-spacing-4);
    gap: var(--p-spacing-4);
}

.shipping-card__detail {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}

.shipping-card__label {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-gray-800);
}

.shipping-card__value {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-medium);
    line-height: var(--p-font-line-height-normal);
    color: var(--p-deepblue-900);
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
}

.shipping-card__value :deep(.base-copy-text__link) {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-deepblue-900);
}

.shipping-edit {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: var(--p-spacing-4);
    position: relative;
}

.form-field {
    gap: var(--p-spacing-1.75);
}

.shipping-edit .radio-group {
    column-gap: var(--p-spacing-6);
}

.shipping-edit .form-field__label {
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-5);
}

.shipping-edit :deep(.p-inputtext),
.shipping-edit :deep(.p-select-label) {
    color: var(--p-gray-800);
}

.shipping-edit__close {
    position: absolute;
    top: var(--p-spacing-4);
    right: var(--p-spacing-4);
}

/* Close cross uses deep blue instead of the primary blue. */
.shipping-edit__close :deep(.base-icon-button:not(.base-icon-button--disabled)) {
    color: var(--p-deepblue-900);
}

.phone-card--add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-2);
    padding: var(--p-spacing-5) var(--p-spacing-4);
    border-style: solid;
    cursor: pointer;
    background: var(--p-surface-0);

    @media (min-width: 768px) {
        padding: var(--p-spacing-4);
    }
}

.phone-card--add:hover {
    background: var(--p-tideblue-50);
}

.phone-card {
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-sm);
    overflow: hidden;
}

.phone-card--add__button {
    width: 35px;
    height: 35px;
}

.phone-card--add__label {
    color: var(--p-gray-800);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
}

/* Mobile defaults — row visibility */
.account-row--desktop {
    display: none;

    @media (min-width: 768px) {
        display: grid;
    }
}

.account-row--mobile {
    display: grid;

    @media (min-width: 768px) {
        display: none;
    }
}

.account-row--desktop.form-row--full {
    @media (min-width: 768px) {
        grid-template-columns: 1fr;
    }
}

.account-row--desktop.form-row--full .form-field {
    @media (min-width: 768px) {
        width: 100%;
    }
}

/* Account Representative — read-only field with a clear (×) / revert (↺) action
   pinned to the right, mirroring BaseClearableInput's layout. No dropdown. */
.account-rep {
    position: relative;
    display: block;
    width: 100%;
}

.account-rep__field {
    width: 100%;
    font-weight: var(--p-font-weight-normal);
}

/* Reserve room for the action button so its icon never overlaps the rep name. */
.account-rep__field--reserved {
    padding-right: var(--p-spacing-9);
}

.account-rep__action {
    position: absolute;
    top: 50%;
    right: var(--p-spacing-3);
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
}

.account-rep__action :deep(.base-icon-button:not(.base-icon-button--disabled)) {
    color: var(--p-gray-400);
}

.account-rep__action :deep(.base-icon-button:not(.base-icon-button--disabled):hover),
.account-rep__action :deep(.base-icon-button:not(.base-icon-button--disabled):focus-visible) {
    color: var(--p-skyblue-600);
}

/* Keep every icon in this drawer the same 16px size: the account-rep
   clear/revert glyph and the Select dropdown/clear glyphs (rendered as
   PrimeIcons via the dropdown-icon / clear-icon props). Scoped here so the rest
   of the app's Selects are untouched. */
.account-rep__action :deep(.base-icon-button__icon),
:deep(.p-select-dropdown-icon.pi),
:deep(.p-select-clear-icon.pi) {
    font-size: var(--p-font-size-base);
}

/* Centre the clear glyph within its existing 24px hit box. */
:deep(.p-select-clear-icon.pi) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
}

.account-row--mobile.form-row--full {
    grid-template-columns: 1fr;
}

.account-row--mobile.form-row--full .form-field {
    width: 100%;
}

.form-row {
    grid-template-columns: 1fr 1fr;
    gap: var(--p-spacing-3);
}

.form-row:not(.account-row--desktop):not(.account-row--mobile) {
    display: grid;
}

.form-row:not(.account-row--desktop):not(.account-row--mobile) > .form-field {
    min-width: 0;
}

/* Supplier-only default Billing Address: full width. The scoped `.form-row`
   rule above forces 1fr 1fr at every width, so the global `.form-row--full`
   (lower specificity) can't take effect — the compound `.form-row.supplier-billing-row`
   overrides it. */
.form-row.supplier-billing-row {
    grid-template-columns: 1fr;
}

:deep(.supplier-billing-row .p-select) {
    width: 100%;
}

.form-field__label {
    white-space: nowrap;
}

.checkbox-field__label {
    white-space: nowrap;

    @media (min-width: 768px) {
        white-space: nowrap;
    }
}

/* Homeowner: the National Account flag is disabled. */
.checkbox-field--disabled .checkbox-field__label {
    color: var(--p-text-muted-color);
    cursor: not-allowed;
}

.radio-group {
    flex-wrap: nowrap;
    column-gap: var(--p-spacing-3);
}

.radio-option__label {
    white-space: nowrap;
}

</style>
