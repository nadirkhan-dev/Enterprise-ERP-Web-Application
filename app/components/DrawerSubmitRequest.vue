<script setup lang="ts">
/**
 * "Add New Tool" / "Add New Feature" / "Add New Bug Report" (CONNECT-832).
 *
 * One drawer serves all three: the forms are identical apart from copy, so they
 * follow the same mode-keyed approach as DrawerRequestNewCompany rather than
 * shipping three near-duplicate files. Submitting posts the request to
 * `/api/requests`, then attaches any supporting files to it; where the request
 * ultimately lands is the server's concern, not this component's.
 */
type RequestMode = 'tool' | 'feature' | 'bug'

interface Props {
  visible?: boolean
  mode?: RequestMode
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  mode: 'tool',
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const toast = useToast()
const route = useRoute()

const localVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value),
})

// Soft limits shown by the char counters and enforced server-side; the fields
// are not hard-capped, matching how BaseCharCounter is used everywhere else.
const TITLE_LIMIT = 50
const DESCRIPTION_LIMIT = 1000

interface ModeCopy {
  title: string
  intro: string
  nameLabel: string
  namePlaceholder: string
  descriptionPlaceholder: string
  saveLabel: string
  successSummary: string
  successDetail: string
  failureDetail: string
}

// Copy is transcribed from the approved Figma frames, with three of the design's
// typos corrected: "Sumbit" → "Submit", "bug reportst" → "bug reports", and the
// bug form's mislabelled "Feature Name" → "Bug Name".
const MODE_COPY: Record<RequestMode, ModeCopy> = {
  tool: {
    title: 'Add New Tool',
    intro: 'New tool requests are added to the development team\'s backlog. Submit your request below.',
    nameLabel: 'Tool Name',
    namePlaceholder: 'Enter tool name',
    descriptionPlaceholder: 'What problem will your tool solve?',
    saveLabel: 'Submit Request',
    successSummary: 'Request Sent',
    successDetail: 'Your new tool request has been added to the backlog.',
    failureDetail: 'Could not submit the tool request. Please try again.',
  },
  feature: {
    title: 'Add New Feature',
    intro: 'New feature requests are added to the development team\'s backlog. Submit your request below.',
    nameLabel: 'Feature Name',
    namePlaceholder: 'Enter feature name',
    descriptionPlaceholder: 'What problem will your feature solve?',
    saveLabel: 'Submit Request',
    successSummary: 'Request Sent',
    successDetail: 'Your new feature request has been added to the backlog.',
    failureDetail: 'Could not submit the feature request. Please try again.',
  },
  bug: {
    title: 'Add New Bug Report',
    intro: 'New bug reports are added to the development team\'s backlog. Submit your report below.',
    nameLabel: 'Bug Name',
    namePlaceholder: 'Enter bug name',
    descriptionPlaceholder: 'What problem did you encounter?',
    saveLabel: 'Submit Report',
    successSummary: 'Report Sent',
    successDetail: 'Your bug report has been added to the backlog.',
    failureDetail: 'Could not submit the bug report. Please try again.',
  },
}

const copy = computed(() => MODE_COPY[props.mode])

const form = reactive({
  title: '',
  description: '',
})

const isSending = ref(false)
// Set once the task exists in Asana. A second Submit (or the unsaved-changes
// dialog's "Save changes", after a partial attachment failure left the drawer
// open) must retry only the attachments — creating the task again would file a
// duplicate ticket for the same request.
const createdTaskGid = ref<string | null>(null)

const {
  attachments,
  addFiles,
  removeAttachment,
  resetAttachments,
  uploadAttachments,
} = useRequestAttachments()

// Both fields are required — a backlog ticket with no title or no description
// isn't actionable by the dev team.
const canSubmit = computed(
  () => Boolean(form.title.trim()) && Boolean(form.description.trim()),
)

const { isDirty, captureBaseline, resetBaseline } = useUnsavedGuard(
  () => ({ ...form, attachmentCount: attachments.value.length }),
  localVisible,
)

// Reset to a clean form each time the drawer opens, then baseline it so an
// untouched form isn't reported as dirty.
watch(localVisible, (isOpen) => {
  if (!isOpen) { return }
  form.title = ''
  form.description = ''
  createdTaskGid.value = null
  resetAttachments()
  captureBaseline()
})

async function handleSend() {
  if (isSending.value) { return }
  if (!canSubmit.value) {
    toast.add({
      severity: 'error',
      summary: 'Validation Error',
      detail: 'A name and a description are both required.',
      life: 5000,
    })
    return
  }
  isSending.value = true

  // Already filed on a previous attempt — go straight to retrying attachments.
  if (!createdTaskGid.value) {
    const { data: created, error } = await tryCatch(
      $fetch<{ taskGid: string }>('/api/requests', {
        method: 'POST',
        headers: await buildRequestAuthHeaders(),
        body: {
          kind: props.mode,
          title: form.title.trim(),
          description: form.description.trim(),
          sourceUrl: route.fullPath,
        },
      }),
    )

    if (error || !created?.taskGid) {
      isSending.value = false
      toast.add({ severity: 'error', summary: 'Failed', detail: copy.value.failureDetail, life: 5000 })
      return
    }
    createdTaskGid.value = created.taskGid
  }

  // The ticket is filed from here on, so an attachment failure must not read as
  // a failed submission — it's reported as a partial success instead.
  const failedAttachments = await uploadAttachments(createdTaskGid.value)
  isSending.value = false

  // Baseline either way: the request is in the backlog, so closing the drawer
  // must not offer to "save" it again.
  resetBaseline()

  if (failedAttachments.length) {
    toast.add({
      severity: 'warn',
      summary: 'Submitted Without Some Files',
      detail: `Your request was added to the backlog, but ${failedAttachments.length} file(s) could not be attached.`,
      life: 6000,
    })
    // Left open on purpose: the failed rows are still listed, so the user can
    // remove them and retry, or close and follow up in Asana.
    return
  }

  toast.add({
    severity: 'success',
    summary: copy.value.successSummary,
    detail: copy.value.successDetail,
    life: 3000,
  })
  localVisible.value = false
}

function handleCancel() {
  localVisible.value = false
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="copy.title"
    title-size="xl"
    body-gap="5"
    :dirty="isDirty"
    :busy="isSending"
    @save="handleSend"
  >
    <p class="info-note submit-request__intro">
      <i class="pi pi-info-circle" />
      <span>{{ copy.intro }}</span>
    </p>

    <div class="form-field">
      <div class="submit-request__label-row">
        <span class="form-field__label">
          {{ copy.nameLabel }}
          <span class="form-field__required">*</span>
        </span>
        <BaseCharCounter
          :value="form.title"
          :max="TITLE_LIMIT"
        />
      </div>
      <InputText
        v-model="form.title"
        v-trim
        :placeholder="copy.namePlaceholder"
        :disabled="isSending"
        fluid
      />
    </div>

    <div class="form-field">
      <div class="submit-request__label-row">
        <span class="form-field__label">
          Description
          <span class="form-field__required">*</span>
        </span>
        <BaseCharCounter
          :value="form.description"
          :max="DESCRIPTION_LIMIT"
        />
      </div>
      <Textarea
        v-model="form.description"
        v-trim
        :placeholder="copy.descriptionPlaceholder"
        :rows="4"
        :disabled="isSending"
        fluid
      />
    </div>

    <Divider class="submit-request__divider" />

    <BaseFileDropzone
      :attachments="attachments"
      :disabled="isSending"
      @add="addFiles"
      @remove="removeAttachment"
    />

    <template #footer>
      <BaseActionButtons
        :save-label="copy.saveLabel"
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
.submit-request__intro {
    margin-bottom: 0;
}

/* Label on the left, char counter right-aligned on the same row — the pattern
   the contact/account drawers use for counted fields. */
.submit-request__label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--p-spacing-2);
}

/* Divider separating the request fields from Supporting Files, per the design.
   Aura's default vertical margin would double up on the body's own gap. */
.submit-request__divider.p-divider {
    margin: 0;
}
</style>
