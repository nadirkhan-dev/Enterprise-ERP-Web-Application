/**
 * `v-trim` — strips leading/trailing whitespace from a text input or textarea
 * when it loses focus, then re-dispatches `input`/`change` so the bound
 * `v-model` picks up the cleaned value. Internal spaces are preserved (only the
 * ends are trimmed), so it is safe on names, addresses, notes, etc.
 *
 * Apply it only where surrounding whitespace is never meaningful — NOT on
 * password, search/filter, or one-time-code fields.
 *
 * Works on bare `<input>`/`<textarea>` and on PrimeVue components that wrap one
 * (InputText, Textarea, BaseClearableInput): the directive resolves the actual
 * field element whether it is the directive host or a descendant.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('trim', {
    mounted(el: HTMLElement) {
      const field = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        ? el
        : el.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')
      if (!field) { return }

      field.addEventListener('blur', () => {
        const trimmed = field.value.trim()
        if (trimmed === field.value) { return }
        field.value = trimmed
        // Sync v-model: PrimeVue/Vue listen on `input`; `change` covers any
        // change-based bindings.
        field.dispatchEvent(new Event('input', { bubbles: true }))
        field.dispatchEvent(new Event('change', { bubbles: true }))
      })
    },
  })
})
