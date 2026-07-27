/**
 * Centralized field validation utilities.
 *
 * Rule shape (per field):
 *   - required       {boolean}   – field must have a non-empty value
 *   - pattern        {RegExp}    – regex the value must match (skipped when empty + not required)
 *   - message        {string}    – validation error message (from Directus validation_message)
 *   - maxLength      {number}    – max character length (from Directus schema)
 *   - requiredMessage {string}   – custom "required" message
 *   - requiredWhen   {function}  – conditional required: receives the full form object, returns boolean
 */

export interface FieldRule {
  required?: boolean
  pattern?: RegExp
  message?: string
  maxLength?: number
  /**
   * The Directus "soft limit" (interface option `options.softLength`) — the
   * length we echo to the user (CONNECT-536). Often smaller than the column's
   * hard `max_length`, and present on text columns that have no `max_length`.
   */
  softLimit?: number
  requiredMessage?: string
  requiredWhen?: (formData: Record<string, unknown>) => boolean
}

export type FieldRulesMap = Record<string, FieldRule>

interface DirectusValidationFilter {
  _and?: Array<Record<string, { _regex?: string }>>
}

interface DirectusCondition {
  required?: boolean
  hidden?: boolean
  name?: string
  rule?: {
    _and?: Array<Record<string, { _eq?: unknown }>>
  }
}

interface DirectusFieldMeta {
  hidden?: boolean
  required?: boolean
  validation?: DirectusValidationFilter | null
  validation_message?: string | null
  conditions?: DirectusCondition[] | null
  options?: { softLength?: number | null } | null
}

interface DirectusFieldSchema {
  is_nullable?: boolean
  has_auto_increment?: boolean
  default_value?: unknown
  max_length?: number | null
}

interface DirectusField {
  field: string
  meta?: DirectusFieldMeta | null
  schema?: DirectusFieldSchema | null
}

/**
 * Extract the regex string from a Directus validation filter.
 */
function extractRegex(validation: DirectusValidationFilter | null = null): string | null {
  if (!validation?._and) {
    return null
  }
  for (const condition of validation._and) {
    const fieldKey = Object.keys(condition)[0]
    if (fieldKey && condition[fieldKey]?._regex) {
      return condition[fieldKey]._regex!
    }
  }
  return null
}

/**
 * Parse conditional required rules from Directus field conditions.
 */
function extractConditionalRequired(
  conditions: DirectusCondition[] | null = null,
): { requiredWhen: (formData: Record<string, unknown>) => boolean; requiredMessage: string | null } | null {
  if (!Array.isArray(conditions)) {
    return null
  }

  for (const condition of conditions) {
    if (!condition.required || !condition.rule?._and) {
      continue
    }

    const checks: Array<{ field: string; operator: string; value: unknown }> = []
    for (const filter of condition.rule._and) {
      const fieldName = Object.keys(filter)[0]
      if (!fieldName) {
        continue
      }

      const constraint = filter[fieldName] as { _eq?: unknown } | undefined
      if (constraint?._eq !== undefined) {
        checks.push({ field: fieldName, operator: '_eq', value: constraint._eq })
      }
    }

    if (checks.length > 0) {
      return {
        requiredWhen: (formData: Record<string, unknown>) => checks.every(
          (check) => formData[check.field] === check.value,
        ),
        requiredMessage: condition.name || null,
      }
    }
  }
  return null
}

/**
 * Build validation rules from an array of Directus field objects.
 */
export function buildFieldRules(directusFields: DirectusField[] = []): FieldRulesMap {
  const rules: FieldRulesMap = {}

  for (const field of directusFields) {
    const rule: FieldRule = {}
    const meta = field.meta || {}
    const schema = field.schema || {}

    // Skip system/hidden fields without user-facing validation
    if (meta.hidden && !meta.conditions?.some((condition) => condition.hidden === false)) {
      if (!meta.validation && !meta.required) {
        continue
      }
    }

    if (meta.required || (schema.is_nullable === false && !schema.has_auto_increment && !schema.default_value)) {
      rule.required = true
    }

    if (schema.max_length) {
      rule.maxLength = schema.max_length
    }

    // Directus "soft limit" — what we echo on the frontend (CONNECT-536).
    if (meta.options?.softLength) {
      rule.softLimit = meta.options.softLength
    }

    const regexString = extractRegex(meta.validation ?? null)
    if (regexString) {
      rule.pattern = new RegExp(regexString)
    }

    if (meta.validation_message) {
      rule.message = meta.validation_message
    }

    const conditionalRequired = extractConditionalRequired(meta.conditions ?? null)
    if (conditionalRequired) {
      delete rule.required
      rule.requiredWhen = conditionalRequired.requiredWhen
      if (conditionalRequired.requiredMessage) {
        rule.requiredMessage = conditionalRequired.requiredMessage
      }
    }

    // Only add if the rule has meaningful content
    if (Object.keys(rule).length > 0) {
      rules[field.field] = rule
    }
  }

  return rules
}

/**
 * Validate a single field value against its rule.
 */
export function validateField(
  value: string | number | null = null,
  rule: FieldRule | null = null,
  formData: Record<string, unknown> | null = null,
): string {
  if (!rule) {
    return ''
  }

  const stringValue = value !== null && value !== undefined ? String(value).trim() : ''
  const isEmpty = stringValue === ''

  const isRequired = rule.required || (rule.requiredWhen && formData && rule.requiredWhen(formData))

  if (isRequired && isEmpty) {
    return rule.requiredMessage || 'This field is required'
  }

  if (!isEmpty && rule.maxLength && stringValue.length > rule.maxLength) {
    return `Maximum ${rule.maxLength} characters allowed`
  }

  if (!isEmpty && rule.pattern && !rule.pattern.test(stringValue)) {
    return rule.message || 'Invalid value'
  }

  return ''
}
