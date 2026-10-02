import type { FieldRulesMap } from '~/utils/validationRules'

/**
 * Reactive suggestion lookup for a Directus collection (CONNECT-708).
 *
 * Fetches the collection's field rules (cached per collection, shared with
 * `useCharLimits`) and exposes `presetsFor(field)` — the values authored on the
 * field's Directus interface as `options.presets`. Returns an empty array when
 * the field has no suggestions configured, so a caller can render the chip row
 * conditionally and it simply appears once presets are added in Directus.
 *
 * Wire it into <BaseSuggestionChips :suggestions="presetsFor('field')">.
 */
export function useFieldPresets(collection: string) {
  const { fetchRules, getRules } = useFieldValidation()
  const rules = ref<FieldRulesMap>(getRules(collection))
  // True when the metadata fetch failed with a 5xx/unreachable error, so a
  // caller can escalate to its full-screen error state. Client errors are
  // already toasted by useFieldValidation and leave this false.
  const hasPresetsServerError = ref(false)

  fetchRules(collection).then(({ data, error }) => {
    if (data) {
      rules.value = data
    }
    if (error && isServerError(error)) {
      hasPresetsServerError.value = true
    }
  })

  function presetsFor(field: string): string[] {
    return rules.value[field]?.presets ?? []
  }

  return { presetsFor, hasPresetsServerError }
}
