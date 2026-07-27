<script setup lang="ts">
interface DuplicateRow {
  id: number | string
  [key: string]: any
}

interface TableColumn {
  field: string
  header: string
  width: string
  formField?: string
}

interface Props {
  form: Record<string, any>
  partnerGroupOptions?: Record<string, any>[]
  countryOptions?: Record<string, any>[]
  phoneTypes?: { label: string, value: string }[]
  duplicateList: DuplicateRow[]
  rowSelections: Record<string, string>
  canProceedToFinalReview: boolean
  isAdvancingToReview: boolean
  columns?: TableColumn[] | null
  variant?: 'customer' | 'contact' | 'supplier'
  hideCard?: boolean
  hideNav?: boolean
  groupLabel?: string
  showNationalAccount?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  partnerGroupOptions: () => [],
  countryOptions: () => [],
  phoneTypes: () => [],
  columns: null,
  variant: 'customer',
  hideCard: false,
  hideNav: false,
  groupLabel: 'Customer Group',
  showNationalAccount: true,
})

const emit = defineEmits<{
  back: []
  'final-review': []
  'update:rowSelections': [value: Record<string, string>]
}>()

// The company/contact readonly summary applies to both partner kinds
// (customer + supplier); only the contact variant hides it.
const isCustomer = computed(() => props.variant !== 'contact')

const isMobile = ref(false)

function checkMobile() {
  isMobile.value = window.innerWidth < 768
}

onMounted(() => {
  checkMobile()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkMobile)
})

const accountCollapsedRaw = ref(true)
const contactCollapsedRaw = ref(true)
const accountCollapsed = computed(() => isMobile.value && accountCollapsedRaw.value)
const contactCollapsed = computed(() => isMobile.value && contactCollapsedRaw.value)

const duplicateTableRef = ref()
const { scrollLeft, scrollRight, isScrollable } = useTableScroll(duplicateTableRef)

const normalizePhone = digitsOnly

const companySettings = useCompanySettingsStore()

const duplicateCheckCountryIso = useCountryIsoLookup(computed(() => props.form?.country))

function getWebsiteDomain(url: string) {
  try {
    const hostname = new URL(url.trim()).hostname
    return hostname.replace(/^www-/, '').toLowerCase()
  } catch {
    return null
  }
}

// Email highlighting for the table: split into `{ text, match }` segments.
// Corporate exact → whole email; corporate same-domain → the domain; generic
// provider → the username. Kept in sync with the server filter via the shared
// getEmailMatchSegments helper.
function emailSegments(candidateEmail: string): { text: string, match: boolean }[] {
  return getEmailMatchSegments(candidateEmail, props.form.emailAddress || '', companySettings.genericEmailDomainSet)
}

function isPhoneMatch(duplicatePhone: string) {
  if (!duplicatePhone || !props.form.phoneNumber.trim()) return false
  return normalizePhone(duplicatePhone) === normalizePhone(props.form.phoneNumber)
}

function isWebsiteMatch(duplicateWebsite: string) {
  if (!duplicateWebsite || !props.form.website.trim()) return false
  const enteredDomain = getWebsiteDomain(props.form.website)
  if (!enteredDomain) return false
  const dupDomain = duplicateWebsite.replace(/^https?:\/\//, '').replace(/^www-/, '').replace(/\/$/, '').toLowerCase()
  return dupDomain === enteredDomain || dupDomain.includes(enteredDomain) || enteredDomain.includes(dupDomain)
}

// Split a company name into segments, highlighting only the portion that
// matched the entered company name (a substring match) — not the whole cell.
function getCompanyMatchSegments(duplicateName: string): { text: string, match: boolean }[] {
  if (!duplicateName) return [{ text: '—', match: false }]
  const entered = String(props.form.companyName || '').trim()
  if (!entered) return [{ text: duplicateName, match: false }]

  const dupLower = duplicateName.toLowerCase()
  const enteredLower = entered.toLowerCase()

  // Entered term appears inside the duplicate name → highlight just that slice.
  const index = dupLower.indexOf(enteredLower)
  if (index !== -1) {
    return [
      { text: duplicateName.substring(0, index), match: false },
      { text: duplicateName.substring(index, index + entered.length), match: true },
      { text: duplicateName.substring(index + entered.length), match: false },
    ].filter((segment) => segment.text !== '')
  }

  // Duplicate name is contained in the entered term → the whole name matched.
  if (enteredLower.includes(dupLower)) {
    return [{ text: duplicateName, match: true }]
  }

  return [{ text: duplicateName, match: false }]
}

// Split name into segments, marking which words match firstName/lastName.
// Accepts multi-word values in either field (e.g. "Tyrel Higbee" typed into First Name)
// by tokenizing the entered names and matching any token.
function getNameMatchSegments(fullName: string): { text: string, match: boolean }[] {
  if (!fullName) return [{ text: '—', match: false }]
  const firstName = String(props.form.firstName || '').trim().toLowerCase()
  const lastName = String(props.form.lastName || '').trim().toLowerCase()
  const enteredTokens = new Set(
    `${firstName} ${lastName}`.split(/\s+/).filter(Boolean),
  )
  const words = fullName.split(/(\s+)/)
  return words.map((word) => {
    const lower = word.trim().toLowerCase()
    if (!lower) return { text: word, match: false }
    return { text: word, match: enteredTokens.has(lower) }
  })
}

// Dynamic column match for contact variant
function isDynamicFieldMatch(col: TableColumn, rowValue: string) {
  if (!col.formField || !rowValue) return false

  const rowStr = String(rowValue).trim().toLowerCase()
  if (!rowStr) return false

  // Phone: compare digits-only form value to digits-only row value via the
  // shared `digitsOnly` util (single source of truth for phone normalization).
  if (col.field === 'phoneNumber') {
    const rowDigits = digitsOnly(rowStr)
    const phoneNumbers = props.form.phoneNumbers || props.form.phoneNumber
    if (Array.isArray(phoneNumbers)) {
      return phoneNumbers.some((p: any) => {
        const raw = digitsOnly(p.rawNumber || p.number || '')
        return raw.length >= MIN_PHONE_SEARCH_DIGITS && rowDigits === raw
      })
    }
    const formPhone = digitsOnly(props.form[col.formField] || '')
    return formPhone.length >= MIN_PHONE_SEARCH_DIGITS && rowDigits === formPhone
  }

  const formValue = props.form[col.formField]
  if (!formValue) return false
  const formStr = String(formValue).trim().toLowerCase()
  if (!formStr) return false

  if (col.field === 'emailAddress') {
    return rowStr === formStr
  }

  // Name: use getNameMatchSegments instead
  if (col.field === 'name') {
    const segments = getNameMatchSegments(rowValue)
    return segments.some((s) => s.match)
  }

  return rowStr.includes(formStr) || formStr.includes(rowStr)
}

function updateRowSelection(rowId: number | string, checked: boolean) {
  const updated = { ...props.rowSelections }
  updated[rowId] = checked ? 'not-duplicate' : ''
  emit('update:rowSelections', updated)
}
</script>

<template>
  <div :class="hideCard ? 'duplicate-check--flat' : 'step-card'">
    <div
      v-if="!hideCard"
      class="step-card__header"
    >
      <span class="step-card__title">Your Entry</span>
      <span class="step-card__subtitle">Data you entered — preserved throughout this review</span>
      <Tag
        value="Step 2 of 3"
        class="step-card__badge"
      />
    </div>

    <!-- Custom summary slot (for contacts etc.) -->
    <slot name="summary" />

    <!-- Account Information (readonly) — customer variant only -->
    <div
      v-if="isCustomer"
      class="create-form-section"
    >
      <div class="confirm-section-header">
        <Button
          :icon="accountCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
          text
          size="small"
          severity="secondary"
          class="confirm-collapse-btn"
          @click="accountCollapsedRaw = !accountCollapsedRaw"
        />
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Account Information</span>
        </div>
      </div>

      <div v-show="!accountCollapsed" class="create-form-fields create-form-fields--account">
        <div class="create-form-row">
          <div class="form-field">
            <label class="form-field__label">
              Company Name <span class="form-field__required">*</span>
            </label>
            <InputText
              :model-value="form.companyName"
              disabled
              fluid
            />
          </div>
          <div class="form-field">
            <label class="form-field__label">
              {{ groupLabel }} <span class="form-field__required">*</span>
            </label>
            <Select
              :model-value="form.partnerGroup"
              :options="partnerGroupOptions"
              option-label="name"
              option-value="id"
              disabled
              :filter="partnerGroupOptions.length > 10"
              fluid
            />
          </div>
        </div>

        <div class="create-form-row create-form-row--full">
          <div class="form-field">
            <label class="form-field__label">Website</label>
            <IconField>
              <InputText
                :model-value="form.website"
                disabled
                fluid
              />
              <InputIcon class="pi pi-globe" />
            </IconField>
          </div>
          <div
            v-if="showNationalAccount"
            class="create-checkbox-align"
          >
            <div class="checkbox-field">
              <Checkbox
                :model-value="form.isNationalAccount"
                disabled
                binary
                inputId="duplicate-national-account"
              />
              <label
                for="duplicate-national-account"
                class="checkbox-field__label"
              >
                This is a national customer account
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Initial Contact (readonly) — customer variant only -->
    <div
      v-if="isCustomer"
      class="create-form-section"
    >
      <div class="confirm-section-header">
        <Button
          :icon="contactCollapsed ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
          text
          size="small"
          severity="secondary"
          class="confirm-collapse-btn"
          @click="contactCollapsedRaw = !contactCollapsedRaw"
        />
        <div class="drawer-section__heading">
          <span class="drawer-section__title">Initial Contact</span>
        </div>
      </div>

      <div v-show="!contactCollapsed" class="create-form-fields">
        <div class="create-form-row">
          <div class="form-field">
            <label class="form-field__label">
              First Name <span class="form-field__required">*</span>
            </label>
            <InputText
              :model-value="form.firstName"
              disabled
              fluid
            />
          </div>
          <div class="form-field">
            <label class="form-field__label">
              Last Name <span class="form-field__required">*</span>
            </label>
            <InputText
              :model-value="form.lastName"
              disabled
              fluid
            />
          </div>
        </div>

        <div class="create-form-row">
          <div class="form-field">
            <label class="form-field__label">Job Title</label>
            <InputText
              :model-value="form.jobTitle"
              disabled
              fluid
            />
          </div>
          <div class="form-field">
            <label class="form-field__label">Email Address</label>
            <InputText
              :model-value="form.emailAddress"
              disabled
              fluid
            />
          </div>
        </div>

        <div class="create-form-row">
          <div class="form-field">
            <label class="form-field__label">
              Country <span class="form-field__required">*</span>
            </label>
            <Select
              :model-value="form.country"
              :options="countryOptions"
              :option-label="formatCountryLabel"
              option-value="id"
              disabled
              :filter="countryOptions.length > 10"
              fluid
            />
          </div>
          <div class="create-phone-row">
            <div class="form-field">
              <label class="form-field__label">
                Phone Number <span class="form-field__required">*</span>
              </label>
              <PhoneNumberInput
                :model-value="{ countriesId: form.country, number: form.phoneNumber, extension: form.extension }"
                :country-iso="duplicateCheckCountryIso"
                disabled
                hide-country
                hide-extension
              />
            </div>
            <div class="form-field">
              <label class="form-field__label">Extension</label>
              <InputText
                :model-value="form.extension"
                disabled
                fluid
              />
            </div>
          </div>
        </div>

        <div class="create-form-row create-form-row--phone-controls">
          <div class="form-field">
            <label class="form-field__label">Phone Type</label>
            <div class="create-radio-group">
              <div
                v-for="type in phoneTypes"
                :key="type.value"
                class="checkbox-field"
              >
                <RadioButton
                  :model-value="form.phoneType"
                  :inputId="`review-${type.value}`"
                  :value="type.value"
                  disabled
                />
                <label
                  :for="`review-${type.value}`"
                  class="checkbox-field__label"
                >{{ type.label }}</label>
              </div>
            </div>
          </div>
          <div class="create-checkbox-align">
            <div class="checkbox-field">
              <Checkbox
                :model-value="form.smsCapable"
                disabled
                binary
                inputId="duplicate-sms-capable"
              />
              <label
                for="duplicate-sms-capable"
                class="checkbox-field__label"
              >
                SMS Capable
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <Message
      v-if="duplicateList.length > 0"
      severity="warn"
      icon="pi pi-exclamation-circle"
      :closable="false"
      class="duplicate-warning"
    >
      Review potential duplicates and dismiss if no action is needed.
    </Message>

    <div
      v-if="duplicateList.length > 0"
      class="duplicate-table-wrapper"
    >
      <DataTable
        ref="duplicateTableRef"
        :value="duplicateList"
        data-key="id"
        scrollable
        scroll-height="320px"
        row-hover
      >
        <template v-if="isCustomer">
          <Column
            field="sapId"
            header="Account"
            sortable
            style="width: 120px; min-width: 120px"
          >
            <template #body="{ data: row }">
              <NuxtLink
                v-if="row.sapId"
                :to="`/customers/${row.sapId || row.id}`"
                target="_blank"
                class="duplicate-table__link"
              >
                <i class="pi pi-external-link duplicate-table__link-icon" />
                {{ row.sapId }}
              </NuxtLink>
              <span v-else>—</span>
            </template>
          </Column>

          <Column
            field="companyName"
            header="Company Name"
            sortable
            style="width: 180px; min-width: 180px"
          >
            <template #body="{ data: row }">
              <span
                v-for="(seg, idx) in getCompanyMatchSegments(row.companyName)"
                :key="idx"
                :class="{ 'duplicate-table__match': seg.match }"
              >{{ seg.text }}</span>
            </template>
          </Column>

          <Column
            field="website"
            header="Website"
            sortable
            style="width: 160px; min-width: 160px"
          >
            <template #body="{ data: row }">
              <span :class="{ 'duplicate-table__match': isWebsiteMatch(row.website) }">
                {{ row.website }}
              </span>
            </template>
          </Column>

          <Column
            field="emailAddress"
            header="Email Address"
            sortable
            style="width: 240px; min-width: 240px"
          >
            <template #body="{ data: row }">
              <template v-if="row.emailAddress">
                <span
                  v-for="(seg, idx) in emailSegments(row.emailAddress)"
                  :key="idx"
                  :class="{ 'duplicate-table__match': seg.match }"
                >{{ seg.text }}</span>
              </template>
              <span v-else>—</span>
            </template>
          </Column>

          <Column
            field="phoneNumber"
            header="Phone Number"
            sortable
            style="width: 180px; min-width: 180px"
          >
            <template #body="{ data: row }">
              <span
                class="duplicate-table__phone-cell"
                :class="{ 'duplicate-table__phone-cell--match': isPhoneMatch(row.phoneNumber) }"
              >
                <span :class="{ 'duplicate-table__match': isPhoneMatch(row.phoneNumber) }">{{ row.phoneNumberFormatted || row.phoneNumber || '—' }}</span>
                <i
                  v-if="isPhoneMatch(row.phoneNumber)"
                  class="pi pi-exclamation-circle duplicate-table__match-icon"
                />
              </span>
            </template>
          </Column>
        </template>

        <!-- Dynamic columns (for contact variant etc.) -->
        <template v-if="columns">
          <Column
            v-for="col in columns"
            :key="col.field"
            :field="col.field"
            :header="col.header"
            sortable
            :style="`width: ${col.width}; min-width: ${col.width}`"
          >
            <template #body="{ data: row }">
              <template v-if="col.field === 'name'">
                <span
                  v-for="(seg, idx) in getNameMatchSegments(row[col.field])"
                  :key="idx"
                  :class="{ 'duplicate-table__match': seg.match }"
                >{{ seg.text }}</span>
              </template>
              <template v-else-if="col.field === 'phoneNumber'">
                <span
                  class="duplicate-table__phone-cell"
                  :class="{ 'duplicate-table__phone-cell--match': col.formField && isDynamicFieldMatch(col, row[col.field]) }"
                >
                  <span :class="{ 'duplicate-table__match': col.formField && isDynamicFieldMatch(col, row[col.field]) }">
                    {{ row.phoneNumberFormatted || row[col.field] || '—' }}
                  </span>
                  <i
                    v-if="col.formField && isDynamicFieldMatch(col, row[col.field])"
                    class="pi pi-exclamation-circle duplicate-table__match-icon"
                  />
                </span>
              </template>
              <span
                v-else
                :class="{ 'duplicate-table__match': col.formField && isDynamicFieldMatch(col, row[col.field]) }"
              >
                {{ row[col.field] || '—' }}
              </span>
            </template>
          </Column>
        </template>

        <Column
          frozen
          align-frozen="right"
          style="width: 130px"
        >
          <template #header>
            <div
              v-if="isScrollable"
              class="scroll-nav"
            >
              <Button
                icon="pi pi-angle-left"
                outlined
                size="small"
                severity="secondary"
                @click="scrollLeft"
              />
              <Button
                icon="pi pi-angle-right"
                outlined
                size="small"
                severity="secondary"
                @click="scrollRight"
              />
            </div>
          </template>
          <template #body="{ data: row }">
            <div
              class="dismiss-cell"
              @click="updateRowSelection(row.id, rowSelections[row.id] !== 'not-duplicate')"
            >
              <Checkbox
                :model-value="rowSelections[row.id] === 'not-duplicate'"
                binary
                @click.stop
                @update:model-value="(checked: boolean) => updateRowSelection(row.id, checked)"
                inputId="dismiss"
              />
              <span class="dismiss-cell__label" for="dismiss">Dismiss</span>
            </div>
          </template>
        </Column>
      </DataTable>
    </div>

    <div
      v-if="duplicateList.length === 0"
      class="duplicate-empty"
    >
      <i class="pi pi-check-circle duplicate-empty__icon" />
      <span class="duplicate-empty__text">No potential duplicates found. You may proceed.</span>
    </div>

    <div
      v-if="!hideNav"
      class="step-actions step-actions--spread"
    >
      <Button
        severity="secondary"
        outlined
        size="small"
        class="step-back-btn"
        @click="$emit('back')"
      >
        <span class="step-next-icon">
          <i class="pi pi-arrow-left" />
        </span>
        Back to Form
      </Button>
      <Button
        size="small"
        :disabled="!canProceedToFinalReview || isAdvancingToReview"
        @click="$emit('final-review')"
      >
        <BaseSpinner
          v-if="isAdvancingToReview"
          size="sm"
        />
        Final Review
        <span class="step-next-icon">
          <i
            v-if="!isAdvancingToReview"
            class="pi pi-arrow-right"
          />
        </span>
      </Button>
    </div>
  </div>
</template>

<style scoped>
.step-card {
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-sm);
    padding: var(--p-spacing-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-4);
    position: relative;

    @media (min-width: 768px) {
        border-radius: var(--p-border-radius-xs);
        padding: var(--p-spacing-6);
        gap: var(--p-spacing-6);
    }
}

.step-card .create-form-section {
    @media (min-width: 768px) {
        max-width: 750px;
    }
}

.step-card__header {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
    padding-right: var(--p-spacing-20);
}

.step-card__title {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--app-color-heading);
}

.step-card__subtitle {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

.step-card__badge {
    position: absolute;
    top: var(--p-spacing-4);
    right: var(--p-spacing-4);
    z-index: 1;

    @media (min-width: 768px) {
        top: var(--p-spacing-6);
        right: var(--p-spacing-6);
    }
}

:deep(.step-card__badge.p-tag) {
    background: var(--p-surface-50);
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-xs);
    padding: var(--p-spacing-1) var(--p-spacing-3);
    border-radius: var(--p-border-radius-full);

    @media (min-width: 768px) {
        font-size: var(--p-font-size-sm);
        padding: var(--p-spacing-2) var(--p-spacing-4);
    }
}

.step-actions {
    display: flex;
    gap: var(--p-spacing-3);
    width: 100%;
}

.step-actions--spread {
    justify-content: space-between;
    align-items: center;
}

.step-actions--spread > * {
    flex: none;
}

.step-next-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--p-spacing-5);
}

.step-back-btn .step-next-icon {
    margin-right: var(--p-spacing-0-5);
}

.step-actions--spread > :last-child .step-next-icon {
    margin-left: var(--p-spacing-0-5);
}

:deep(.step-back-btn.p-button-outlined) {
    background: var(--p-surface-50);
    border-color: transparent;
    color: var(--p-deepblue-900);
    padding: var(--p-spacing-2) var(--p-spacing-3);
    white-space: nowrap;
}

:deep(.step-actions--spread > :last-child.p-button) {
    padding: var(--p-spacing-2) var(--p-spacing-3);
    white-space: nowrap;
}

:deep(.step-actions--spread > :last-child.p-button:disabled) {
    background: var(--p-surface-50);
    border-color: transparent;
    color: var(--p-surface-500);
    opacity: 1;
}

:deep(.p-datatable-tbody tr:hover .p-datatable-frozen-column) {
    background: var(--p-datatable-row-hover-background, var(--p-tideblue-50));
}

.duplicate-table-wrapper {
    overflow-x: auto;
    width: 100%;
}

.duplicate-table-wrapper :deep(.p-datatable-tbody > tr > td) {
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
    max-width: none;
}

.duplicate-table__link {
    color: var(--p-gray-800);
    text-decoration: none;
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.duplicate-table__link-icon {
    --link-icon-pad: var(--p-spacing-1);
    font-size: var(--p-font-size-xs);
    color: var(--p-primary-500) !important;
    padding: var(--link-icon-pad);
    margin: calc(-1 * var(--link-icon-pad));
    border-radius: var(--p-border-radius-xs);
    transition: background var(--p-transition-duration-fast) var(--p-transition-timing-ease-out);
}

.duplicate-table__link:hover .duplicate-table__link-icon {
    background: var(--p-tideblue-50);
}

.duplicate-table__match {
    color: var(--p-red-700);
    background: rgb(from var(--p-red-700) r g b / 7%);
}

.duplicate-table__phone-cell {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);

}

.duplicate-table__match-icon {
    color: var(--p-skyblue-400);
    font-size: var(--p-font-size-base);
    flex-shrink: 0;
    position: relative;
    top: -1px;
}

.duplicate-check--flat {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.duplicate-warning {
    margin: 0;
    width: 100%;
}

:deep(.duplicate-warning.p-message) {
    background: var(--p-orange-50);
    border-color: var(--p-orange-200);
    border-radius: var(--p-border-radius-sm);

    @media (min-width: 768px) {
        border-radius: var(--p-border-radius-xs);
    }
}

:deep(.duplicate-warning .p-message-text) {
    /* PrimeVue's default message text font-size overrides the design system;
       pin it back to the 14px token. */
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-orange-700);
}

:deep(.duplicate-warning .p-message-icon) {
    color: var(--p-orange-700);
    font-size: var(--p-font-size-base);
}

:deep(.duplicate-warning .p-message-content) {
    gap: var(--p-spacing-2);
}

.dismiss-cell {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    cursor: pointer;
}

.dismiss-cell__label {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-600);
    cursor: pointer;
    user-select: none;
}

.duplicate-empty {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
    padding: var(--p-spacing-6);
    justify-content: center;
    width: 100%;
}

.duplicate-empty__icon {
    font-size: var(--p-font-size-2xl);
    color: var(--p-vividgreen-500);
}

.duplicate-empty__text {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-600);
}

.confirm-section-header {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.confirm-section-header .drawer-section__heading {
    flex: 1;
    min-width: 0;
}

:deep(.confirm-collapse-btn.p-button) {
    color: var(--p-deepblue-900);
    border-color: var(--p-surface-200);
    padding: 0;
    width: 28px;
    height: 28px;
    min-width: 24px;
    justify-content: center;
    flex-shrink: 0;

    @media (min-width: 768px) {
        display: none;
    }
}

.create-form-fields {
    @media (min-width: 768px) {
        display: flex !important;
    }
}

.create-form-fields--account {
    @media (min-width: 768px) {
        display: flex !important;
    }
}
</style>
