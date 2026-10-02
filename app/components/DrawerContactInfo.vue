<script setup lang="ts">
interface Props {
  visible?: boolean
  contact?: Record<string, any> | null
  businessPartnerId?: number | null
  // Parent customer's group name; drives the homeowner field restrictions.
  customerGroup?: string | null
  addresses?: Record<string, any>[]
  defaultSalesContactJunctionId?: number | null
  defaultBillingContactJunctionId?: number | null
  // True when the partner has no contacts yet, so this add will be the only one.
  // Mirrors addresses: a lone contact is auto-set as default (and locked).
  isFirstContact?: boolean
  // Whose contact this is. Deleting a phone is scoped by it — the sales tiers
  // reach customer contacts but not supplier ones (CONNECT-1031).
  relationshipType?: 'customer' | 'supplier'
  /** The page's junction → row mapper, used to show a blocking match read-only. */
  mapContacts?: ((rawContacts: any[]) => any[]) | null
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  contact: null,
  businessPartnerId: null,
  customerGroup: null,
  addresses: () => [],
  defaultSalesContactJunctionId: null,
  defaultBillingContactJunctionId: null,
  isFirstContact: false,
  relationshipType: 'customer',
  mapContacts: null,
})
const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()

const referenceData = useReferenceDataStore()
const { fetchRules, getRules } = useFieldValidation()
const toast = useToast()
const { fetchPartnerContacts, fetchPartnerContact } = useBusinessPartners()

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const isEditMode = computed(() => props.contact !== null)

// Every other contact on the partner, excluding the one being edited.
const otherContactCount = ref(0)
// The in-flight load, so the populate step can await the request this watcher
// already started rather than firing a second one.
let otherContactCountRequest: Promise<void> | null = null

async function loadOtherContactCount() {
  otherContactCount.value = 0
  if (!props.businessPartnerId) { return }
  const { data: partnerContacts } = await fetchPartnerContacts(props.businessPartnerId, { limit: -1 })
  const currentJunctionId = props.contact?.id ?? null
  otherContactCount.value = (partnerContacts ?? []).filter(
    (junction) => junction.id !== currentJunctionId,
  ).length
}

// Registered ahead of the resume guard so it wins the open tick, and kept out of
// `populate` because that step is skipped when resuming preserved edits — the
// lock has to hold there too.
watch(localVisible, (isOpen) => {
  otherContactCountRequest = isOpen ? loadOtherContactCount() : null
}, { immediate: true })

const isSavedDefaultContact = computed(
  () => props.contact?.id != null
    && (props.contact.id === props.defaultSalesContactJunctionId
      || props.contact.id === props.defaultBillingContactJunctionId),
)
const isPrimaryLocked = computed(
  () => isEditMode.value
    ? otherContactCount.value === 0 || isSavedDefaultContact.value
    : props.isFirstContact,
)

const isSaving = ref(false)
const submitted = ref(false)
const hasLoadError = ref(false)
const currentStep = ref(1)

const countryOptions = computed(() => referenceData.countryOptions)
const addresses = computed(() => props.addresses)
const contactRef = computed(() => props.contact)
const businessPartnerIdRef = computed(() => props.businessPartnerId)

// A homeowner customer is an individual, so a contact's job title, phone
// extension, and non-general/mobile phone types don't apply — the sub-sections
// disable them.
const isHomeowner = computed(() => props.customerGroup?.toLowerCase() === 'homeowner')
const defaultSalesContactJunctionIdRef = computed(() => props.defaultSalesContactJunctionId)
const defaultBillingContactJunctionIdRef = computed(() => props.defaultBillingContactJunctionId)
const defaultContactRoles = computed(() => {
  if (!isEditMode.value) { return [] }
  const junctionId = props.contact?.id ?? null
  if (junctionId == null) { return [] }
  const roles: string[] = []
  if (junctionId === props.defaultSalesContactJunctionId) { roles.push('default sales contact') }
  if (junctionId === props.defaultBillingContactJunctionId) { roles.push('default billing contact') }
  return roles
})

const normalizeContactPhone = digitsOnly

const contactSteps = [
  { number: 1, label: 'Enter Details' },
  { number: 2, label: 'Duplicate Check' },
  { number: 3, label: 'Confirm & Create' },
]

const {
  form,
  errors,
  isEmailInvalid,
  handleEmailBlur,
  handleEmailInput,
  contactDisplayName,
  addressSelectOptions,
  clearAllErrors,
  resetForm,
  populateFromContact,
  snapshotOriginalContact,
  hasContactCoreChanged,
  hasJunctionPrefsChanged,
  validateContactFields,
  validatePhoneRows,
  hasShortPhone,
} = useContactForm(addresses)
const isBlockedByDefaultRole = computed(
  () => form.status === 'inactive' && defaultContactRoles.value.length > 0,
)

const defaultContactWarning = computed(() =>
  isBlockedByDefaultRole.value
    ? buildDefaultAssignmentWarning('contact', defaultContactRoles.value)
    : '',
)

const {
  isMobile,
  dragHandle,
  editingPhoneId,
  phoneEditForm,
  modifiedPhoneIds,
  newPhones,
  deletedJunctionIds,
  editingPhoneCountryIso,
  editingPhoneCountryCode,
  phoneTypesInUse,
  canAddPhone,
  showPhoneErrorBanner,
  editPhoneNumber,
  addPhoneNumber,
  removePhoneNumber,
  closePhoneEdit,
  discardPhoneEdit,
  updatePhoneEditFromInput,
  validatePhoneFields,
  getFormattedPhone,
  buildPhonePayload,
  snapshotOriginalPhones,
  getOriginalPhoneData,
  resetPhoneState,
} = useContactPhoneEditor({
  form,
  errors,
  countryOptions,
  submitted,
  normalizePhone: normalizeContactPhone,
  getPhoneRules: () => getRules('phone_numbers'),
  isHomeowner,
  enforceSingleDefault: true,
})

const isDefaultPhoneLocked = computed(() => form.phoneNumbers.length === 1)


const {
  contactDuplicateList,
  contactRowSelections,
  isCheckingContactDuplicates,
  contactVerified,
  contactFormEditedOnStep3,
  allContactRowsDismissed,
  blockingContactMatch,
  takeStep3Snapshot,
  hasDuplicateFieldsChangedOnStep3,
  hasDuplicateFieldsChanged,
  populateOriginalDuplicateFields,
  searchContactDuplicates,
  resetDuplicateState,
} = useContactDuplicates(form, normalizeContactPhone)

function getContactSnapshot() {
  // `isDefault` belongs in here: the contact's default phone persists as
  // contacts.default_contacts_phone_numbers_id, so moving the star is a real,
  // savable change. Leaving it out made a default-only edit invisible to the
  // dirty check — the drawer stayed clean and Save stayed disabled, so the star
  // moved in the UI and reverted on the next load.
  const phoneNumbers = form.phoneNumbers
    .map((phone) =>
      editingPhoneId.value === phone.id
        ? {
            type: phoneEditForm.type,
            countryId: phoneEditForm.country,
            rawNumber: phoneEditForm.phoneNumber,
            extension: phoneEditForm.extension,
            smsCapable: phoneEditForm.smsCapable,
            isDefault: phoneEditForm.isDefault,
          }
        : {
            type: phone.type,
            countryId: phone.countryId,
            rawNumber: phone.rawNumber,
            extension: phone.extension,
            smsCapable: phone.smsCapable,
            isDefault: phone.isDefault,
          },
    )
    .filter((phone) => String(phone.rawNumber || '').trim() || String(phone.extension || '').trim())
  return { ...form, phoneNumbers }
}

const {
  isDirty,
  showResumePrompt,
  markClosedAnyway,
  continueEditing,
  discardResume,
  markSaved,
  captureBaseline,
} = useDrawerResumeGuard({
  isOpen: localVisible,
  recordKey: () => props.contact?.id ?? null,
  snapshot: getContactSnapshot,
  // Wipe the multi-step/phone/duplicate state and repopulate from the contact.
  // Skipped automatically when resuming preserved edits.
  populate: async () => {
    resetAllState()
    await loadRulesAndPopulate()
  },
})

// Step 2 with an exact name collision: the backend rejects the save outright, so
// the user is pointed to the existing contact instead of the dismissal table.
const isContactBlocked = computed(() => currentStep.value === 2 && blockingContactMatch.value !== null)
const contactErrorStep = computed(() => (isContactBlocked.value ? 2 : null))

const entryPhone = computed(() => {
  const defaultPhone = form.phoneNumbers.find((phone) => phone.isDefault) ?? form.phoneNumbers[0]
  return defaultPhone ? getFormattedPhone(defaultPhone) : ''
})

// "View Existing Contact" shows the blocking match read-only inside step 2. It
// fills a separate, display-only form, so the user's entry stays untouched and
// Back simply returns to it.
const {
  form: existingContactForm,
  contactDisplayName: existingContactDisplayName,
  populateFromContact: populateExistingContact,
} = useContactForm(addresses)
const isViewingExistingRaw = ref(false)
const isLoadingExistingContact = ref(false)
const isViewingExistingContact = computed(() => isContactBlocked.value && isViewingExistingRaw.value)

async function handleViewExistingContact() {
  if (!blockingContactMatch.value || !props.mapContacts) return
  isLoadingExistingContact.value = true
  const { data: junction, error } = await fetchPartnerContact(blockingContactMatch.value.id)
  isLoadingExistingContact.value = false
  if (error || !junction?.contacts_id) {
    toast.add({
      severity: 'error',
      summary: 'Failed',
      detail: getDirectusErrorMessage(error, 'The existing contact could not be loaded.'),
      life: 5000,
    })
    return
  }
  const [existingContact] = props.mapContacts([junction])
  populateExistingContact(existingContact)
  isViewingExistingRaw.value = true
}

function handleBackToMatch() {
  isViewingExistingRaw.value = false
}

const canCreateContact = computed(
  () => contactVerified.value && allContactRowsDismissed.value,
)

type CollapseKey = 'details' | 'phones' | 'prefs' | 'dupDetails' | 'dupPhones' | 'dupPrefs'
const collapsedRaw = reactive<Record<CollapseKey, boolean>>({
  details: false, phones: false, prefs: false,
  dupDetails: true, dupPhones: true, dupPrefs: true,
})
const isCollapsed = (key: CollapseKey) => isMobile.value && collapsedRaw[key]
const toggleCollapse = (key: CollapseKey) => { collapsedRaw[key] = !collapsedRaw[key] }
const expandSectionForEdit = (key: 'details' | 'phones' | 'prefs') => { collapsedRaw[key] = false }

const editingSections = reactive({ details: false, phones: false, prefs: false })
function toggleConfirmSection(key: string) {
  if (key === 'details' || key === 'phones' || key === 'prefs') {
    editingSections[key] = !editingSections[key]
  }
}

const searchAndExclude = () =>
  searchContactDuplicates(props.businessPartnerId, isEditMode.value ? props.contact?.id ?? null : null)

function validateForm() {
  clearAllErrors()
  return validateContactFields(getRules) && validatePhoneRows(getRules, countryOptions.value, modifiedPhoneIds.value)
}

function collapseAllSections() {
  collapsedRaw.details = true
  collapsedRaw.phones = true
  collapsedRaw.prefs = true
}

const { handleCreate, handleEdit, handleDelete } = useContactSave({
  form,
  isEditMode,
  contact: contactRef,
  businessPartnerId: businessPartnerIdRef,
  defaultSalesContactJunctionId: defaultSalesContactJunctionIdRef,
  defaultBillingContactJunctionId: defaultBillingContactJunctionIdRef,
  buildPhonePayload,
  modifiedPhoneIds,
  newPhones,
  deletedJunctionIds,
  getOriginalPhoneData,
  hasContactCoreChanged,
  hasJunctionPrefsChanged,
  hasShortPhone: () => hasShortPhone(normalizeContactPhone, modifiedPhoneIds.value),
  onClose: () => {
    // After successful save/delete, wipe state + re-baseline so the next open
    // starts clean — no stale "unsaved changes" prompt.
    resetAllState()
    markSaved()
    localVisible.value = false
  },
  onSaved: () => emit('saved'),
})

async function handleContactNextStep() {
  submitted.value = true
  // An open phone edit must hold a valid number before advancing — empty or
  // invalid blocks here and surfaces the drawer-level error banner.
  if (editingPhoneId.value !== null) {
    if (!validatePhoneFields()) return
    closePhoneEdit()
  }
  if (!validateForm()) return

  isCheckingContactDuplicates.value = true
  const hasDuplicates = await searchAndExclude()
  isCheckingContactDuplicates.value = false
  contactVerified.value = false
  contactFormEditedOnStep3.value = false
  collapseAllSections()
  takeStep3Snapshot()
  currentStep.value = hasDuplicates ? 2 : 3
}

function handleContactFinalReview() {
  if (!allContactRowsDismissed.value) return
  contactVerified.value = false
  contactFormEditedOnStep3.value = false
  collapseAllSections()
  takeStep3Snapshot()
  currentStep.value = 3
}

function handleContactBackToForm() {
  isViewingExistingRaw.value = false
  currentStep.value = 1
}

function handleApplyPhones() {
  closePhoneEdit()
  if (editingPhoneId.value !== null) return
  toggleConfirmSection('phones')
}
function handleCancelPhones() {
  discardPhoneEdit()
  toggleConfirmSection('phones')
}

function resetAllState() {
  submitted.value = false
  hasLoadError.value = false
  clearAllErrors()
  resetPhoneState()
  resetDuplicateState()
  isViewingExistingRaw.value = false
  currentStep.value = 1
  Object.assign(editingSections, { details: false, phones: false, prefs: false })
  resetForm()
}

async function loadRulesAndPopulate() {
  // Prefill the form from the already-available contact FIRST so the drawer
  // renders with data instantly — the row data is in hand, no network needed.
  // Validation rules are only consumed on Next/Save, so they load in the
  // background afterwards rather than blocking the initial display.
  if (props.contact) {
    const phones = populateFromContact(props.contact)
    populateOriginalDuplicateFields()
    snapshotOriginalPhones(phones)
    // Pre-check "primary" when this contact is the partner's current default
    // sales or billing contact. Set before the re-baseline below so opening an
    // already-primary contact isn't flagged as an unsaved change.
    form.isPrimaryContact = props.contact.id === props.defaultSalesContactJunctionId
      || props.contact.id === props.defaultBillingContactJunctionId
    // Baseline the core/preference fields now that the form (incl. isPrimaryContact) is fully
    // populated, so a phone-values-only edit can be routed as a direct phone_numbers write.
    snapshotOriginalContact()
  } else if (props.isFirstContact) {
    // First/only contact for this partner → auto-default as sales + billing,
    // mirroring addresses (a lone address is the default). Locked in the UI.
    form.isPrimaryContact = true
  }

  // A locked "primary" is always on — otherwise a partner whose default pointer
  // was never written would render the checkbox disabled AND unchecked, with no
  // way out. Awaited before the baseline below so the forced value doesn't read
  // as an unsaved change the moment the drawer opens.
  await otherContactCountRequest
  if (isPrimaryLocked.value && !form.isPrimaryContact) {
    form.isPrimaryContact = true
    if (isEditMode.value) { snapshotOriginalContact() }
  }

  // Re-baseline once the form is populated so the unsaved-changes guard can
  // detect edits (covers both a fresh open and a discard-and-reload).
  captureBaseline()

  const ruleResults = await Promise.all([
    fetchRules('contacts'),
    fetchRules('business_partners_contacts'),
    fetchRules('phone_numbers'),
  ])
  if (ruleResults.some((rule) => rule?.error && isServerError(rule.error))) {
    hasLoadError.value = true
  }
}

watch(currentStep, async (step, prev) => {
  if (step !== 2 || prev === 2) return
  await nextTick()
  const scroller = document.querySelector('.p-drawer-content') as HTMLElement | null
  const target = document.querySelector('.duplicate-warning') as HTMLElement | null
  if (!scroller || !target) return
  const stepHeader = document.querySelector('.step-header') as HTMLElement | null
  const offset = (stepHeader?.offsetHeight ?? 0) + 8
  scroller.scrollTo({ top: target.offsetTop - offset, behavior: 'smooth' })
})

async function onSave() {
  submitted.value = true

  // An open phone edit must hold a valid number before saving — empty or
  // invalid blocks here and surfaces the drawer-level error banner.
  if (editingPhoneId.value !== null) {
    if (!validatePhoneFields()) return
    closePhoneEdit()
  }
  if (!validateForm()) return
  if (hasShortPhone(normalizeContactPhone, modifiedPhoneIds.value)) return

  isSaving.value = true

  if (isEditMode.value) {
    if (hasDuplicateFieldsChanged() && currentStep.value === 1) {
      const hasDuplicates = await searchAndExclude()
      if (hasDuplicates) {
        isSaving.value = false
        contactVerified.value = false
        currentStep.value = 2
        return
      }
    }
    if (currentStep.value === 3 && hasDuplicateFieldsChangedOnStep3()) {
      const hasDuplicates = await searchAndExclude()
      if (hasDuplicates) {
        isSaving.value = false
        contactVerified.value = false
        currentStep.value = 2
        return
      }
    }
    await handleEdit()
  } else {
    if (hasDuplicateFieldsChangedOnStep3()) {
      const hasDuplicates = await searchAndExclude()
      if (hasDuplicates) {
        isSaving.value = false
        currentStep.value = 2
        return
      }
    }
    await handleCreate()
  }

  isSaving.value = false
}

function onCancel() {
  resetAllState()
  localVisible.value = false
}

async function onDelete() {
  isSaving.value = true
  await handleDelete()
  isSaving.value = false
}
// Deleting a phone is a two-step decision (CONNECT-1031): the card's trash only
// nominates one, and the prompt's confirmation is what removes it. Like every
// other phone edit, the removal is local until the drawer is saved.
const phonePendingDelete = ref<PhoneRow | null>(null)

// Name the record — a list of near-identical rows is exactly where a confirmation
// only helps if it says which one is going.
const phoneDeleteMessage = computed(() => {
  const phone = phonePendingDelete.value
  if (!phone) { return '' }
  const label = getFormattedPhone(phone) || phone.rawNumber || 'This phone number'
  return `${label} will be removed when you save the contact. This cannot be undone.`
})

function confirmPhoneDelete() {
  if (phonePendingDelete.value) {
    removePhoneNumber(phonePendingDelete.value)
  }
  phonePendingDelete.value = null
}
const { loadDeleteRights, canDeleteContactPhone: mayDeleteContactPhone } = usePermissions()
loadDeleteRights()
const canDeleteContactPhone = computed(() => mayDeleteContactPhone(props.relationshipType))

</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="hasLoadError ? 'Internal Error Occured' : (isEditMode ? 'Edit Contact Information' : 'Add Contact Information')"
    title-size="xl"
    :has-error="hasLoadError"
    :dirty="isDirty || currentStep > 1"
    :busy="isSaving || isCheckingContactDuplicates"
    :show-resume-prompt="showResumePrompt"
    @save="onSave"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
    <template #header>
      <StepProgress
        v-if="!isMobile && !(isEditMode && currentStep === 1)"
        class="drawer-header-step-progress"
        :steps="contactSteps"
        :current-step="currentStep"
        :error-step="contactErrorStep"
      />
    </template>

  <DrawerContactStatusSection
      v-if="isEditMode && currentStep === 1"
      :form="form"
      :errors="errors"
      :submitted="submitted"
      :display-name="contactDisplayName"
      :default-role-warning="defaultContactWarning"
      :is-primary-locked="isPrimaryLocked"
      :other-contact-count="otherContactCount"
    />

    <StepProgress
      :steps="contactSteps"
      :current-step="currentStep"
      :error-step="contactErrorStep"
      :hide-chrome="!isMobile || (isEditMode && currentStep === 1)"
      :class="{ 'step-progress--confirm': currentStep === 3 }"
    >
      <div
        v-if="(!isEditMode || currentStep > 1) && !isContactBlocked"
        class="step-card__header"
      >
        <span class="step-card__title">Your Entry</span>
        <span class="step-card__subtitle">Data you entered — preserved throughout this review</span>
        <Tag
          :value="`Step ${currentStep} of 3`"
          class="step-card__badge"
        />
      </div>

      <template v-if="currentStep === 1">
        <div
          v-if="!isEditMode"
          v-tooltip.top="isPrimaryLocked ? 'First contact is the default by default' : ''"
          class="checkbox-field contact-primary-field"
        >
          <Checkbox
            v-model="form.isPrimaryContact"
            inputId="isPrimaryContact"
            :binary="true"
            :disabled="isPrimaryLocked"
          />
          <label
            for="isPrimaryContact"
            class="checkbox-field__label"
          >Set as primary contact</label>
        </div>
        <DrawerContactDetailsSection
          :form="form"
          :errors="errors"
          :submitted="submitted"
          :is-homeowner="isHomeowner"
          :is-email-invalid="isEmailInvalid"
          :address-options="addressSelectOptions"
          @email-blur="handleEmailBlur"
          @email-input="handleEmailInput"
        />
      <DrawerContactPhonesSection
          :can-delete-phone="canDeleteContactPhone"
          :form="form"
          :errors="errors"
          :submitted="submitted"
          :is-homeowner="isHomeowner"
          :editing-phone-id="editingPhoneId"
          :phone-edit-form="phoneEditForm"
          :country-options="countryOptions"
          :editing-country-code="editingPhoneCountryCode"
          :editing-country-iso="editingPhoneCountryIso"
          :drag-handle="dragHandle"
          :is-mobile="isMobile"
          :formatted-phone="getFormattedPhone"
          :show-phone-error-banner="showPhoneErrorBanner"
          :phone-types-in-use="phoneTypesInUse"
          :lock-default="isDefaultPhoneLocked"
          :can-add-phone="canAddPhone"
          @edit-phone="editPhoneNumber"
          @remove-phone="phonePendingDelete = $event"
          @add-phone="addPhoneNumber"
          @apply-phone-edit="closePhoneEdit"
          @cancel-phone-edit="discardPhoneEdit"
          @update:phone-input="updatePhoneEditFromInput"
          @update:phone-numbers="form.phoneNumbers = $event"
        />
        <DrawerContactPreferences :form="form" />
      </template>

      <template v-if="isViewingExistingContact">
        <div class="step-card__header">
          <span class="step-card__title">Existing Contact</span>
          <span class="step-card__subtitle">Data that is stored in the system</span>
        </div>
        <DrawerContactDuplicateSummary
          :form="existingContactForm"
          :display-name="existingContactDisplayName"
          :details-collapsed="isCollapsed('dupDetails')"
          :phones-collapsed="isCollapsed('dupPhones')"
          :prefs-collapsed="isCollapsed('dupPrefs')"
          :is-mobile="isMobile"
          :formatted-phone="getFormattedPhone"
          @toggle-details="toggleCollapse('dupDetails')"
          @toggle-phones="toggleCollapse('dupPhones')"
          @toggle-prefs="toggleCollapse('dupPrefs')"
        />
      </template>
      <DuplicateBlockedMatch
        v-else-if="isContactBlocked && blockingContactMatch"
        record-label="Contact"
        :entry="{ title: contactDisplayName, phone: entryPhone, email: form.email.trim() }"
        :existing="{
          title: blockingContactMatch.name,
          subtitle: blockingContactMatch.jobTitle,
          phone: blockingContactMatch.phoneNumberFormatted,
          email: blockingContactMatch.emailAddress,
        }"
      />

      <DuplicateCheck
        v-else-if="currentStep === 2"
        :form="form"
        :duplicate-list="contactDuplicateList"
        :row-selections="contactRowSelections"
        :can-proceed-to-final-review="allContactRowsDismissed"
        :is-advancing-to-review="false"
        variant="contact"
        hide-card
        hide-nav
        :columns="[
          { field: 'name', header: 'Name', width: '150px', formField: 'firstName' },
          { field: 'emailAddress', header: 'Email Address', width: '200px', formField: 'email' },
          { field: 'phoneNumber', header: 'Phone Number', width: '160px', formField: 'phoneNumber' },
        ]"
        @back="handleContactBackToForm"
        @final-review="handleContactFinalReview"
        @update:row-selections="contactRowSelections = $event"
      >
        <template #summary>
          <DrawerContactDuplicateSummary
            :form="form"
            :display-name="contactDisplayName"
            :details-collapsed="isCollapsed('dupDetails')"
            :phones-collapsed="isCollapsed('dupPhones')"
            :prefs-collapsed="isCollapsed('dupPrefs')"
            :is-mobile="isMobile"
            :formatted-phone="getFormattedPhone"
            @toggle-details="toggleCollapse('dupDetails')"
            @toggle-phones="toggleCollapse('dupPhones')"
            @toggle-prefs="toggleCollapse('dupPrefs')"
          />
        </template>
      </DuplicateCheck>

      <ConfirmCreate
        v-if="currentStep === 3"
        :form="form"
        :errors="errors"
        :submitted="submitted"
        :can-create="canCreateContact"
        :is-saving="isSaving"
        variant="contact"
        hide-card
        hide-nav
        @create="onSave"
        @cancel="onCancel"
        @update:verified-accurate="contactVerified = $event"
        @update:form="(field: string, value: any) => { if ((form as any)[field] !== value) { (form as any)[field] = value; contactFormEditedOnStep3 = true } }"
      >
        <template #summary>
          <DrawerContactConfirmSummary
          :can-delete-phone="canDeleteContactPhone"
            :form="form"
            :errors="errors"
            :submitted="submitted"
            :is-mobile="isMobile"
            :editing-sections="editingSections"
            :toggle-section="toggleConfirmSection"
            :details-collapsed="isCollapsed('details')"
            :phones-collapsed="isCollapsed('phones')"
            :prefs-collapsed="isCollapsed('prefs')"
            :display-name="contactDisplayName"
            :address-options="addressSelectOptions"
            :editing-phone-id="editingPhoneId"
            :phone-edit-form="phoneEditForm"
            :country-options="countryOptions"
            :editing-country-code="editingPhoneCountryCode"
            :editing-country-iso="editingPhoneCountryIso"
            :formatted-phone="getFormattedPhone"
            :show-phone-error-banner="showPhoneErrorBanner"
            :phone-types-in-use="phoneTypesInUse"
            :lock-default="isDefaultPhoneLocked"
            @toggle-collapse="expandSectionForEdit"
            @apply-details="toggleConfirmSection('details')"
            @apply-phones="handleApplyPhones"
            @cancel-phones="handleCancelPhones"
            @edit-phone="editPhoneNumber"
            @remove-phone="phonePendingDelete = $event"
            @apply-phone-edit="closePhoneEdit"
            @cancel-phone-edit="discardPhoneEdit"
            @update:phone-input="updatePhoneEditFromInput"
            @form-edited="contactFormEditedOnStep3 = true"
          />
        </template>
      </ConfirmCreate>
    </StepProgress>

    <div
      v-if="currentStep === 3"
      class="confirm-verify-wrapper"
    >
      <div
        class="confirm-verify"
        :class="{ 'confirm-verify--checked': contactVerified }"
        @click="contactVerified = !contactVerified"
      >
        <Checkbox
          v-model="contactVerified"
          binary
          @click.stop
        />
        <span class="confirm-verify__label">
          I've verified the information above is accurate
        </span>
      </div>
    </div>

    <DialogConfirmDelete
      :visible="phonePendingDelete !== null"
      title="Delete Phone Number"
      :message="phoneDeleteMessage"
      @update:visible="phonePendingDelete = null"
      @confirm="confirmPhoneDelete"
      @cancel="phonePendingDelete = null"
    />

    <template #footer>
      <DrawerContactFooter
        :is-edit-mode="isEditMode"
        :current-step="currentStep"
        :is-saving="isSaving"
        :is-checking-duplicates="isCheckingContactDuplicates"
        :all-rows-dismissed="allContactRowsDismissed"
        :is-blocked="isContactBlocked"
        :is-viewing-existing="isViewingExistingContact"
        :is-loading-existing="isLoadingExistingContact"
        :can-create-contact="canCreateContact"
        :phone-edit-open="editingPhoneId !== null"
        :dirty="isDirty"
        :blocked-by-default-role="isBlockedByDefaultRole"
        @save="onSave"
        @cancel="onCancel"
        @delete="onDelete"
        @next-step="handleContactNextStep"
        @back-to-form="handleContactBackToForm"
        @final-review="handleContactFinalReview"
        @view-existing="handleViewExistingContact"
        @back-to-match="handleBackToMatch"
      />
    </template>
  </BaseDrawer>
</template>

<style src="./DrawerContactInfo.css" scoped></style>
