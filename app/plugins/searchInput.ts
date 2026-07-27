/**
 * `v-search-input` — marks a field as a free-text SEARCH/FILTER input and turns
 * off the mobile-browser text "helpers" that mangle search terms:
 *   - `autocapitalize="none"` — stops iOS/Android capitalizing the first letter
 *     (e.g. typing `bgr01-0455` no longer becomes `Bgr01-0455`)
 *   - `autocorrect="off"` + `spellcheck="false"` — stops autocorrect/spellcheck
 *     rewriting part numbers, SKUs, and account codes
 *
 * Apply it only to search/filter fields — NOT to data-entry fields like names,
 * addresses, or notes, where capitalization and correction are wanted.
 *
 * Works on bare `<input>` and on PrimeVue components that wrap one (InputText,
 * AutoComplete, BaseClearableInput, IconField): the directive resolves the
 * actual field element whether it is the directive host or a descendant.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.directive('search-input', {
    mounted(el: HTMLElement) {
      const field = el instanceof HTMLInputElement
        ? el
        : el.querySelector<HTMLInputElement>('input')
      if (!field) { return }

      field.setAttribute('autocapitalize', 'none')
      field.setAttribute('autocorrect', 'off')
      field.setAttribute('spellcheck', 'false')
    },
  })
})
