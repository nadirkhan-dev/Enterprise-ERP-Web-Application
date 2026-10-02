/**
 * Form types — validation rules and field state.
 */

export interface ValidationRule {
  required?: boolean
  maxLength?: number | null
  pattern?: RegExp | null
  patternMessage?: string | null
}

export interface FieldValidationState {
  dirty: boolean
  touched: boolean
  error: string | null
}

export type FieldValidationRules = Record<string, ValidationRule>

export interface FormField {
  field: string
  label: string
  required?: boolean
  placeholder?: string
  disabled?: boolean
}
