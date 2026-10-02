/**
 * Clear-on-edit error handling.
 *
 * As soon as the user changes a field, its matching error is cleared so the
 * red invalid state (border + text + pulse) disappears immediately. Errors
 * only re-appear the next time the form's own validate runs (e.g. on submit),
 * so emptying or fixing a wrong value clears the red right away.
 *
 * Watches every key shared between `form` and `errors`; editing `form[key]`
 * clears `errors[key]`. Keys present only in `errors` (composite/derived
 * errors with no single backing field) are left untouched.
 */
export function useClearErrorsOnEdit(
  form: Record<string, any>,
  errors: Record<string, string>,
) {
  for (const field of Object.keys(errors)) {
    if (!(field in form)) { continue }
    watch(
      () => form[field],
      () => {
        if (errors[field]) { errors[field] = '' }
      },
    )
  }
}
