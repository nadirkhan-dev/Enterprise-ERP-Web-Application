<script setup lang="ts">
interface Props {
  visible?: boolean
  activity?: Record<string, any> | null
  contacts?: Record<string, any>[]
  activityGroups?: Record<string, any>[]
  businessPartnerId?: number | string | null
  // The account manager for this customer. Selecting a follow-up date implies a
  // follow-up is needed, so we default "Assign To" to this user.
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
const { createFollowUp, updateFollowUp } = useFollowUps()
const { fetchUsers } = useDirectusUsers()
const toast = useToast()
// Character-limit counters (CONNECT-536): echo the Directus soft limits.
const { limitFor } = useCharLimits('activities')

const isEditing = computed(() => !!props.activity)
// `hasFollowUp` means the activity is already linked to a follow-up via
// `source_follow_ups_id` — its date/assignee prefill the fields below and an
// edit writes back. The Followup Date / Assign To fields are always editable:
// when there is no linked follow-up, filling them creates one.
const hasFollowUp = computed(() => !!props.activity?.followUpId)
const isSaving = ref(false)

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const form = reactive({
  contact: null as number | null,
  action: null as number | null,
  subject: '',
  notes: '',
  followupDate: null as Date | null,
  assignTo: null as string | null,
})

// Assignee options — active users from the directus_users system collection,
// loaded lazily the first time the drawer opens.
const users = ref<Record<string, any>[]>([])

async function loadUsers() {
  if (users.value.length) {
    return
  }
  const { data: activeUsers, error } = await fetchUsers()
  if (!error && activeUsers) {
    users.value = activeUsers
  }
}

// Load the assignee user list on every open (options, not form data — must run
// even when resuming preserved edits).
watch(() => props.visible, (isOpen) => {
  if (isOpen) { loadUsers() }
})

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
      contact: props.activity?.contactJunctionId ?? null,
      action: props.activity?.activityGroupId ?? null,
      subject: props.activity?.subject ?? '',
      notes: props.activity?.notes ?? '',
      followupDate: props.activity?.followupDate ? new Date(props.activity.followupDate) : null,
      assignTo: props.activity?.assignedUserId ?? null,
    })
  },
})

// Selecting a follow-up date implies a follow-up needs to happen, so default its
// owner to the customer's account manager (e.g. an activity added to Walmart with
// a follow-up date assigns to their account manager). Only fills an EMPTY field —
// never overrides a value the user chose or one prefilled from an existing
// follow-up on edit.
watch(() => form.followupDate, (date) => {
  if (date && !form.assignTo && props.accountManagerId) {
    form.assignTo = props.accountManagerId
  }
})

const contactOptions = computed(() =>
  props.contacts.map((contact) => ({
    label: contact.name,
    value: contact.id,
  })),
)

// Sourced from the Directus `activity_groups` collection.
const actionOptions = computed(() =>
  props.activityGroups.map((group) => ({
    label: group.name,
    value: group.id,
  })),
)

const assignToOptions = computed(() => {
  const options = users.value.map((user) => ({
    label: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Unnamed',
    value: user.id,
  }))
  // The follow-up's current assignee may be a suspended user that the
  // active-user fetch excludes — keep them in the list so the prefilled
  // value still renders and shows who is assigned.
  const assignedUserId = props.activity?.assignedUserId
  if (assignedUserId && !options.some((option) => option.value === assignedUserId)) {
    options.unshift({
      label: props.activity?.assignedUserName || 'Unknown user',
      value: assignedUserId,
    })
  }
  // The account manager we auto-assign may not be in the active-user fetch (e.g.
  // suspended); keep them selectable so the defaulted value still renders.
  const accountManagerId = props.accountManagerId
  if (accountManagerId && !options.some((option) => option.value === accountManagerId)) {
    options.push({
      label: props.accountManagerName || 'Account manager',
      value: accountManagerId,
    })
  }
  return options
})

/**
 * Format a DatePicker Date as a timezone-naive datetime string
 * (`YYYY-MM-DDTHH:mm:ss`) for the Directus `follow_ups.due_date` column.
 */
function toDirectusDateTime(date: Date | null): string | null {
  if (!date) {
    return null
  }
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Build the `follow_ups` create payload for a follow-up sourced from the given
 * activity. The `sources` m2a links the new follow-up back to that activity.
 */
function buildFollowUpPayload(activityId: number | string): Record<string, unknown> {
  return {
    subject: form.subject.trim(),
    activity_groups_id: form.action,
    assigned_user_id: form.assignTo,
    due_date: toDirectusDateTime(form.followupDate),
    sources: [{ sources_collection: 'activities', sources_id: activityId }],
  }
}

/**
 * Persist edits to an existing activity. Its follow-up is then updated (when
 * one is linked) or created (when none is). Returns the first error, or null.
 */
async function saveExistingActivity(isFollowUpComplete: boolean): Promise<Error | null> {
  if (!props.activity) {
    return null
  }
  const { id: activityId, followUpId } = props.activity

  const { error: activityError } = await updateActivity(activityId, {
    activity_groups_id: form.action,
    business_partners_contacts_id: form.contact,
    subject: form.subject.trim(),
    remarks: form.notes,
  })
  if (activityError) {
    return activityError
  }

  if (!isFollowUpComplete) {
    return null
  }

  // Update the linked follow-up, or create one when the activity has none.
  if (hasFollowUp.value) {
    const { error: updateError } = await updateFollowUp(followUpId, {
      subject: form.subject.trim(),
      due_date: toDirectusDateTime(form.followupDate),
      assigned_user_id: form.assignTo,
    })
    return updateError ?? null
  }

  const { error: createError } = await createFollowUp(buildFollowUpPayload(activityId))
  return createError ?? null
}

/**
 * Create a new activity, then a follow-up sourced from it when the follow-up
 * fields are filled. Returns the first error encountered, or null on success.
 */
async function saveNewActivity(isFollowUpComplete: boolean): Promise<Error | null> {
  if (!props.businessPartnerId) {
    return new Error('No business partner is loaded — cannot create an activity.')
  }
  const { data: createdActivity, error: activityError } = await createActivity({
    business_partners_id: props.businessPartnerId,
    activity_groups_id: form.action,
    business_partners_contacts_id: form.contact,
    subject: form.subject.trim(),
    remarks: form.notes,
  })
  if (activityError || !createdActivity) {
    return activityError ?? new Error('Activity creation returned no record.')
  }

  if (isFollowUpComplete) {
    const { error: followUpError } = await createFollowUp(buildFollowUpPayload(createdActivity.id))
    if (followUpError) {
      return followUpError
    }
  }
  return null
}

async function onSave() {
  if (!form.action || !form.subject.trim()) {
    toast.add({
      severity: 'warn',
      summary: 'Missing fields',
      detail: 'Action and Subject are required.',
      life: 4000,
    })
    return
  }

  // A follow-up needs both of its fields. Mandatory when editing one that
  // already exists; optional (all-or-nothing) when creating an activity or
  // adding a follow-up to an existing activity that has none.
  const isFollowUpComplete = !!form.followupDate && !!form.assignTo
  const hasFollowUpInput = !!form.followupDate || !!form.assignTo

  if (isEditing.value && hasFollowUp.value && !isFollowUpComplete) {
    toast.add({
      severity: 'warn',
      summary: 'Missing fields',
      detail: 'Followup Date and Assign To are required.',
      life: 4000,
    })
    return
  }
  if (!(isEditing.value && hasFollowUp.value) && hasFollowUpInput && !isFollowUpComplete) {
    toast.add({
      severity: 'warn',
      summary: 'Missing fields',
      detail: 'Enter both Followup Date and Assign To, or leave both blank.',
      life: 4000,
    })
    return
  }

  isSaving.value = true
  const saveError = isEditing.value
    ? await saveExistingActivity(isFollowUpComplete)
    : await saveNewActivity(isFollowUpComplete)
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
    :title="isEditing ? 'Activity' : 'New Activity'"
    title-size="xl"
    :dirty="isDirty"
    :busy="isSaving"
    :show-resume-prompt="showResumePrompt"
    @save="onSave"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
    <div class="form-row">
      <div class="form-field">
        <label class="form-field__label">Contact</label>
        <Select
          v-model="form.contact"
          :options="contactOptions"
          option-label="label"
          option-value="value"
          placeholder="Select a contact"
          filter
          fluid
          :disabled="readOnly"
          panel-class="address-select-panel"
        />
      </div>
      <div class="form-field">
        <label class="form-field__label form-field__label--required">Action</label>
        <Select
          v-model="form.action"
          :options="actionOptions"
          option-label="label"
          option-value="value"
          placeholder="Select an action"
          :filter="actionOptions.length > 10"
          fluid
          :disabled="readOnly"
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

    <div class="form-row form-row--full">
      <div class="form-field">
        <div class="form-field__label-row">
          <label class="form-field__label">Notes</label>
          <BaseCharCounter
            :value="form.notes"
            :max="limitFor('remarks')"
          />
        </div>
        <Textarea
          v-model="form.notes"
          v-trim
          placeholder="Add your notes here"
          :rows="5"
          fluid
          :disabled="readOnly"
        />
      </div>
    </div>

    <!-- Followup Date / Assign To -->
    <div class="form-row">
      <div class="form-field">
        <label :class="['form-field__label', { 'form-field__label--required': hasFollowUp }]">Followup Date</label>
        <DatePicker
          v-model="form.followupDate"
          show-icon
          icon-display="input"
          :disabled="readOnly"
        />
      </div>
      <div class="form-field">
        <label :class="['form-field__label', { 'form-field__label--required': hasFollowUp }]">Assign To</label>
        <Select
          v-model="form.assignTo"
          :options="assignToOptions"
          option-label="label"
          option-value="value"
          placeholder="Select assignee"
          :filter="assignToOptions.length > 10"
          :disabled="readOnly"
        />
      </div>
    </div>

    <template #footer>
      <BaseActionButtons
        v-if="!readOnly"
        :save-loading="isSaving"
        :save-disabled="isSaving"
        @save="onSave"
        @cancel="onCancel"
      />
      <!-- Read-only (locked) view: only a Close button, in the save button's spot. -->
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
