import type { TryCatchResult } from '~/types/api'
import { useDirectus } from '~/composables/useDirectus'

/**
 * Supporting-file state for the tool / feature / bug request drawers
 * (CONNECT-832).
 *
 * An attachment cannot be stored before the request it belongs to exists, so
 * files cannot upload as they are dropped. They are held here instead and sent
 * once "Submit" has filed the request — which is why a row sits at `pending`
 * until submit rather than uploading immediately. Client-side rejects (too big,
 * unsupported type) are flagged `error` on drop, so the user learns about a bad
 * file before they commit to submitting.
 */

/** Mirrors MAX_ATTACHMENT_BYTES on the server — the forms say 50 MB. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

const ALLOWED_ATTACHMENT_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/zip',
])

/** `accept` for the file input — keeps the OS picker aligned with the allowlist. */
export const ATTACHMENT_ACCEPT = [...ALLOWED_ATTACHMENT_MIME].join(',')

export type AttachmentStatus = 'pending' | 'uploading' | 'uploaded' | 'error'

export interface RequestAttachment {
  /** Stable row key — the File object itself isn't reliable as a key. */
  id: string
  file: File
  name: string
  size: number
  type: string
  status: AttachmentStatus
  /** 0–100 while the row is uploading. Drives the row's progress bar. */
  progress: number
  /**
   * Rejected before it was ever sent (too large, unsupported type). Such a row
   * is never uploaded and never retried — re-sending it would only trade its
   * accurate reason for a generic "upload failed".
   */
  isRejected: boolean
  /** Object URL for image previews; null for non-images. Revoked on removal. */
  previewUrl: string | null
  errorMessage: string | null
}

/** Human-readable size, matching the design's "124.488 KB" style. */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(3)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** PrimeIcon for a row's thumbnail when there is no image preview to show. */
export function getAttachmentIcon(attachment: RequestAttachment): string {
  if (attachment.type.startsWith('image/')) {
    return 'pi pi-image'
  }
  if (attachment.type.startsWith('video/')) {
    return 'pi pi-video'
  }
  if (attachment.type === 'application/pdf') {
    return 'pi pi-file-pdf'
  }
  if (attachment.type.includes('spreadsheet') || attachment.type.includes('excel') || attachment.type === 'text/csv') {
    return 'pi pi-file-excel'
  }
  if (attachment.type.includes('word')) {
    return 'pi pi-file-word'
  }
  return 'pi pi-file'
}

/**
 * The caller's own Directus token, for the `/api/requests/*` routes — they
 * authenticate the user before filing anything. Shared with the request drawer so
 * the task-creation call and the attachment calls authenticate identically.
 */
export async function buildRequestAuthHeaders(): Promise<Record<string, string>> {
  const directus = useDirectus()
  const token = await directus.getToken()
  if (!token) return {}
  return { Authorization: `Bearer ${token}` }
}

export function useRequestAttachments() {
  const attachments = ref<RequestAttachment[]>([])

  // Monotonic row ids — unique for the life of the page without relying on file
  // names, which repeat (three screenshots all called "image.png").
  let nextRowId = 0

  /**
   * Rows worth sending: everything except the already-uploaded (no double
   * attaching on a retry) and the client-rejected. A row that failed server-side
   * IS included, so pressing Submit again retries it.
   */
  const sendableAttachments = computed(() =>
    attachments.value.filter((row) => !row.isRejected && row.status !== 'uploaded'),
  )

  /**
   * Why a file can't be sent, or null when it's fine. These strings surface
   * verbatim in the row's error tooltip, so each rejection reason names the
   * actual problem rather than a generic failure.
   */
  function validateFile(file: File): string | null {
    if (file.size === 0) {
      return 'This file is empty'
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      // Interpolated so the copy tracks the constant if the limit ever moves.
      return `This file exceeds ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`
    }
    if (!ALLOWED_ATTACHMENT_MIME.has(file.type)) {
      return 'This file format is not supported'
    }
    return null
  }

  function addFiles(files: File[]) {
    for (const file of files) {
      // Same name AND size: almost certainly the same file dropped twice, which
      // would otherwise be attached to the ticket twice over.
      const isDuplicate = attachments.value.some(
        (row) => row.name === file.name && row.size === file.size,
      )
      if (isDuplicate) { continue }

      const errorMessage = validateFile(file)
      attachments.value.push({
        id: `attachment-${nextRowId++}`,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: errorMessage ? 'error' : 'pending',
        progress: 0,
        isRejected: Boolean(errorMessage),
        // Only images get a preview, and only valid ones — no point holding an
        // object URL for a file that can never be sent.
        previewUrl: !errorMessage && file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : null,
        errorMessage,
      })
    }
  }

  function removeAttachment(id: string) {
    const index = attachments.value.findIndex((row) => row.id === id)
    if (index === -1) { return }
    const [removed] = attachments.value.splice(index, 1)
    if (removed?.previewUrl) {
      URL.revokeObjectURL(removed.previewUrl)
    }
  }

  function resetAttachments() {
    for (const row of attachments.value) {
      if (row.previewUrl) {
        URL.revokeObjectURL(row.previewUrl)
      }
    }
    attachments.value = []
  }

  /**
   * Send every sendable file to the freshly filed request, one call each so a
   * single rejected file doesn't take the others down with it.
   *
   * @returns the rows that failed, so the caller can tell the user which ones
   *          didn't make it. The request itself is already filed either way.
   */
  async function uploadAttachments(taskGid: string): Promise<RequestAttachment[]> {
    const rows = sendableAttachments.value

    if (rows.length) {
      const headers = await buildRequestAuthHeaders()

      // Sequential: a request with several large screenshots would otherwise open
      // as many concurrent multipart uploads, and the tracker rate-limits us.
      for (const row of rows) {
        row.status = 'uploading'
        row.progress = 0
        row.errorMessage = null

        const form = new FormData()
        form.append('taskGid', taskGid)
        form.append('file', row.file, row.name)

        const { error } = await tryCatch(
          fetchWithUploadProgress('/api/requests/attachments', {
            body: form,
            headers,
            onProgress: (percent) => { row.progress = percent },
          }),
        ) as TryCatchResult<unknown>

        if (error) {
          row.status = 'error'
          // The upload itself failed rather than the file being invalid, so the
          // only useful advice is to swap the file out.
          row.errorMessage = 'Try to upload a different file'
        } else {
          row.progress = 100
          row.status = 'uploaded'
        }
      }
    }

    // Computed over the whole list, not just what was sent: a file rejected on
    // drop never enters `rows`, and reporting only sent-and-failed rows would
    // claim success while quietly dropping it.
    return attachments.value.filter((row) => row.status === 'error')
  }

  // Object URLs outlive the component unless revoked, so tie them to its life.
  onBeforeUnmount(resetAttachments)

  return {
    attachments,
    addFiles,
    removeAttachment,
    resetAttachments,
    uploadAttachments,
  }
}
