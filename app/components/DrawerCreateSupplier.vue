<script setup lang="ts">
/**
 * In-panel supplier creation — the create-permitted counterpart to
 * DrawerRequestNewCompany. Opened from a manufacturer's "Add New Supplier" when the
 * user may create suppliers (see usePermissions); everyone else still gets the
 * request form. It runs the exact same three-step flow as the /suppliers/create page
 * (they share useSupplierCreateForm), presented in a drawer the way contact creation
 * is — so the user never leaves the manufacturer they're associating the supplier to.
 *
 * On success it emits `created` with the new partner id; the parent associates that
 * supplier with the manufacturer and shows the toast, so the association context the
 * user opened this from is honoured.
 */
const props = withDefaults(defineProps<{
  visible?: boolean
}>(), {
  visible: false,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  created: [partnerId: string | number]
}>()

const localVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value),
})

const { isMobile } = useIsMobile()

const create = useSupplierCreateForm()
const {
  form,
  errors,
  billingErrors,
  submitted,
  isSaving,
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
  resetForm,
} = create

// Each open starts a clean form. The drawer is mounted once and reused, so — unlike
// the page, which gets a fresh composable per navigation — it must reset explicitly,
// then reload the group options and re-apply the US country default.
watch(localVisible, async (isOpen, wasOpen) => {
  if (isOpen && !wasOpen) {
    resetForm()
    await loadGroupsAndDefaults()
  }
})

async function handleCreate() {
  const newPartnerId = await createSupplier()
  if (newPartnerId == null) return

  emit('created', newPartnerId)
  localVisible.value = false
}

function handleCancel() {
  localVisible.value = false
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    title="Add New Supplier"
    title-size="xl"
    :busy="isSaving"
  >
    <!-- On desktop the 1-2-3 progress lives in the drawer header (like contact
         creation), so the body doesn't draw StepProgress's own chrome — that chrome
         includes a left connector rail meant for the full-page layout, which reads as
         a stray vertical line inside the drawer. On mobile the body keeps the chrome:
         there the rail IS the intended vertical stepper. -->
    <template
      v-if="!isMobile"
      #header
    >
      <StepProgress
        class="drawer-header-step-progress"
        :steps="steps"
        :current-step="currentStep"
      />
    </template>

    <StepProgress
      :steps="steps"
      :current-step="currentStep"
      :hide-chrome="!isMobile"
    >
      <!-- Body header — matches the contact-creation drawer: a "Your Entry" heading
           with a live "Step N of 3" badge, sitting below the header's step progress. -->
      <div class="step-card__header">
        <span class="step-card__title">Your Entry</span>
        <span class="step-card__subtitle">Data you entered — preserved throughout this review</span>
        <Tag
          :value="`Step ${currentStep} of 3`"
          class="step-card__badge"
        />
      </div>

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
        hide-nav
        hide-card
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
        hide-nav
        hide-card
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
        hide-nav
        hide-card
        :billing-errors="billingErrors"
        :billing-has-intent="billingHasIntent"
        @create="handleCreate"
        @cancel="handleCancel"
        @back-to-form="handleBackToForm"
        @update:form="handleStep3FieldUpdate"
      />
    </StepProgress>

    <!-- Step 3 verify checkbox. Its own block (not ConfirmCreate's) because
         `hide-nav` removes ConfirmCreate's verify+buttons together, and the buttons
         now live in the footer. Binds straight to the composable's verifiedAccurate,
         which gates canCreate. Mirrors the contact-creation drawer. -->
    <div
      v-if="currentStep === 3"
      class="confirm-verify-wrapper"
    >
      <div
        class="confirm-verify"
        :class="{ 'confirm-verify--checked': verifiedAccurate }"
        @click="verifiedAccurate = !verifiedAccurate"
      >
        <Checkbox
          v-model="verifiedAccurate"
          binary
          @click.stop
        />
        <span class="confirm-verify__label">
          I've verified the information above is accurate
        </span>
      </div>
    </div>

    <!-- Buttons live in the drawer footer (like contact creation), not inline in the
         step body — hence `hide-nav` on every step above. -->
    <template #footer>
      <Button
        v-if="currentStep === 1"
        :disabled="isCheckingDuplicates || !!referenceDataError"
        @click="handleNextStep"
      >
        Next Step
        <span class="drawer-create-supplier__next-icon">
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

      <div
        v-else-if="currentStep === 2"
        class="drawer-create-supplier__footer-actions"
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
          :disabled="!canProceedToFinalReview || isAdvancingToReview"
          @click="handleFinalReview"
        >
          <BaseSpinner
            v-if="isAdvancingToReview"
            size="sm"
          />
          Final Review
          <i
            v-if="!isAdvancingToReview"
            class="pi pi-arrow-right"
          />
        </Button>
      </div>

      <div
        v-else-if="currentStep === 3"
        class="drawer-create-supplier__footer-actions"
      >
        <Button
          :disabled="!canCreate || isSaving"
          @click="handleCreate"
        >
          <BaseSpinner
            v-if="isSaving"
            size="sm"
          />
          <i
            v-else
            class="pi pi-check"
          />
          Create Supplier
        </Button>
        <Button
          label="Cancel"
          icon="pi pi-times"
          severity="secondary"
          outlined
          class="drawer-create-supplier__cancel-btn"
          @click="handleCancel"
        />
      </div>
    </template>
  </BaseDrawer>
</template>

<style scoped>
.drawer-header-step-progress {
    width: 100%;
}

/* The progress component supplies its own outer padding for the page; inside the
   drawer the BaseDrawer body already owns the padding. */
:deep(.step-progress) {
    padding: 0;
}

:deep(.p-drawer-footer) {
    padding-top: var(--p-spacing-3);
}

/* Body header — "Your Entry" title + subtitle, with the "Step N of 3" badge pinned
   to the right. Mirrors the contact-creation drawer. */
.step-card__header {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
    position: relative;
    padding-right: var(--p-spacing-20);
}

.step-card__title {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

.step-card__subtitle {
    font-size: var(--p-font-size-xs);
    color: var(--p-gray-800);
}

.step-card__badge {
    position: absolute;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
}

:deep(.step-card__badge.p-tag) {
    background: var(--p-surface-50);
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-xs);
    padding: var(--p-spacing-1) var(--p-spacing-3);
    border-radius: var(--p-border-radius-full);
}

/* Header step progress — a single tidy row, gap between steps filled by the
   connector rule rather than flex spacing. */
:deep(.drawer-header-step-progress .step-header) {
    padding: 0;

    @media (min-width: 768px) {
        flex-direction: row !important;
        justify-content: flex-start;
        align-items: center;
        gap: 0;
    }
}

:deep(.drawer-header-step-progress .step-header__connector) {
    @media (min-width: 768px) {
        display: block !important;
        height: 2px;
        background: var(--app-color-rule);
        flex: 1;
        min-width: var(--p-spacing-2);
    }
}

:deep(.drawer-header-step-progress .step-header__connector--completed) {
    @media (min-width: 768px) {
        background: var(--p-vividgreen-500) !important;
    }
}

/* Step 3 section headers (Account Information / Initial Contact / Billing): the rule
   line meets the heading text with a spacing-3 gap but the Edit button with only
   spacing-2, so the line reads as tighter against the button. Even both sides to
   spacing-3 for consistent breathing room around the line. */
:deep(.confirm-section-header) {
    gap: var(--p-spacing-3);
}

/* Step 2 (DuplicateCheck) flat mode — strip the residual card margins so the review
   sits flush in the drawer, matching the contact-creation drawer. */
:deep(.duplicate-table-wrapper),
:deep(.duplicate-warning) {
    margin: 0;
}

:deep(.duplicate-empty) {
    padding: var(--p-spacing-4);
}

:deep(.duplicate-check--flat > .drawer-section) {
    margin-bottom: var(--p-spacing-4);
}

/* Paired-field column spacing — match the add-contact drawer's `.form-row`
   (var(--p-spacing-4)) rather than the wider full-page create default
   (var(--p-spacing-6)). Scoped to the drawer, so the /suppliers/create and
   /customers/create pages keep their own spacing. Mobile keeps the module's
   stacked spacing-3; only the side-by-side (≥768) gap is evened out. */
:deep(.create-form-row),
:deep(.create-form-row-2) {
    @media (min-width: 768px) {
        gap: var(--p-spacing-4);
    }
}

/* Narrow drawer only: keep Phone Type + SMS Capable on ONE line, but size them to
   content and add a gap so SMS Capable sits just after the radios with a little
   breathing room (instead of a far, equal-width half-column). Scoped here, so the
   customer/page layout is untouched. */
:deep(.create-form-row--phone-controls) {
    gap: var(--p-spacing-4);
    align-items: center;
}

:deep(.create-form-row--phone-controls > *) {
    flex: 0 0 auto;
}

:deep(.create-form-row--phone-controls > .form-field) {
    width: auto;
}

/* Verify checkbox — same treatment as the contact-creation drawer, minus its
   negative margin: the drawer body's own gap spaces it, and the negative pull made
   it overlap the section above. */
.confirm-verify-wrapper {
    padding: 0;
}

.confirm-verify {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    background: var(--p-surface-0);
    border: 1px solid var(--p-surface-200);
    padding: var(--p-spacing-2) var(--p-spacing-3);
    border-radius: var(--p-border-radius-sm);
    cursor: pointer;
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

/* Footer buttons — centered and full-width on mobile, left-aligned from tablet up,
   matching the contact drawer footer. */
.drawer-create-supplier__next-icon {
    display: inline-flex;
    align-items: center;
    margin-left: var(--p-spacing-0-5);
}

.drawer-create-supplier__footer-actions {
    display: flex;
    justify-content: center;
    align-items: stretch;
    gap: var(--p-spacing-3);
    width: 100%;

    @media (min-width: 768px) {
        justify-content: flex-start;
    }
}

.drawer-create-supplier__footer-actions > * {
    flex: 1;
    white-space: nowrap;

    @media (min-width: 768px) {
        flex: none;
    }
}

:deep(.drawer-create-supplier__cancel-btn.p-button-outlined) {
    border-color: transparent;
    background: var(--p-surface-50);
}
</style>
