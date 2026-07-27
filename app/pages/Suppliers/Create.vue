<script setup lang="ts">
useHead({ title: 'Create Supplier' })

const FORM_STORAGE_KEY = 'create-supplier-state'

// Resolve the toast during setup, not inside the async create handler: useToast()
// relies on inject, which only works in the synchronous setup context — calling it
// after an await throws "No PrimeVue Toast provided!". Mirrors Customers/Create.vue.
const toast = useToast()

const { loadBusinessPartnerCreateRights, canCreateBusinessPartner } = usePermissions()

// The whole create flow — form, validation, duplicate gate, create call — lives in
// this composable, shared with the in-panel DrawerCreateSupplier. The page keeps
// only its own chrome: the permission redirect, session persistence, and where to
// go on success/cancel.
const create = useSupplierCreateForm()
const {
  form,
  errors,
  billingErrors,
  submitted,
  isSaving,
  saveCompleted,
  isCheckingDuplicates,
  currentStep,
  verifiedAccurate,
  isAdvancingToReview,
  supplierGroupOptions,
  referenceDataError,
  logoPreviewUrl,
  duplicateList,
  rowSelections,
  steps,
  phoneTypes,
  countryOptions,
  selectedCountryIso,
  billingHasIntent,
  canProceedToFinalReview,
  canCreate,
  handleFileSelect,
  loadGroupsAndDefaults,
  handleNextStep,
  handleFinalReview,
  handleBackToForm,
  handleStep3FieldUpdate,
  createSupplier,
} = create

watch(currentStep, async (step) => {
  if (typeof window === 'undefined') return
  if (step !== 2 || duplicateList.value.length === 0) return
  await nextTick()
  const target = document.querySelector('.duplicate-warning, .duplicate-table-wrapper') as HTMLElement | null
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
})

const { save: saveFormState, restore: restoreFormState, clear: clearFormState }
  = useFormSessionPersistence(
    FORM_STORAGE_KEY,
    () => ({
      form: { ...form },
      currentStep: currentStep.value,
      duplicateList: duplicateList.value,
      rowSelections: rowSelections.value,
      submitted: submitted.value,
    }),
    (state: any) => {
      Object.assign(form, state.form)
      currentStep.value = state.currentStep
      duplicateList.value = state.duplicateList || []
      rowSelections.value = state.rowSelections || {}
      submitted.value = state.submitted || false
    },
  )

onMounted(async () => {
  // The Suppliers list only routes people here when they may create a supplier,
  // but the URL is typeable — so the page checks for itself rather than trusting
  // how it was reached. Without the right, this form can only ever end in a 403
  // on save, so send them back to the list, where "New" offers the request form.
  await loadBusinessPartnerCreateRights()
  if (!canCreateBusinessPartner('supplier')) {
    navigateTo('/suppliers')
    return
  }

  const restored = restoreFormState()
  await loadGroupsAndDefaults({ skipDefaults: restored })
})

async function handleCreateSupplier() {
  const newPartnerId = await createSupplier()
  if (newPartnerId == null) return

  clearFormState()
  toast.add({ severity: 'success', summary: 'Success', detail: 'Supplier created successfully', life: 3000 })

  // Key the detail route on the Directus id — present immediately, whereas
  // `account_number` is assigned later by the SAP sync flow. The detail page resolves
  // either form and watches the socket to fill the SAP id in once it syncs.
  // Tell the detail page this record was just created, so it shows "syncing"
  // (a sync is genuinely firing) rather than the reopen "not synced" state.
  useJustCreatedPartner().markJustCreated(newPartnerId)
  navigateTo(`/suppliers/${newPartnerId}`, { replace: true })
}

function handleCancel() {
  saveCompleted.value = true
  clearFormState()
  navigateTo('/suppliers')
}

onBeforeRouteLeave((to) => {
  const isSupplierDetail = typeof to.path === 'string' && /^\/suppliers\/[^/]+$/.test(to.path) && to.path !== '/suppliers/create'
  if (isSupplierDetail && !saveCompleted.value) {
    saveFormState()
  } else {
    clearFormState()
  }
})
</script>

<template>
  <div class="supplier-create-page">
    <BaseBackButton
      to="/suppliers"
      label="Back to Suppliers"
      class="supplier-create-back"
    />

    <StepProgress
      :steps="steps"
      :current-step="currentStep"
    >
      <CreateCustomerStep1
        v-if="currentStep === 1"
        :form="form"
        :errors="errors"
        :submitted="submitted"
        :partner-group-options="supplierGroupOptions"
        :country-options="countryOptions"
        :phone-types="phoneTypes"
        :is-checking-duplicates="isCheckingDuplicates"
        :reference-data-error="referenceDataError"
        :selected-country-iso="selectedCountryIso"
        :logo-preview-url="logoPreviewUrl"
        allow-logo-upload
        variant="supplier"
        group-label="Supplier Group"
        :show-national-account="false"
        :require-website="false"
        :require-email="false"
        billing-only
        :billing-errors="billingErrors"
        :billing-has-intent="billingHasIntent"
        @logo-select="handleFileSelect"
        @next-step="handleNextStep"
      />

      <DuplicateCheck
        v-if="currentStep === 2"
        :form="form"
        :partner-group-options="supplierGroupOptions"
        :country-options="countryOptions"
        :phone-types="phoneTypes"
        :duplicate-list="duplicateList"
        :row-selections="rowSelections"
        :can-proceed-to-final-review="canProceedToFinalReview"
        :is-advancing-to-review="isAdvancingToReview"
        variant="supplier"
        group-label="Supplier Group"
        :show-national-account="false"
        @back="handleBackToForm"
        @final-review="handleFinalReview"
        @update:row-selections="rowSelections = $event"
      />

      <ConfirmCreate
        v-if="currentStep === 3"
        :form="form"
        :errors="errors"
        :submitted="submitted"
        :partner-group-options="supplierGroupOptions"
        :country-options="countryOptions"
        :phone-types="phoneTypes"
        :logo-preview-url="logoPreviewUrl"
        :can-create="canCreate"
        :is-saving="isSaving"
        variant="supplier"
        group-label="Supplier Group"
        :show-national-account="false"
        create-label="Create Supplier"
        billing-only
        :billing-errors="billingErrors"
        :billing-has-intent="billingHasIntent"
        @create="handleCreateSupplier"
        @cancel="handleCancel"
        @back-to-form="handleBackToForm"
        @update:verified-accurate="verifiedAccurate = $event"
        @update:form="handleStep3FieldUpdate"
      />
    </StepProgress>
  </div>
</template>

<style scoped>
.supplier-create-page {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: 0;
    padding-bottom: var(--p-spacing-4);
    margin-bottom: calc(-1 * var(--p-spacing-4));
}

.supplier-create-back {
    display: none;

    @media (min-width: 768px) {
        display: inline-flex;
    }
}
</style>
