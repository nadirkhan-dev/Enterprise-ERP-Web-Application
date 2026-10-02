import type { Ref } from 'vue'
import type { TryCatchResult } from '~/types/api'
import { useDirectus } from '~/composables/useDirectus'

/**
 * "AI Improve" — the assist beside the microphone on a notes field, which turns
 * a block of dictated speech into readable written notes.
 *
 * Improve is a rewrite, not a summary: `/api/notes-improve` owns the OpenAI
 * credential and the brief that forbids the model from adding, concluding, or
 * dropping anything. The caller replaces the field with what comes back, so the
 * user can still edit or undo it before the drawer saves.
 *
 * The same call names the note, but only when the caller says its Subject field
 * is empty: a subject the user wrote is never overwritten, and never asked for.
 *
 * Pairs with `useSpeechToText` — one of each per dictatable field.
 */

/** What one Improve press produces. `subject` is empty unless one was asked for. */
export interface ImprovedNotes {
  notes: string
  subject: string
}

interface ImproveOptions {
  /** Ask for a subject as well — only true when the caller's field is empty. */
  needsSubject?: boolean
}

interface UseNotesImproveReturn {
  isImproving: Ref<boolean>
  improveNotes: (notes: string, options?: ImproveOptions) => Promise<TryCatchResult<ImprovedNotes>>
}

export function useNotesImprove(): UseNotesImproveReturn {
  const isImproving = ref(false)

  /**
   * Rewrite the given notes, and optionally suggest a subject for them.
   *
   * @returns the improved notes plus a subject, which is empty whenever one was
   *          not asked for or could not be made. Errors carry a message written
   *          for the user.
   */
  async function improveNotes(
    notes: string,
    options: ImproveOptions = {},
  ): Promise<TryCatchResult<ImprovedNotes>> {
    if (!notes.trim()) {
      return { data: { notes, subject: '' }, error: null }
    }

    isImproving.value = true
    try {
      const directus = useDirectus()
      const token = await directus.getToken()

      const { data: improved, error } = await tryCatch(
        $fetch<ImprovedNotes>('/api/notes-improve', {
          method: 'POST',
          body: { notes, needsSubject: options.needsSubject ?? false },
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
      )

      if (error) {
        // Nitro puts the route's statusMessage on `statusMessage`; it is written
        // for the user (not configured, too long, rate limited), so it beats the
        // generic fetch message.
        const detail = (error as { statusMessage?: string }).statusMessage
        return { data: null, error: new Error(detail || 'The notes could not be improved.') }
      }

      return {
        data: {
          notes: String(improved?.notes ?? notes),
          subject: String(improved?.subject ?? ''),
        },
        error: null,
      }
    } finally {
      isImproving.value = false
    }
  }

  return { isImproving, improveNotes }
}
