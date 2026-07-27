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
})
const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()

const referenceData = useReferenceDataStore()
const { fetchRules, getRules } = useFieldValidation()

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const isEditMode = computed(() => props.contact !== null)
// Adding the partner's first/only contact → force "primary" on and lock it,
// the same way a lone address is the locked default.
const isPrimaryLocked = computed(() => !isEditMode.value && props.isFirstContact)
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
  validateContactFields,
  validatePhoneRows,
  hasShortPhone,
} = useContactForm(addresses)

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
})

// Disable the drawer's Save/Next while a phone edit form is open (adding or
// editing) and not yet committed; it re-enables once the user saves or discards
// that phone, since that returns editingPhoneId to null.
const isPhoneEditOpen = computed(() => editingPhoneId.value !== null)

const {
  contactDuplicateList,
  contactRowSelections,
  isCheckingContactDuplicates,
  contactVerified,
  contactFormEditedOnStep3,
  allContactRowsDismissed,
  takeStep3Snapshot,
  hasDuplicateFieldsChangedOnStep3,
  hasDuplicateFieldsChanged,
  populateOriginalDuplicateFields,
  searchContactDuplicates,
  resetDuplicateState,
} = useContactDuplicates(form, normalizeContactPhone)

// Snapshot the contact form for dirty-tracking across the multi-step flow.
// Phone rows are normalised to only their meaningful fields, and a row counts
// ONLY when it actually carries a number or extension — clicking "Add phone"
// pushes a blank row (with a default country) that must NOT mark the form
// dirty until the user enters something. The row being actively edited reads
// from the live edit-form, since its value isn't written back to
// form.phoneNumbers until the edit is committed.
function getContactSnapshot() {
  const phoneNumbers = form.phoneNumbers
    .map((phone) =>
      editingPhoneId.value === phone.id
        ? {
            type: phoneEditForm.type,
            countryId: phoneEditForm.country,
            rawNumber: phoneEditForm.phoneNumber,
            extension: phoneEditForm.extension,
            smsCapable: phoneEditForm.smsCapable,
          }
        : {
            type: phone.type,
            countryId: phone.countryId,
            rawNumber: phone.rawNumber,
            extension: phone.extension,
            smsCapable: phone.smsCapable,
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
  } else if (props.isFirstContact) {
    // First/only contact for this partner → auto-default as sales + billing,
    // mirroring addresses (a lone address is the default). Locked in the UI.
    form.isPrimaryContact = true
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
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="hasLoadError ? 'Internal Error Occured' : 'Contact Information'"
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
      />
    </template>

  <DrawerContactStatusSection
      v-if="isEditMode && currentStep === 1"
      :form="form"
      :errors="errors"
      :submitted="submitted"
      :display-name="contactDisplayName"
    />

    <StepProgress
      :steps="contactSteps"
      :current-step="currentStep"
      :hide-chrome="!isMobile || (isEditMode && currentStep === 1)"
      :class="{ 'step-progress--confirm': currentStep === 3 }"
    >
      <div
        v-if="!isEditMode || currentStep > 1"
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
          @edit-phone="editPhoneNumber"
          @remove-phone="removePhoneNumber"
          @add-phone="addPhoneNumber"
          @close-phone-edit="discardPhoneEdit"
          @save-phone-edit="closePhoneEdit"
          @update:phone-input="updatePhoneEditFromInput"
          @update:phone-numbers="form.phoneNumbers = $event"
        />
        <DrawerContactPreferences :form="form" />
      </template>

      <DuplicateCheck
        v-if="currentStep === 2"
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
            @toggle-collapse="expandSectionForEdit"
            @apply-details="toggleConfirmSection('details')"
            @apply-phones="handleApplyPhones"
            @cancel-phones="handleCancelPhones"
            @edit-phone="editPhoneNumber"
            @remove-phone="removePhoneNumber"
            @close-phone-edit="discardPhoneEdit"
            @save-phone-edit="closePhoneEdit"
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

    <template #footer>
      <DrawerContactFooter
        :is-edit-mode="isEditMode"
        :current-step="currentStep"
        :is-saving="isSaving"
        :is-checking-duplicates="isCheckingContactDuplicates"
        :all-rows-dismissed="allContactRowsDismissed"
        :can-create-contact="canCreateContact"
        :phone-edit-open="isPhoneEditOpen"
        @save="onSave"
        @cancel="onCancel"
        @delete="onDelete"
        @next-step="handleContactNextStep"
        @back-to-form="handleContactBackToForm"
        @final-review="handleContactFinalReview"
      />
    </template>
  </BaseDrawer>
</template>

<style src="./DrawerContactInfo.css" scoped></style>
