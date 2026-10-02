import type { FieldRulesMap } from '~/utils/validationRules'

/**
 * Reactive character-limit lookup for a Directus collection (CONNECT-536).
 *
 * Fetches the collection's field rules (cached per collection) and exposes
 * `limitFor(field)`, which returns the Directus "soft limit" — falling back to
 * the column's hard `max_length`, or `null` when the field has no limit. Wire it
 * straight into <BaseCharCounter :max="limitFor('field')">.
 */
export function useCharLimits(collection: string) {
  const { fetchRules, getRules } = useFieldValidation()
  const rules = ref<FieldRulesMap>(getRules(collection))

  fetchRules(collection).then(({ data }) => {
    if (data) {
      rules.value = data
    }
  })

  function limitFor(field: string): number | null {
    const rule = rules.value[field]
    return rule?.softLimit ?? rule?.maxLength ?? null
  }

  return { limitFor }
}
