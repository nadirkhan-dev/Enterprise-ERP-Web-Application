/**
 * `v-no-autofill` — hard-disables the browser's autofill and saved-value
 * suggestion dropdown on a text input.
 *
 * Browsers ignore a plain `autocomplete="off"` on recognized fields (name,
 * email, tel, address…), so this stamps a defence that actually holds: it
 * re-asserts `autocomplete="off"`, gives the field a randomized `name` (which
 * defeats the browser's field-name heuristics), and sets the `data-*` flags the
 * common password managers honor. A MutationObserver keeps them in place so a
 * component re-render (PrimeVue re-applies `autocomplete`) can never revert the
 * field to an autofillable state.
 *
 * Works on a bare `<input>` or any PrimeVue wrapper around one (InputText,
 * BaseClearableInput, AutoComplete): the directive resolves the field whether it
 * is the host element or a descendant.
 *
 * Do NOT use on Login's email/password fields — password managers must work
 * there.
 */
const NO_AUTOFILL_ATTRS = {
  autocomplete: 'off',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-form-type': 'other',
} as const

interface NoAutofillInput extends HTMLInputElement {
  _noAutofillObserver?: MutationObserver
}

function resolveInput(el: HTMLElement): NoAutofillInput | null {
  return (el instanceof HTMLInputElement ? el : el.querySelector('input')) as NoAutofillInput | null
}

function applyNoAutofill(input: NoAutofillInput) {
  for (const [attribute, value] of Object.entries(NO_AUTOFILL_ATTRS)) {
    // Only write when different so re-asserting from the observer can't loop.
    if (input.getAttribute(attribute) !== value) {
      input.setAttribute(attribute, value)
    }
  }
  // A non-guessable name defeats field-name-based autofill heuristics.
  if (!input.name.startsWith('naf-')) {
    input.name = `naf-${Math.random().toString(36).slice(2, 10)}`
  }
}

function stamp(el: HTMLElement) {
  const input = resolveInput(el)
  if (!input) { return }
  applyNoAutofill(input)
  if (!input._noAutofillObserver) {
    const observer = new MutationObserver(() => applyNoAutofill(input))
    observer.observe(input, { attributes: true, attributeFilter: ['autocomplete', 'name'] })
    input._noAutofillObserver = observer
  }
}

function cleanup(el: HTMLElement) {
  resolveInput(el)?._noAutofillObserver?.disconnect()
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('no-autofill', {
    mounted: stamp,
    updated: stamp,
    unmounted: cleanup,
  })
})
