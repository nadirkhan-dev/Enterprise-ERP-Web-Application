<script setup lang="ts">
interface Props {
  visible?: boolean
  manufacturer?: Record<string, any> | null
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  manufacturer: null,
})
const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const isEditMode = computed(() => props.manufacturer !== null)

const addForm = reactive({
  selectedManufacturers: [],
  website: '',
  notes: '',
})

const manufacturerOptions = ref([
  { label: 'Manufacturer 1', value: 'manufacturer-1' },
  { label: 'Manufacturer 2', value: 'manufacturer-2' },
  { label: 'Manufacturer 3', value: 'manufacturer-3' },
  { label: 'Manufacturer 4', value: 'manufacturer-4' },
  { label: 'Manufacturer 5', value: 'manufacturer-5' },
])

// Edit mode form (only notes is editable)
const editNotes = ref('')

const {
  isDirty,
  showResumePrompt,
  markClosedAnyway,
  continueEditing,
  discardResume,
  markSaved,
} = useDrawerResumeGuard({
  isOpen: localVisible,
  recordKey: () => props.manufacturer?.id ?? null,
  snapshot: () => ({ editNotes: editNotes.value, addForm: { ...addForm } }),
  populate: () => {
    if (props.manufacturer) {
      editNotes.value = props.manufacturer.remarks || ''
    } else {
      Object.assign(addForm, {
        selectedManufacturers: [],
        website: '',
        notes: '',
      })
    }
  },
})

function onSave() {
  markSaved()
  localVisible.value = false
}

function onCancel() {
  localVisible.value = false
}

// Paste fires before the pasted text is inserted; defer past the input update
// (a macrotask) so we normalize the freshly-pasted value rather than the stale one.
function handleWebsitePaste() {
  setTimeout(() => { addForm.website = normalizeWebsite(addForm.website) }, 0)
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    title="Manufacturers"
    title-size="xl"
    body-gap="5"
    :dirty="isDirty"
    :show-resume-prompt="showResumePrompt"
    @save="onSave"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
    <template v-if="!isEditMode">
      <div class="form-field">
        <span class="form-field__label">Name</span>
        <MultiSelect
          v-model="addForm.selectedManufacturers"
          :options="manufacturerOptions"
          option-label="label"
          option-value="value"
          filter
          filter-match-mode="startsWith"
          display="comma"
          placeholder="Select manufacturers"
          fluid
        />
      </div>

      <div class="form-field">
        <span class="form-field__label">Website</span>
        <BaseClearableInput
          v-model="addForm.website"
          placeholder="website.com"
          fluid
          @blur="addForm.website = normalizeWebsite(addForm.website)"
          @paste="handleWebsitePaste"
        />
      </div>

      <div class="form-field">
        <span class="form-field__label">Notes</span>
        <Textarea
          v-model="addForm.notes"
          v-trim
          placeholder="Add your notes here"
          :rows="5"
          fluid
        />
      </div>
    </template>

    <template v-else>
      <div class="manufacturer-image">
        <BasePlaceholderIcon
          category="manufacturer"
          class="manufacturer-image__icon"
        />
      </div>

      <div class="form-field">
        <span class="form-field__label">Name</span>
        <InputText
          :model-value="manufacturer.name"
          disabled
          fluid
        />
      </div>

      <div class="form-field">
        <span class="form-field__label">Website</span>
        <InputText
          :model-value="manufacturer.website"
          disabled
          fluid
        />
      </div>

      <div class="form-row">
        <div class="form-field">
          <span class="form-field__label">Lifetime Invoice Count</span>
          <InputText
            :model-value="
              String(manufacturer.lifetimeInvoiceCount)
            "
            disabled
            fluid
          />
        </div>
        <div class="form-field">
          <span class="form-field__label">Lifetime Invoice Dollars</span>
          <InputText
            :model-value="manufacturer.lifetimeInvoiceDollars"
            disabled
            fluid
          />
        </div>
      </div>

      <div class="form-field">
        <span class="form-field__label">Notes</span>
        <Textarea
          v-model="editNotes"
          v-trim
          placeholder="Add your notes here"
          :rows="5"
          fluid
        />
      </div>
    </template>

    <template #footer>
      <BaseActionButtons
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

.manufacturer-image {
    width: 100%;
    height: calc(var(--p-spacing-px) * 200);
    background: var(--p-surface-50);
    border-radius: var(--p-border-radius-sm);
    display: flex;
    align-items: center;
    justify-content: center;
}

/* Bigger than the table-row glyph — this is a full-width banner, not a chip. */
.manufacturer-image__icon {
    width: var(--p-spacing-12);
    height: var(--p-spacing-12);
    font-size: var(--p-spacing-12);
    color: var(--p-surface-200);
}
</style>
