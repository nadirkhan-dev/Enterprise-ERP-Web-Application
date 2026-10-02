<script setup lang="ts">
/**
 * Dashed drop area plus the list of chosen files, for the request drawers
 * (CONNECT-832). Purely presentational: the file list, validation and upload
 * state all live in useRequestAttachments(), so the same dropzone serves the
 * tool, feature and bug forms without knowing which one it is in.
 *
 * A row's `Pending` tag means "queued, will be sent when you submit" — an
 * attachment cannot be stored before the request it belongs to exists, so nothing
 * uploads on drop. See the composable for why.
 */
import type { RequestAttachment } from '~/composables/useRequestAttachments'
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  formatAttachmentSize,
  getAttachmentIcon,
} from '~/composables/useRequestAttachments'

interface Props {
  attachments: RequestAttachment[]
  /** Locks the dropzone and the per-row remove buttons while a submit is running. */
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
})

const emit = defineEmits<{
  add: [files: File[]]
  remove: [id: string]
}>()

const fileInputRef = ref<HTMLInputElement | null>(null)
// Depth counter, not a boolean: dragging over a child element fires dragleave on
// the parent, which would flicker the highlight off mid-drag.
const dragDepth = ref(0)
const isDragging = computed(() => dragDepth.value > 0)

const maxSizeLabel = `${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`

function openFilePicker() {
  if (props.disabled) { return }
  fileInputRef.value?.click()
}

function handleFileInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files?.length) {
    emit('add', Array.from(input.files))
  }
  // Clear the input so picking the same file again still fires a change event
  // (e.g. after the user removed it from the list).
  input.value = ''
}

function handleDragEnter() {
  if (props.disabled) { return }
  dragDepth.value += 1
}

function handleDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

function handleDrop(event: DragEvent) {
  dragDepth.value = 0
  if (props.disabled) { return }
  const dropped = event.dataTransfer?.files
  if (dropped?.length) {
    emit('add', Array.from(dropped))
  }
}
const FALLBACK_ERROR_MESSAGE = 'Try to upload a different file'
function getProgressMode(attachment: RequestAttachment): 'determinate' | 'indeterminate' | null {
  if (attachment.status === 'uploading') {
    return attachment.progress >= 100 ? 'indeterminate' : 'determinate'
  }
  // Held at a full bar rather than removed, so the row visibly finishes where it
  // was heading instead of the bar vanishing at the moment it completes.
  if (attachment.status === 'uploaded') {
    return 'determinate'
  }
  if (props.disabled && attachment.status === 'pending') {
    return 'indeterminate'
  }
  return null
}

const STATUS_TAGS: Record<RequestAttachment['status'], { label: string, class: string }> = {
  pending: { label: 'Pending', class: 'status-pending' },
  uploading: { label: 'Pending', class: 'status-pending' },
  uploaded: { label: 'Uploaded', class: 'status-active' },
  error: { label: 'Error', class: 'status-inactive' },
}
</script>

<template>
  <div class="file-dropzone">
    <span class="form-field__label">Supporting Files</span>

    <!-- The whole dashed area is a drop target and a click target, but the
         focusable affordance is the "Upload files" Button inside it — so the
         picker is reachable by keyboard without the wrapper itself becoming a
         control. The Button stops propagation so a click on it doesn't also fire
         the wrapper's handler and open the picker twice. -->
    <div
      class="file-dropzone__area"
      :class="{
        'file-dropzone__area--dragging': isDragging,
        'file-dropzone__area--disabled': disabled,
      }"
      @click="openFilePicker"
      @dragenter.prevent="handleDragEnter"
      @dragover.prevent
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
    >
      <i
        class="pi pi-cloud-upload file-dropzone__icon"
        aria-hidden="true"
      />
      <Button
        text
        label="Upload files"
        class="file-dropzone__trigger"
        :disabled="disabled"
        @click.stop="openFilePicker"
      />
      <span class="file-dropzone__hint">
        Drag and drop files up to {{ maxSizeLabel }} each
        <br>(spreadsheets, screenshots, etc.)
      </span>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      multiple
      :accept="ATTACHMENT_ACCEPT"
      class="visually-hidden"
      tabindex="-1"
      aria-hidden="true"
      @change="handleFileInputChange"
    >

    <ul
      v-if="attachments.length"
      class="file-dropzone__list"
    >
      <li
        v-for="attachment in attachments"
        :key="attachment.id"
        class="file-dropzone__row"
        :class="{ 'file-dropzone__row--error': attachment.status === 'error' }"
      >
        <ProgressBar
          v-if="getProgressMode(attachment)"
          :mode="getProgressMode(attachment) ?? 'determinate'"
          :value="attachment.progress"
          :show-value="false"
          class="file-dropzone__progress"
        />

        <span
          class="file-dropzone__thumb"
          :class="{ 'file-dropzone__thumb--error': attachment.status === 'error' }"
        >
          <img
            v-if="attachment.previewUrl"
            :src="attachment.previewUrl"
            :alt="attachment.name"
            class="file-dropzone__thumb-image"
          >
          <i
            v-else
            :class="getAttachmentIcon(attachment)"
            aria-hidden="true"
          />
        </span>

        <span class="file-dropzone__meta">
          <span class="file-dropzone__name">{{ attachment.name }}</span>
          <span class="file-dropzone__size">{{ formatAttachmentSize(attachment.size) }}</span>
        </span>

        <Tag :class="['file-dropzone__status', STATUS_TAGS[attachment.status].class]">
          <span>{{ STATUS_TAGS[attachment.status].label }}</span>
          <!-- Tooltip anchors on the icon, matching StatusTag's inactive-note
               treatment, so it points at what the user hovered. The message names
               the actual reason — too large, unsupported format, or a failed
               upload (see validateFile in useRequestAttachments). -->
          <i
            v-if="attachment.status === 'error'"
            v-tooltip.top="{ value: attachment.errorMessage ?? FALLBACK_ERROR_MESSAGE, class: 'file-error-tooltip' }"
            class="pi pi-info-circle file-dropzone__status-icon"
            :aria-label="attachment.errorMessage ?? FALLBACK_ERROR_MESSAGE"
          />
        </Tag>

        <Button
          icon="pi pi-times"
          text
          severity="secondary"
          size="small"
          class="file-dropzone__remove"
          :disabled="disabled"
          :aria-label="`Remove ${attachment.name}`"
          @click="emit('remove', attachment.id)"
        />
      </li>
    </ul>
  </div>
</template>

<style scoped>
.file-dropzone {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
}

/* Figma fileupload: dashed 1px box, 24px inset, 14px between the icon, title
   and hint. */
.file-dropzone__area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-3-5);
    width: 100%;
    padding: var(--p-spacing-6);
    background: var(--p-surface-0);
    border: 1px dashed var(--p-gray-200);
    border-radius: var(--p-border-radius-xs);
    text-align: center;
    cursor: pointer;
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

/* Highlight on hover, while a file is dragged over, and when the inner trigger
   takes keyboard focus — so the keyboard path gets the same affordance. */
.file-dropzone__area:hover,
.file-dropzone__area:focus-within,
.file-dropzone__area--dragging {
    background: var(--p-tideblue-50);
}

.file-dropzone__area--disabled {
    cursor: not-allowed;
    opacity: var(--p-opacity-disabled);
}

.file-dropzone__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-8);
    height: var(--p-spacing-8);
    color: var(--p-skyblue-600);
    font-size: var(--p-spacing-8);
    line-height: var(--p-font-line-height-none);
}

/* The design draws "Upload files" as an 18px bold heading, not a control, so the
   Button's own chrome is stripped back to plain text. */
.file-dropzone__trigger.p-button {
    padding: 0;
    background: transparent;
    border-color: transparent;
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);
    line-height: var(--p-spacing-6-25);
    color: var(--p-deepblue-900);
}

.file-dropzone__trigger.p-button:hover,
.file-dropzone__trigger.p-button:focus-visible {
    background: transparent;
}

.file-dropzone__hint {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-5);
    color: var(--p-gray-800);
}

.file-dropzone__list {
    display: flex;
    flex-direction: column;
    margin: var(--p-spacing-4) 0 0;
    padding: 0;
    list-style: none;
}

.file-dropzone__row {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
    padding: var(--p-spacing-3) 0;
}

.file-dropzone__progress.p-progressbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: var(--p-spacing-1);
    background: var(--p-gray-200);
    border-radius: var(--p-border-radius-full);
    overflow: hidden;
}

/* Aura eases the fill over a full second, which would leave the bar trailing an
   upload that has already moved on — shortened so it tracks the real bytes. */
.file-dropzone__progress.p-progressbar :deep(.p-progressbar-value) {
    background: var(--p-skyblue-600);
    transition: width var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.file-dropzone__thumb {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-16);
    height: var(--p-spacing-10);
    overflow: hidden;
    background: var(--p-surface-50);
    border-radius: var(--p-border-radius-xs);
    color: var(--p-gray-400);
    font-size: var(--p-font-size-xl);
}

.file-dropzone__thumb--error {
    background: var(--p-red-50);
    color: var(--p-red-500);
}

.file-dropzone__thumb-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.file-dropzone__meta {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--p-spacing-0-5);
    min-width: 0;
}

.file-dropzone__name {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-5);
    color: var(--p-gray-900);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

.file-dropzone__size {
    font-size: var(--p-font-size-xs);
    line-height: var(--p-spacing-4);
    color: var(--p-gray-600);
}

/* Failed rows read red end-to-end — filename and size included — so the row the
   user has to act on is unmistakable. */
.file-dropzone__row--error .file-dropzone__name,
.file-dropzone__row--error .file-dropzone__size {
    color: var(--p-red-500);
}

.file-dropzone__status {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
}

.file-dropzone__status-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--p-spacing-2-5);
    height: var(--p-spacing-2-5);
    color: var(--p-red-700);
    font-size: var(--p-font-size-xxs);
    line-height: var(--p-font-line-height-none);
}

.file-dropzone__remove {
    flex-shrink: 0;
}

/* Muted grey at rest, light-blue wash + brand-blue glyph on hover / focus / active
   — the shared icon-button treatment (BaseIconButton, the top-nav icons). Squared
   to border-radius-xs like every other icon button rather than a pill. */
.file-dropzone__remove.p-button {
    border-radius: var(--p-border-radius-xs);
    color: var(--p-gray-400);
}

.file-dropzone__remove.p-button:not(:disabled):hover,
.file-dropzone__remove.p-button:not(:disabled):focus-visible,
.file-dropzone__remove.p-button:not(:disabled):active {
    background: var(--p-tideblue-50);
    color: var(--p-skyblue-600);
}
</style>
