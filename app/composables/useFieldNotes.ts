import { readFieldsByCollection } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'
import type { TryCatchResult } from '~/types/api'

type FieldNotesMap = Record<string, string>

const notesCache: Record<string, FieldNotesMap> = {}

/**
 * Composable that fetches the per-field "note" text configured in Directus
 * field settings (Schema → Field → Notes). Use it to render the same
 * help text in the app that Directus admins see in the backend.
 *
 * Notes are cached per collection — first call hits the API, subsequent
 * calls return the cached map instantly.
 */
export function useFieldNotes() {
  const directus = useDirectus()

  async function fetchNotes(collection: string): Promise<TryCatchResult<FieldNotesMap>> {
    if (notesCache[collection]) {
      return { data: notesCache[collection], error: null }
    }

    const { data: fields, error } = await tryCatch(
      (directus as any).request(readFieldsByCollection(collection)),
    )

    if (error) {
      return { data: null, error }
    }

    const map: FieldNotesMap = {}
    for (const fieldRecord of (fields as any[])) {
      const note = fieldRecord?.meta?.note
      if (note && fieldRecord.field) {
        map[fieldRecord.field as string] = String(note)
      }
    }

    notesCache[collection] = map
    return { data: map, error: null }
  }

  function getNote(collection: string, field: string): string {
    return notesCache[collection]?.[field] || ''
  }

  return {
    fetchNotes,
    getNote,
  }
}
