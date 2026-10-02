import { readFieldsByCollection } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'
import type { TryCatchResult } from '~/types/api'

type FieldNotesMap = Record<string, string>

export interface FieldChoice {
  value: string
  text: string
}

type FieldChoicesMap = Record<string, FieldChoice[]>

const notesCache: Record<string, FieldNotesMap> = {}
const choicesCache: Record<string, FieldChoicesMap> = {}

/**
 * Composable that fetches per-field metadata configured in Directus field
 * settings — the "note" help text (Schema → Field → Notes) and the choice
 * list of select fields (Schema → Field → Choices). Use it to render the same
 * text in the app that Directus admins see in the backend, so copy stays
 * editable in SupplyHub rather than hardcoded here (CONNECT-830).
 *
 * Both maps are cached per collection and filled from a single
 * `readFieldsByCollection` call — the first `fetchNotes`/`fetchFieldChoices`
 * hits the API, every later call returns the cached map instantly.
 */
export function useFieldNotes() {
  const directus = useDirectus()

  /** Populate both caches from one field-metadata request. */
  async function loadFieldMeta(collection: string): Promise<TryCatchResult<true>> {
    if (notesCache[collection] && choicesCache[collection]) {
      return { data: true, error: null }
    }

    const { data: fields, error } = await tryCatch(
      (directus as any).request(readFieldsByCollection(collection)),
    )

    if (error) {
      return { data: null, error }
    }

    const notes: FieldNotesMap = {}
    const choices: FieldChoicesMap = {}

    for (const fieldRecord of (fields as any[])) {
      const fieldName = fieldRecord?.field as string | undefined
      if (!fieldName) continue

      const note = fieldRecord?.meta?.note
      if (note) {
        notes[fieldName] = String(note)
      }

      // Only select-style fields carry `options.choices`; each entry is a
      // { text, value } pair as authored in the Directus field settings.
      const fieldChoices = fieldRecord?.meta?.options?.choices
      if (Array.isArray(fieldChoices)) {
        choices[fieldName] = fieldChoices
          .filter((choice: any) => choice?.value !== undefined && choice?.value !== null)
          .map((choice: any) => ({ value: String(choice.value), text: String(choice.text ?? '') }))
      }
    }

    notesCache[collection] = notes
    choicesCache[collection] = choices
    return { data: true, error: null }
  }

  async function fetchNotes(collection: string): Promise<TryCatchResult<FieldNotesMap>> {
    const { error } = await loadFieldMeta(collection)
    if (error) {
      return { data: null, error }
    }
    return { data: notesCache[collection] as FieldNotesMap, error: null }
  }

  async function fetchFieldChoices(collection: string): Promise<TryCatchResult<FieldChoicesMap>> {
    const { error } = await loadFieldMeta(collection)
    if (error) {
      return { data: null, error }
    }
    return { data: choicesCache[collection] as FieldChoicesMap, error: null }
  }

  function getNote(collection: string, field: string): string {
    return notesCache[collection]?.[field] || ''
  }

  function getChoices(collection: string, field: string): FieldChoice[] {
    return choicesCache[collection]?.[field] || []
  }

  return {
    fetchNotes,
    fetchFieldChoices,
    getNote,
    getChoices,
  }
}
