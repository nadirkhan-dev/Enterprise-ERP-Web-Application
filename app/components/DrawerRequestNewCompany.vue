<script setup lang="ts">
import { triggerFlow } from '@directus/sdk'

type RequestMode = 'supplier' | 'manufacturer' | 'competitor'

const NEW_COMPANY_FLOW_ID = 'c2256a4b-c67a-4c23-9ce4-d33c20fedd0c'

interface Props {
  visible?: boolean
  mode?: RequestMode
  manufacturerId?: number | string | null
  businessPartnerId?: number | string | null
  backTo?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  mode: 'supplier',
  manufacturerId: null,
  businessPartnerId: null,
  backTo: null,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  // "Back" in the header — the parent reopens the picker this form was launched
  // from. Only ever emitted when `backTo` is set.
  back: []
}>()

const toast = useToast()

const localVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value),
})

const MODE_COPY: Record<RequestMode, { label: string, title: string }> = {
  supplier: { label: 'supplier', title: 'Add New Supplier' },
  manufacturer: { label: 'manufacturer', title: 'Add New Manufacturer' },
  competitor: { label: 'competitor', title: 'Add New Competitor' },
}

const copy = computed(() => MODE_COPY[props.mode])
// "supplier" / "manufacturer" / "competitor", woven into the form's copy and toasts.
const companyLabel = computed(() => copy.value.label)
// Capitalized — "Supplier" / "Manufacturer" / "Competitor" — for field labels and
// sentence-leading copy.
const companyLabelTitle = computed(
  () => `${companyLabel.value.charAt(0).toUpperCase()}${companyLabel.value.slice(1)}`,
)
const drawerTitle = computed(() => copy.value.title)

const form = reactive({
  companyName: '',
  website: '',
  remarks: '',
})

const isSending = ref(false)

// Set once "Submit Request" is pressed so field errors only surface after an
// attempt, matching the customer/supplier create forms.
const submitted = ref(false)
const errors = reactive({ website: '' })
// Clear the website error the moment the user edits the field, so fixing a bad
// URL removes the red in real time instead of waiting for the next send.
useClearErrorsOnEdit(form, errors)

// Company name is the only required field — you can't request a company without
// naming it.
const canSubmit = computed(() => Boolean(form.companyName.trim()))

// Website is optional, but when provided it must be a proper URL with a protocol
// — same rule the add-customer / add-supplier create forms enforce.
function validateWebsite() {
  errors.website = ''
  const websiteValue = form.website.trim()
  if (websiteValue && !(/^https?:\/\//).test(websiteValue)) {
    errors.website = 'Website must start with http:// or https://'
  }
}

const { isDirty, captureBaseline, resetBaseline } = useUnsavedGuard(
  () => ({ ...form }),
  localVisible,
)

// Reset to a clean form each time the drawer opens, then baseline it so an
// untouched form isn't reported as dirty.
watch(localVisible, (isOpen) => {
  if (!isOpen) { return }
  form.companyName = ''
  form.website = ''
  form.remarks = ''
  submitted.value = false
  errors.website = ''
  captureBaseline()
})

async function handleSend() {
  if (isSending.value) { return }
  submitted.value = true
  validateWebsite()
  if (!canSubmit.value || errors.website) {
    toast.add({
      severity: 'error',
      summary: 'Validation Error',
      detail: errors.website || 'Please fix the highlighted fields before continuing.',
      life: 5000,
    })
    return
  }
  isSending.value = true

  const payload: Record<string, string | number> = {
    request_type: props.mode,
    company_name: form.companyName.trim(),
    website: normalizeWebsite(form.website) as string,
    remarks: form.remarks.trim(),
  }

  if ((props.mode === 'supplier' || props.mode === 'competitor') && props.manufacturerId != null) {
    payload.manufacturers_id = props.manufacturerId
  }
  else if (props.mode === 'manufacturer' && props.businessPartnerId != null) {
    payload.business_partners_id = props.businessPartnerId
  }

  const { error } = await tryCatch(
    useDirectus().request(triggerFlow('POST', NEW_COMPANY_FLOW_ID, payload as Record<string, string>)),
  )
  isSending.value = false

  if (error) {
    toast.add({ severity: 'error', summary: 'Failed', detail: `Could not send the ${companyLabel.value} request. Please try again.`, life: 5000 })
    return
  }

  toast.add({ severity: 'success', summary: 'Request Sent', detail: `Your new ${companyLabel.value} request has been submitted.`, life: 3000 })
  resetBaseline()
  localVisible.value = false
}

function handleCancel() {
  localVisible.value = false
}

// "Back": return to the picker this form was launched from. Tell the parent to
// reopen it, then close — an explicit navigation, so it discards like Cancel
// rather than tripping the unsaved-changes guard.
function handleBack() {
  emit('back')
  resetBaseline()
  localVisible.value = false
}

// Website is normalized on blur so what's sent (and shown in the email) is clean.
// Paste fires before the value is inserted; defer a macrotask to normalize the
// freshly-pasted text rather than the stale value.
function handleWebsitePaste() {
  setTimeout(() => { form.website = normalizeWebsite(form.website) as string }, 0)
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="drawerTitle"
    title-size="xl"
    body-gap="5"
    :dirty="isDirty"
    :busy="isSending"
    @save="handleSend"
  >
    <!-- Launched from a picker: the header's title is replaced by the route back
         to it. Opened directly (the Manufacturers list "New" button), the slot
         is withheld so BaseDrawer falls back to the plain title. -->
    <template
      v-if="backTo"
      #title
    >
      <Button
        text
        class="request-company__back"
        @click="handleBack"
      >
        <i class="pi pi-arrow-left" />
        <span>Back to {{ backTo }}</span>
      </Button>
    </template>

    <p class="info-note request-company__intro">
      <i class="pi pi-info-circle" />
      <span>New {{ companyLabel }}s are created by the operations team. Submit your request below.</span>
    </p>

    <div class="form-field">
      <span class="form-field__label">
        {{ companyLabelTitle }} Name
        <span class="form-field__required">*</span>
      </span>
      <InputText
        v-model="form.companyName"
        v-trim
        :placeholder="`Enter ${companyLabel} name`"
        fluid
      />
    </div>

    <div class="form-field">
      <span class="form-field__label">Website</span>
      <IconField>
        <InputText
          v-model="form.website"
          :invalid="submitted && errors.website !== ''"
          placeholder="Enter website URL"
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
      <small
        v-if="submitted && errors.website"
        class="form-field__error"
      >{{ errors.website }}</small>
    </div>

    <div class="form-field">
      <span class="form-field__label">Remarks</span>
      <Textarea
        v-model="form.remarks"
        v-trim
        :placeholder="`Why are you requesting this ${companyLabelTitle} be added?`"
        :rows="5"
        fluid
      />
    </div>

    <template #footer>
      <BaseActionButtons
        save-label="Submit Request"
        :save-loading="isSending"
        :save-disabled="!canSubmit"
        @save="handleSend"
        @cancel="handleCancel"
      />
    </template>
  </BaseDrawer>
</template>

<style scoped>
.form-field {
    gap: var(--p-spacing-1);
}

/* The drawer body is a flex column with its own gap — drop the shared note's
   bottom margin so the space below it isn't doubled. */
.request-company__intro {
    margin-bottom: 0;
}

/* Header back button — matches the association drawer's "← Back to {list}"
   treatment (bold title-sized text, arrow, no background wash on hover). */
.request-company__back.p-button {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
    padding: 0;
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);

    @media (min-width: 768px) {
        font-size: var(--p-font-size-xl);
    }
}

.request-company__back.p-button:hover {
    background: transparent;
    color: var(--p-deepblue-700);
}

.request-company__back .pi {
    font-size: var(--p-font-size-sm);
}
</style>
