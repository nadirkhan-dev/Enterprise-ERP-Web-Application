<script setup lang="ts">
import { triggerFlow } from '@directus/sdk'

// "Activity — Notify Account Manager" webhook flow (CONNECT-1000). Receives the
// new activity's id and resolves the recipient, business partner and content
// server-side, so the client can't redirect the email.
const ACCOUNT_MANAGER_NOTIFY_FLOW_ID = 'bc907af7-905a-4e49-b0ff-018f32dc9f14'

interface Props {
  visible?: boolean
  activity?: Record<string, any> | null
  contacts?: Record<string, any>[]
  activityGroups?: Record<string, any>[]
  businessPartnerId?: number | string | null
  // The business partner's account manager. When set and not the signed-in user,
  // a new activity offers (checked by default) to email them about it.
  accountManagerId?: string | null
  accountManagerName?: string | null
  // View-only mode: activity is past its 15-minute edit window, so all inputs
  // are disabled and the footer shows only a Close button.
  readOnly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  activity: null,
  contacts: () => [],
  activityGroups: () => [],
  businessPartnerId: null,
  accountManagerId: null,
  accountManagerName: null,
  readOnly: false,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()

const { createActivity, updateActivity } = useActivities()
const { watchActivitySyncFailure } = useSapSyncFailureWatch()
const toast = useToast()
const authStore = useAuthStore()
// Character-limit counters (CONNECT-536): echo the Directus soft limits.
const { limitFor } = useCharLimits('activities')

const isEditing = computed(() => !!props.activity)
const isSaving = ref(false)

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

/** The `activity_groups` row an edited activity currently points at. */
const editingGroup = computed(() => {
  const groupId = props.activity?.activityGroupId
  if (groupId == null) {
    return null
  }
  const group = props.activityGroups.find((candidate) => candidate.id === groupId)
  return group ? splitGroupName(group.name) : null
})

const DIRECTION_PREFIXES = ['Inbound', 'Outbound']

/** "Outbound Phone Call" → `{ direction: 'outbound', action: 'Phone Call' }`. */
function splitGroupName(name: string): { direction: string | null, action: string } {
  const label = String(name ?? '').trim()
  const prefix = DIRECTION_PREFIXES.find((candidate) => label.startsWith(`${candidate} `))
  return prefix
    ? { direction: prefix.toLowerCase(), action: label.slice(prefix.length).trim() }
    // "Meeting" carries no direction — it reads the same either way.
    : { direction: null, action: label }
}

const NOTES_CHAR_LIMIT = 1000

const TYPE_OPTIONS = [
  { label: 'Inbound', value: 'inbound', icon: 'pi pi-arrow-down' },
  { label: 'Outbound', value: 'outbound', icon: 'pi pi-arrow-up' },
]

const form = reactive({
  type: 'outbound' as string,
  contact: null as number | null,
  /** The action label ("Phone Call"), not a group id — see `selectedGroupId`. */
  action: null as string | null,
  subject: '',
  notes: '',
  notifyAccountManager: true,
})

// Only on create, only when someone else owns the relationship — an account
// manager logging their own activity has no one to tell (CONNECT-1000).
const canNotifyAccountManager = computed(() =>
  !isEditing.value
  && !props.readOnly
  && props.accountManagerId != null
  && props.accountManagerId !== authStore.user?.id,
)

// Load the assignee user list on every open (options, not form data — must run
// even when resuming preserved edits).
const {
  isDirty,
  showResumePrompt,
  markClosedAnyway,
  continueEditing,
  discardResume,
  markSaved,
} = useDrawerResumeGuard({
  isOpen: localVisible,
  recordKey: () => props.activity?.id ?? null,
  snapshot: () => ({ ...form }),
  populate: () => {
    Object.assign(form, {
      type: editingGroup.value?.direction ?? 'outbound',
      contact: props.activity?.contactJunctionId ?? null,
      action: editingGroup.value?.action ?? null,
      subject: props.activity?.subject ?? '',
      notes: props.activity?.notes ?? '',
      notifyAccountManager: true,
    })
  },
})

let dictationBase = ''
// First utterance of a session opens a new paragraph; later ones continue the
// same one, so a session reads as one thought and several read as several.
let isNewDictation = true

function joinDictation(text: string): string {
  if (!text) {
    return dictationBase
  }
  if (!dictationBase) {
    return text
  }
  return `${dictationBase.trimEnd()}${isNewDictation ? '\n\n' : ' '}${text}`
}

const {
  isSupported: isSpeechSupported,
  isRecording,
  isConnecting,
  isFinishing,
  interimText,
  audioLevels,
  startRecording,
  stopRecording,
  cancelRecording,
} = useSpeechToText({
  onSegment: (text) => {
    form.notes = joinDictation(text)
    dictationBase = form.notes
    isNewDictation = false
    hasUnimprovedEdits.value = true
  },
  onError: (message) => {
    toast.add({ severity: 'error', summary: 'Dictation', detail: message, life: 5000 })
  },
})

// The live half: words land in the field as they are heard, and are rewritten
// in place until the utterance settles.
watch(interimText, (text) => {
  if (isRecording.value || isFinishing.value) {
    form.notes = joinDictation(text)
  }
})

watch(() => props.visible, (isOpen) => {
  if (!isOpen) { cancelRecording() }
  originalNotes.value = ''
  improvedNotes.value = ''
  hasUnimprovedEdits.value = true
})

const notesPlaceholder = computed(() => {
  if (isConnecting.value) {
    return 'Connecting to recording service…'
  }
  if (isRecording.value || isFinishing.value) {
    return 'Listening…'
  }
  return isSpeechSupported.value
    ? 'Type notes or use the microphone to dictate. After that, use AI to improve your notes.'
    : 'Add your notes here'
})

const isDictating = computed(() => isRecording.value && !isConnecting.value)

// Opening and closing the transcription socket. Both ends of that round-trip
// show the spinner in place of the icon, so the button reads as "working" while
// the third-party service is being reached.
const isDictationBusy = computed(() => isConnecting.value || isFinishing.value)

const dictationIcon = computed(() =>
  isRecording.value ? 'ms:radio_button_checked' : 'pi pi-microphone',
)

/** The button's own word for what it is doing right now (per design). */
const dictationLabel = computed(() => {
  if (isConnecting.value) {
    return 'Connecting'
  }
  if (isFinishing.value) {
    return 'Finishing'
  }
  return isRecording.value ? 'Recording' : 'Record'
})

const dictationAriaLabel = computed(() => {
  if (isConnecting.value) {
    return 'Connecting to the dictation service'
  }
  if (isFinishing.value) {
    return 'Finishing the transcription of what you just said'
  }
  return isRecording.value
    ? 'Stop dictating'
    : 'Start speech to text transcription'
})

async function onToggleDictation() {
  // The tail of the last sentence is still being transcribed — pressing again
  // would only cut short the thing the user is waiting for.
  if (isFinishing.value) {
    return
  }
  if (isRecording.value || isConnecting.value) {
    stopRecording()
    return
  }
  // Anchor to whatever is already in the field so dictation appends to it.
  dictationBase = form.notes
  isNewDictation = true
  await startRecording()
}

const { isImproving, improveNotes } = useNotesImprove()

const canImproveNotes = computed(() =>
  Boolean(form.notes.trim())
  && hasUnimprovedEdits.value
  && !isRecording.value && !isConnecting.value && !isFinishing.value,
)

/**
 * Whether the notes field is the machine's to write, not the user's. Choosing
 * dictation is choosing a modality: from the moment the socket opens until the
 * last sentence is transcribed the field belongs to the microphone, and typing
 * into what is being appended to would fight it. Improve owns the field the same
 * way while the rewrite is in flight.
 */
const isNotesLocked = computed(() =>
  isRecording.value
  || isConnecting.value
  || isFinishing.value
  || isImproving.value,
)

const improveDisabledHint = computed(() => {
  if (isImproving.value) {
    return 'Improving your notes…'
  }
  if (isRecording.value || isConnecting.value || isFinishing.value) {
    return 'Finish recording first, then AI can improve your notes.'
  }
  if (!form.notes.trim()) {
    return 'Record or type your notes first — AI improves what is in this field.'
  }
  if (!hasUnimprovedEdits.value) {
    return 'These notes are already improved. Record or edit them to improve again.'
  }
  return ''
})

const notesVersionDisabledHint = computed(() => {
  if (hasImprovedNotes.value) {
    return ''
  }
  return 'Use AI Improve to rewrite your notes — you can switch back to the original here.'
})
type NotesVersion = 'original' | 'improved'

const NOTES_VERSION_OPTIONS: { label: string, value: NotesVersion }[] = [
  { label: 'Original', value: 'original' },
  { label: 'Improved', value: 'improved' },
]

const notesVersion = ref<NotesVersion>('improved')
const originalNotes = ref('')
const improvedNotes = ref('')
const hasUnimprovedEdits = ref(true)
const hasImprovedNotes = computed(() => Boolean(improvedNotes.value))

// Nothing is selected until there are two versions to choose between —
// otherwise the disabled toggle sits there highlighting "Improved" for a note
// that has never been improved.
const notesVersionSelection = computed({
  get: () => (hasImprovedNotes.value ? notesVersion.value : null),
  set: (version: NotesVersion | null) => {
    if (version) { notesVersion.value = version }
  },
})

watch(notesVersion, (version, previousVersion) => {
  // Keep any edits made while the outgoing version was on screen.
  if (previousVersion === 'original') {
    originalNotes.value = form.notes
  } else {
    improvedNotes.value = form.notes
  }
  form.notes = version === 'original' ? originalNotes.value : improvedNotes.value
})

async function onImproveNotes() {
  if (isImproving.value) {
    return
  }
  // What the user had before the rewrite, so Original can hand it back.
  const notesBeforeImprove = form.notes
  // Only ask for a subject when the field is empty — a subject the user wrote is
  // theirs, and Improve is about the notes.
  const { data: improved, error } = await improveNotes(form.notes, {
    needsSubject: !form.subject.trim(),
  })
  if (error) {
    toast.add({ severity: 'error', summary: 'AI Improve failed', detail: error.message, life: 5000 })
    return
  }
  if (!improved) {
    return
  }
  originalNotes.value = notesBeforeImprove
  improvedNotes.value = improved.notes
  notesVersion.value = 'improved'
  form.notes = improved.notes
  hasUnimprovedEdits.value = false
  // Checked again rather than trusting the request-time answer: the field is
  // live while the call is in flight, so the user may have typed a subject in
  // the meantime, and theirs wins.
  if (improved.subject && !form.subject.trim()) {
    form.subject = improved.subject
  }
}

const contactOptions = computed(() => {
  const options = props.contacts
    .filter((contact) => contact.status === 'active')
    .map((contact) => ({
      label: contact.name,
      value: contact.id,
    }))
  const selectedId = form.contact
  if (selectedId != null && !options.some((option) => option.value === selectedId)) {
    const selected = props.contacts.find((contact) => contact.id === selectedId)
    if (selected) {
      options.unshift({ label: selected.name, value: selected.id })
    }
  }
  return options
})

// Sourced from the Directus `activity_groups` collection.
const parsedGroups = computed(() =>
  props.activityGroups.map((group) => ({
    id: group.id,
    ...splitGroupName(group.name),
  })),
)
const actionOptions = computed(() => {
  const seen = new Set<string>()
  return parsedGroups.value.reduce<{ label: string, value: string }[]>((options, group) => {
    if (!seen.has(group.action)) {
      seen.add(group.action)
      options.push({ label: group.action, value: group.action })
    }
    return options
  }, [])
})

const isDirectionApplicable = computed(() => {
  if (!form.action) {
    return true
  }
  return parsedGroups.value.some(
    (group) => group.action === form.action && group.direction !== null,
  )
})

// Reads as empty while the toggle is inert, so neither option sits highlighted
// on a Meeting. `form.type` is left untouched underneath.
const directionSelection = computed({
  get: () => (isDirectionApplicable.value ? form.type : null),
  set: (value) => {
    // `allow-empty` is off, so the control only ever emits a real direction.
    if (value) {
      form.type = value
    }
  },
})

const selectedGroupId = computed<number | null>(() => {
  if (!form.action) {
    return null
  }
  const matches = parsedGroups.value.filter((group) => group.action === form.action)
  const match = matches.find((group) => group.direction === form.type)
    ?? matches.find((group) => group.direction === null)
    ?? matches[0]
  return match?.id ?? null
})

/** Persist edits to an existing activity. Returns the error, or null. */
async function saveExistingActivity(): Promise<Error | null> {
  if (!props.activity) {
    return null
  }
  const { id: activityId } = props.activity

  const { error: activityError } = await updateActivity(activityId, {
    activity_groups_id: selectedGroupId.value,
    business_partners_contacts_id: form.contact,
    subject: form.subject.trim(),
    remarks: form.notes,
  })
  if (activityError) {
    return activityError
  }

  // The Directus write succeeded; its SAP upsert runs async. Watch that sync-run
  // over the socket and toast if SAP rejects it (ServiceMaster is the source of
  // truth once connected).
  watchActivitySyncFailure(activityId)

  return null
}

/** Create a new activity. Returns the error encountered, or null on success. */
async function saveNewActivity(): Promise<Error | null> {
  if (!props.businessPartnerId) {
    return new Error('No business partner is loaded — cannot create an activity.')
  }
  const { data: createdActivity, error: activityError } = await createActivity({
    business_partners_id: props.businessPartnerId,
    activity_groups_id: selectedGroupId.value,
    business_partners_contacts_id: form.contact,
    subject: form.subject.trim(),
    remarks: form.notes,
  })
  if (activityError || !createdActivity) {
    return activityError ?? new Error('Activity creation returned no record.')
  }

  // The Directus write succeeded; its SAP upsert runs async. Watch that sync-run
  // over the socket and toast if SAP rejects it (ServiceMaster is the source of
  // truth once connected).
  watchActivitySyncFailure(createdActivity.id)

  if (canNotifyAccountManager.value && form.notifyAccountManager) {
    await notifyAccountManager(createdActivity.id)
  }

  return null
}

/**
 * Email the account manager about a just-created activity. Non-fatal: the
 * activity is already saved, so a failure only warns rather than failing the save.
 */
async function notifyAccountManager(activityId: number | string) {
  const { data: flowResponse, error } = await tryCatch(
    useDirectus().request(triggerFlow('POST', ACCOUNT_MANAGER_NOTIFY_FLOW_ID, {
      activities_id: String(activityId),
    })),
  )
  // The flow answers 200 with `{ ok: false }` on its own failure paths, so a
  // clean HTTP response alone doesn't mean the email went out.
  if (error || (flowResponse as { ok?: boolean } | null)?.ok !== true) {
    toast.add({
      severity: 'warn',
      summary: 'Email not sent',
      detail: `The activity was saved, but ${props.accountManagerName} could not be emailed about it.`,
      life: 5000,
    })
  }
}

async function onSave() {
  if (!selectedGroupId.value || !form.contact || !form.subject.trim() || !form.notes.trim()) {
    toast.add({
      severity: 'warn',
      summary: 'Missing fields',
      detail: 'Action, Contact, Subject and Notes are required.',
      life: 4000,
    })
    return
  }

  isSaving.value = true
  const saveError = isEditing.value
    ? await saveExistingActivity()
    : await saveNewActivity()
  isSaving.value = false

  if (saveError) {
    toast.add({ severity: 'error', summary: 'Failed', detail: saveError.message, life: 5000 })
    return
  }

  toast.add({
    severity: 'success',
    summary: 'Success',
    detail: isEditing.value ? 'Activity updated successfully' : 'Activity created successfully',
    life: 2000,
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
    :title="isEditing ? 'Activity' : 'Add New Activity'"
    title-size="xl"
    body-gap="5"
    fill-body
    :dirty="isDirty"
    :busy="isSaving"
    :show-resume-prompt="showResumePrompt"
    @save="onSave"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
    <!--
      Reuses the shared section heading (its ::after draws the rule) and sits the
      Type toggle after it, per design.
    -->
    <div class="type-head">
      <div class="drawer-section__heading type-head__heading">
        <span class="drawer-section__title">Type</span>
      </div>
      <SelectButton
        v-model="directionSelection"
        :options="TYPE_OPTIONS"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        :disabled="readOnly || !isDirectionApplicable"
        aria-label="Activity direction"
        class="method-toggle"
      >
        <template #option="{ option }">
          <i
            :class="option.icon"
            aria-hidden="true"
          />
          <span>{{ option.label }}</span>
        </template>
      </SelectButton>
    </div>

    <div class="form-row form-row--full">
      <div class="form-field">
        <label class="form-field__label form-field__label--required">Action</label>
        <div class="radio-group">
          <div
            v-for="action in actionOptions"
            :key="action.value"
            class="radio-option"
          >
            <RadioButton
              v-model="form.action"
              :input-id="`activity-action-${action.value}`"
              :value="action.value"
              :disabled="readOnly"
            />
            <label
              :for="`activity-action-${action.value}`"
              class="radio-option__label"
            >{{ action.label }}</label>
          </div>
        </div>
      </div>
    </div>

    <div class="drawer-section__heading">
      <span class="drawer-section__title">Contents</span>
    </div>

    <!-- Half width per design — a lone child of the two-column row grid. -->
    <div class="form-row">
      <div class="form-field">
        <label class="form-field__label form-field__label--required">Contact</label>
        <Select
          v-model="form.contact"
          :options="contactOptions"
          option-label="label"
          option-value="value"
          placeholder="Select contact"
          filter
          fluid
          :disabled="readOnly"
          panel-class="address-select-panel"
        />
      </div>
    </div>

    <div class="form-row form-row--full">
      <div class="form-field">
        <div class="form-field__label-row">
          <label class="form-field__label form-field__label--required">Subject</label>
          <BaseCharCounter
            :value="form.subject"
            :max="limitFor('subject')"
          />
        </div>
        <BaseClearableInput
          v-model="form.subject"
          v-trim
          placeholder="Enter subject"
          fluid
          :disabled="readOnly"
        />
      </div>
    </div>

    <Message
      v-if="hasImprovedNotes"
      severity="info"
      icon="pi pi-info-circle"
      :closable="false"
      class="drawer-info-banner"
    >
      AI improved your recorded notes for better structure and clarity.
    </Message>

    <div class="form-row form-row--full form-row--notes">
      <div class="form-field">
        <div class="form-field__label-row notes-label-row">
          <label class="form-field__label form-field__label--required">Notes</label>
          <BaseCharCounter
            :value="form.notes"
            :max="limitFor('remarks') ?? NOTES_CHAR_LIMIT"
          />
          <!-- Editing only: a saved activity has nothing to switch between.
               Inert until Improve has produced a second version. -->
          <span
            v-if="!readOnly"
            v-tooltip.top="notesVersionDisabledHint"
            class="notes-version-toggle-wrap"
          >
            <SelectButton
              v-model="notesVersionSelection"
              :options="NOTES_VERSION_OPTIONS"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              :disabled="isImproving || !hasImprovedNotes"
              aria-label="Notes version"
              class="method-toggle notes-version-toggle"
            >
              <template #option="{ option }">
                <AppNavIcon
                  :icon="option.value === 'original' ? 'ms:undo' : 'ms:redo'"
                  aria-hidden="true"
                />
                <span>{{ option.label }}</span>
              </template>
            </SelectButton>
          </span>
        </div>
        <div class="notes-field">
          <Textarea
            v-model="form.notes"
            v-trim
            :placeholder="notesPlaceholder"
            :rows="5"
            fluid
            :disabled="readOnly || isNotesLocked"
            class="notes-field__input"
            @update:model-value="hasUnimprovedEdits = true"
          />
          <div
            v-if="isSpeechSupported && !readOnly"
            class="notes-field__actions"
            :class="{ 'notes-field__actions--muted': isImproving }"
          >
            <!-- Live level meter: proof the microphone is hearing something,
                 which a spinner alone never gives. -->
            <div
              v-if="isDictating && audioLevels.length"
              class="notes-field__waveform"
              aria-hidden="true"
            >
              <span
                v-for="(level, index) in audioLevels"
                :key="index"
                class="notes-field__waveform-bar"
                :style="{ '--waveform-level': level }"
              />
            </div>
            <Button
              :label="dictationLabel"
              :severity="isDictating ? 'danger' : 'primary'"
              :disabled="isImproving || isFinishing"
              :aria-label="dictationAriaLabel"
              :aria-pressed="isDictating"
              outlined
              size="small"
              @click="onToggleDictation"
            >
              <template #icon>
                <BaseSpinner
                  v-if="isDictationBusy"
                  size="sm"
                  class="notes-field__spinner"
                />
                <AppNavIcon
                  v-else
                  :icon="dictationIcon"
                  aria-hidden="true"
                />
              </template>
            </Button>
            <span
              v-tooltip.top="improveDisabledHint"
              class="notes-field__button-wrap"
            >
              <Button
                :label="isImproving ? 'Improving' : 'Improve'"
                :class="{ 'notes-field__button--busy': isImproving }"
                :aria-disabled="isImproving"
                :disabled="!canImproveNotes"
                :aria-label="isImproving ? 'Improving your notes' : 'Improve notes with AI'"
                severity="primary"
                outlined
                size="small"
                @click="onImproveNotes"
              >
                <template #icon>
                  <BaseSpinner
                    v-if="isImproving"
                    size="sm"
                    class="notes-field__spinner"
                  />
                  <AppNavIcon
                    v-else
                    icon="ms:spark_summary"
                  />
                </template>
              </Button>
            </span>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="canNotifyAccountManager"
      class="checkbox-field notify-account-manager"
    >
      <Checkbox
        v-model="form.notifyAccountManager"
        input-id="activity-notify-account-manager"
        binary
      />
      <label
        for="activity-notify-account-manager"
        class="checkbox-field__label"
      >Email {{ accountManagerName }} about this activity</label>
    </div>

    <template #footer>
      <BaseActionButtons
        v-if="!readOnly"
        :save-loading="isSaving"
        :save-disabled="isSaving"
        @save="onSave"
        @cancel="onCancel"
      />
      <Button
        v-else
        label="Close"
        icon="pi pi-times"
        @click="onCancel"
      />
    </template>
  </BaseDrawer>
</template>

<style scoped>
.form-field {
    gap: var(--p-spacing-1);
}

.form-row--notes .form-field {
    gap: var(--p-spacing-3);
}

.form-row--full {
    @media (min-width: 768px) {
        grid-template-columns: 1fr;
    }
}

.form-row--full .form-field {
    @media (min-width: 768px) {
        width: 100%;
    }
}

.notify-account-manager {
    align-items: center;
}

.type-head {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.type-head__heading {
    flex: 1;
    min-width: 0;
}

.form-row--notes {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
}

.form-row--notes .form-field {
    flex: 1;
    min-height: 0;
}

.notes-label-row {
    flex-wrap: wrap;
    row-gap: var(--p-spacing-1-75);
}

.notes-version-toggle {
    flex-shrink: 0;
}

.notes-field {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
}

.notes-field__input {
    flex: 1;
    min-height: 0;
    padding-bottom: var(--p-spacing-12);
    resize: none;
    /* The field greys out the instant dictation or Improve takes it, and comes
       back the instant they let go. Easing that hand-over stops the third-party
       round-trip reading as a flicker — the field looks like it is settling into
       a state rather than being snatched. */
    transition:
        background-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out),
        border-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out),
        color var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out),
        opacity var(--p-transition-duration-normal) var(--p-transition-timing-ease-in-out);
}

/* Spans the field so the level meter can run its full width, buttons held at
   the right. With no meter the row still ends flush right, as before. */
.notes-field__actions {
    position: absolute;
    left: var(--p-spacing-3);
    right: var(--p-spacing-3);
    bottom: var(--p-spacing-3);
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--p-spacing-2);
    pointer-events: none;
}

.notes-field__actions :deep(.p-button),
.notes-field__button-wrap {
    pointer-events: auto;
}
.notes-field__actions :deep(.notes-field__button--busy) {
    pointer-events: none;
}

.notes-field__button-wrap,
.notes-version-toggle-wrap {
    display: inline-flex;
    flex-shrink: 0;
}
.notes-field__actions :deep(.p-button:not(:enabled:hover)) {
    background: var(--p-surface-0);
}

.notes-field__actions--muted :deep(.p-button:not(:enabled:hover)) {
    background: var(--p-gray-100);
}

.notes-field__actions :deep(.p-button) {
    display: flex;
    width: calc(var(--p-spacing-px) * 104);
    height: var(--p-spacing-8);
    padding: var(--p-spacing-1-5) var(--p-spacing-2-5);
    justify-content: center;
    align-items: center;
    gap: var(--p-spacing-1-75);
}

.notes-field__actions :deep(.p-button-label) {
    flex: 0 0 auto;
    font-size: var(--p-font-size-xs);
    line-height: var(--p-font-line-height-normal);
}

.notes-field__waveform {
    display: none;
    flex: 1;
    min-width: 0;
    align-items: center;
    /* Packed against the buttons: the wave starts at their edge and grows out
       to the left as the words come, newest bar always beside them. */
    justify-content: flex-end;
    gap: var(--p-spacing-px);
    height: var(--p-spacing-6);
    margin-right: var(--p-spacing-1);
    overflow: hidden;

    @media (min-width: 768px) {
        display: flex;
    }
}

.notes-field__waveform-bar {
    /* 2px where there is room, compressing rather than clipping where there
       is not — a narrow field draws a finer wave, never a cut-off one. */
    flex: 0 1 var(--p-spacing-0-5);
    min-width: var(--p-spacing-px);
    /* Never zero: a silent moment reads as a quiet line, not a gap. */
    height: calc(var(--p-spacing-1) + var(--p-spacing-5) * var(--waveform-level, 0));
    border-radius: var(--p-border-radius-xs);
    background: var(--p-deepblue-900);
    transition: height var(--p-transition-duration-fast) var(--p-transition-timing-ease-out);
}

.notes-field__actions :deep(.p-button-icon),
.notes-field__actions :deep(.app-nav-icon-svg) {
    font-size: var(--p-font-size-xs);
}

/* Holds the icon's place exactly, so the label never shifts when the spinner
   swaps in. Matches the Special Order SKU lookup button. */
.notes-field__spinner {
    width: var(--p-font-size-base);
    height: var(--p-font-size-base);
}

:deep(.form-row--full .p-inputtext),
:deep(.form-row--full .p-inputtextarea),
:deep(.form-row--full textarea.p-inputtextarea),
:deep(.form-row--full .p-textarea),
:deep(.form-row--full textarea) {
    @media (min-width: 768px) {
        width: 100%;
    }
}
</style>
