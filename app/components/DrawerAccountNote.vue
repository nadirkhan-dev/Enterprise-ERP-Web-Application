<script setup lang="ts">
interface Props {
  visible?: boolean
  accountCode?: string | null
  remarks?: string
  businessPartnerId?: number | null
  context?: string
  isLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  accountCode: null,
  remarks: '',
  businessPartnerId: null,
  context: 'Account',
  isLoading: false,
})
const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()

const { updateBusinessPartner } = useBusinessPartners()
const toast = useToast()
// Character-limit counter (CONNECT-536) — Directus soft limit for the notes field.
const { limitFor } = useCharLimits('business_partners')
const notesLimit = computed(() => limitFor('remarks'))
const isSaving = ref(false)

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

function stripHtmlTags(html) {
  if (!html) {
    return ''
  }
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || ''
}

const noteText = ref('')

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
  snapshot: () => noteText.value,
  populate: () => {
    if (props.isLoading) { return }
    noteText.value = stripHtmlTags(props.remarks)
  },
})

async function onSave() {
  if (props.isLoading) { return }
  isSaving.value = true

  const { error } = await updateBusinessPartner(props.businessPartnerId, {
    remarks: noteText.value,
  })

  isSaving.value = false

  if (error) {
    toast.add({ severity: 'error', summary: 'Failed', detail: error.message, life: 5000 })
    return
  }

  toast.add({ severity: 'success', summary: 'Success', detail: 'Account notes updated successfully', life: 2000 })
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
    :title="`${context} Notes`"
    title-size="xl"
    :dirty="isDirty"
    :busy="isSaving"
    :show-resume-prompt="showResumePrompt"
    @save="onSave"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
    <div class="drawer-section__heading">
      <span class="drawer-section__title">
        <BaseCopyText :value="accountCode" />
      </span>
    </div>

    <div class="form-field form-field--grow">
      <div class="form-field__label-row">
        <label class="form-field__label">{{ context }} Notes</label>
        <BaseCharCounter :value="noteText" :max="notesLimit" />
      </div>
      <Textarea
        v-model="noteText"
        v-trim
        placeholder="Add your account notes here"
        :rows="20"
        fluid
        :disabled="isLoading"
      />
    </div>

    <template #footer>
      <BaseActionButtons
        :save-loading="isSaving"
        :save-disabled="isSaving || isLoading"
        @save="onSave"
        @cancel="onCancel"
      />
    </template>
  </BaseDrawer>
</template>

<style scoped>
.form-field {
    gap: var(--p-spacing-1);
}

.form-field--grow {
    flex: 1;
}

.form-field--grow :deep(.p-textarea) {
    height: 100%;
}

/* Skeleton placeholder (replaces textarea while loading) */
.note-skeleton {
    flex: 1;
    width: 100%;
    height: auto;
    min-height: var(--p-spacing-20);
    border-radius: var(--p-border-radius-md);
}
</style>
