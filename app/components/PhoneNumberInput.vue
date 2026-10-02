<script setup lang="ts">
import { usePhoneInput, sanitizeExtension, blockNonDigitBeforeInput, MAX_EXTENSION_DIGITS } from '~/composables/usePhoneInput'
import { formatCountryLabel } from '~/utils/formatPhone'

interface PhoneValue {
  countriesId: number | null
  number: string
  extension?: string | null
}

interface Props {
  modelValue: PhoneValue
  defaultCountry?: string | null
  required?: boolean
  disabled?: boolean
  showExtension?: boolean
  invalid?: boolean
  placeholder?: string | null
  countryPlaceholder?: string
  /** Hide the embedded country Select — parent manages country externally. */
  hideCountry?: boolean
  /** Explicit ISO code when the parent manages country outside this component. */
  countryIso?: string | null
  /** Hide the embedded extension input (caller renders its own). */
  hideExtension?: boolean
  /** Forwarded to the underlying InputText `id` attribute for label linking. */
  inputId?: string | null
}

const props = withDefaults(defineProps<Props>(), {
  defaultCountry: 'US',
  required: false,
  disabled: false,
  showExtension: true,
  invalid: false,
  placeholder: null,
  countryPlaceholder: 'Select country',
  hideCountry: false,
  countryIso: null,
  hideExtension: false,
  inputId: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: PhoneValue]
  'validity-change': [isValid: boolean]
}>()

const referenceData = useReferenceDataStore()
const countryOptions = computed(() => referenceData.countryOptions)

/**
 * Resolve the ISO-2 code from either an externally-passed prop (when the
 * parent owns the Country Select) or from the id carried in modelValue.
 */
const selectedIso = computed<string | null>(() => {
  if (props.countryIso) return props.countryIso
  const id = props.modelValue?.countriesId
  if (id == null) return props.defaultCountry ?? null
  const match = countryOptions.value.find((country) => country.id === id)
  return match?.code ?? props.defaultCountry ?? null
})

const isoRef = computed(() => selectedIso.value)
const { placeholder: generatedPlaceholder, maxDigits, parse, formatStripped, formatAndParse, isValid, detectCountryFromInput, extractExtension } = usePhoneInput(isoRef)

const displayPlaceholder = computed(() => props.placeholder ?? generatedPlaceholder.value)

const displayValue = ref('')
const inputElRef = ref<{ $el?: HTMLInputElement } | HTMLInputElement | null>(null)

function getInputEl(): HTMLInputElement | null {
  const reference = inputElRef.value
  if (!reference) return null
  return ((reference as { $el?: HTMLInputElement }).$el ?? reference) as HTMLInputElement
}

function countDigits(value: string): number {
  return (value.match(/\d/g) || []).length
}

/**
 * Truncate the input string so it contains at most `max` digits, preserving
 * any non-digit formatting characters that appear before the cap is hit.
 * A null/undefined `max` disables the cap (no country selected, or no
 * example number available for the country).
 */
function capDigits(value: string, max: number | null | undefined): string {
  if (max == null || max <= 0) return value
  let digitCount = 0
  let output = ''
  for (const char of value) {
    if (/\d/.test(char)) {
      if (digitCount >= max) continue
      digitCount++
    }
    output += char
  }
  return output
}

function findCursorPositionAfterDigits(formatted: string, digitsBeforeCursor: number, advancePastTrailingLiterals = false): number {
  if (digitsBeforeCursor <= 0) return 0
  let count = 0
  for (let index = 0; index < formatted.length; index++) {
    if (/\d/.test(formatted[index] as string)) {
      count++
      if (count === digitsBeforeCursor) {
        let cursor = index + 1
        // When the caret was at the very end of the typed input, the
        // formatter may have appended trailing literals past the last digit
        // (closing ")", trailing space, etc.). Advance the caret past them
        // so the next backspace removes a literal first — the
        // backspace-of-literal handler in handleInput then strips the
        // preceding digit, keeping deletion responsive.
        if (advancePastTrailingLiterals) {
          while (cursor < formatted.length && !/\d/.test(formatted[cursor] as string)) {
            cursor++
          }
        }
        return cursor
      }
    }
  }
  return formatted.length
}
// Skip the next selectedIso-watcher clear when the country change came from a
// paste (paste sets both country + number in one go; the watcher would
// otherwise immediately wipe the just-set number).
const skipNextIsoClear = ref(false)
// Set while we are propagating an internal change. The handleInput guard and
// the modelValue watcher use it to ignore round-trip echoes from our own
// emits (parent re-renders the same value back through props).
const isInternalUpdate = ref(false)
// Lock cross-country auto-detection once a country has been established.
// Same-country calling-code prefix strips still run so a pasted "+1 555…"
// with US locked still drops the "+1" — only cross-country flips are
// suppressed.
//
// In hide-country mode the parent owns the Country Select externally; if a
// country is effectively set at mount (whether via the countryIso prop, the
// modelValue id, or the defaultCountry fallback) we treat it as a user
// choice from the start. Two cases this covers:
//   1. PrimeVue's Select doesn't emit when the user re-picks the already-
//      selected option, so relying solely on the selectedIso watcher would
//      miss that case.
//   2. Pages like /customers/create set form.country = US asynchronously in
//      onMounted. props.countryIso is briefly null at mount, but selectedIso
//      already resolves to "US" via defaultCountry — so the visible country
//      is "United States" even before the async assignment lands. The lock
//      must respect the visible country, not the raw prop.
// For embedded-country mode (no usages today, but kept for completeness)
// the lock still engages later via the watcher when the user picks via the
// embedded Select. Auto-detect emits set skipNextIsoClear first, so a
// detected change does NOT lock the country itself.
const hasManualCountrySelection = ref(props.hideCountry && !!selectedIso.value)

function syncDisplayFromModel() {
  // Render the stored canonical national number WITHOUT the trunk prefix.
  // The country selector beside the input already shows the calling code
  // (e.g. "+49"), so adding back the German trunk "0" turning
  // "30 12345678" into "030 12345678" presents a digit the user never
  // typed and conflicts with the detection-strip path below.
  const number = props.modelValue?.number || ''
  displayValue.value = number ? formatStripped(number, selectedIso.value) : ''
}

watch(() => props.modelValue?.number, (newNumber) => {
  if (isInternalUpdate.value) return
  const current = displayValue.value.replace(/\D/g, '')
  if ((newNumber || '').replace(/\D/g, '') !== current) {
    syncDisplayFromModel()
  }
})

watch(selectedIso, () => {
  if (skipNextIsoClear.value) {
    skipNextIsoClear.value = false
    return
  }
  // Country change originated outside auto-detect (embedded Select or parent
  // prop) — treat as an explicit user choice and stop auto-flipping the
  // country from subsequent typing/pasting.
  hasManualCountrySelection.value = true
  // Country changed — drop stale formatted string AND propagate the clear to
  // the parent so form.phoneNumber / form.extension don't keep the previous
  // country's value. Visual + state stay in sync.
  if (!displayValue.value && !props.modelValue?.number && !props.modelValue?.extension) {
    return
  }
  displayValue.value = ''
  emit('update:modelValue', {
    countriesId: props.modelValue?.countriesId ?? null,
    number: '',
    extension: null,
  })
  emit('validity-change', false)
})

onMounted(syncDisplayFromModel)

function emitValue(next: Partial<PhoneValue>) {
  isInternalUpdate.value = true
  emit('update:modelValue', {
    countriesId: props.modelValue?.countriesId ?? null,
    number: props.modelValue?.number ?? '',
    extension: props.modelValue?.extension ?? null,
    ...next,
  })
  nextTick(() => {
    isInternalUpdate.value = false
  })
}

/**
 * Apply a detected country code: switch the country selector, strip the
 * country code from the visible input, and re-emit modelValue with the
 * canonical national portion. Shared between paste and live-typing flows.
 */
async function applyDetectedCountry(detected: { countryIso: string, nationalNumber: string, extension: string | null }) {
  // Robust country lookup — case-insensitive ISO-2 first, then ISO-3
  // prefix match. Strict equality alone fails when Directus stores codes
  // in non-uppercase or ISO-3 form.
  const isoUpper = detected.countryIso.toUpperCase()
  const matchedCountry =
    countryOptions.value.find((country) => String(country.code || '').toUpperCase() === isoUpper)
    ?? countryOptions.value.find((country) => String(country.code || '').toUpperCase().startsWith(isoUpper))
  const nextCountriesId = matchedCountry?.id ?? props.modelValue?.countriesId ?? null
  const { number: stripped, extension: extractedExt } = extractExtension(detected.nationalNumber)

  // Suppress the next selectedIso watcher clear — country is about to change
  // and would otherwise wipe the just-set national number on the same tick.
  if (matchedCountry && matchedCountry.id !== props.modelValue?.countriesId) {
    skipNextIsoClear.value = true
  }

  isInternalUpdate.value = true
  emit('update:modelValue', {
    countriesId: nextCountriesId,
    number: stripped,
    extension: extractedExt ?? detected.extension ?? props.modelValue?.extension ?? null,
  })

  // Set the formatted display synchronously (no await) so any keystrokes
  // the user fires before the next tick race against a stable visual
  // state instead of a pending clear. Passing matchedCountry.code
  // explicitly means the formatter doesn't depend on the reactive isoRef
  // having propagated yet.
  //
  // Prefer AsYouType (via formatAndParse) when it produces a meaningful
  // format — for NANP countries (US/CA) it yields the typical "(NPA) NXX-
  // XXXX" display. Fall back to formatStripped when AsYouType returns just
  // the raw digits (trunk-prefix countries like DE/GB where the formatter
  // expects the trunk-0 we don't have); formatStripped's spaced output
  // ("30 12345678") is still better than unformatted digits, and crucially
  // avoids re-adding the trunk the user never typed.
  const targetIso = matchedCountry?.code ?? null
  const aytFormatted = stripped ? formatAndParse(stripped, targetIso).formatted : ''
  displayValue.value = (aytFormatted && /\D/.test(aytFormatted))
    ? aytFormatted
    : formatStripped(stripped, targetIso)
  emit('validity-change', isValid(stripped, matchedCountry?.code ?? null))

  // Only the echo-suppression flag waits for the tick — the modelValue
  // watcher fires after Vue flushes our emit, and must see
  // isInternalUpdate=true to skip its sync-from-model.
  await nextTick()
  isInternalUpdate.value = false
}

/**
 * Block auto-detection from CHANGING the country when the user has already
 * picked one. Detections that resolve to the current country (same-country
 * calling-code prefix strip) always pass — they don't flip the selector.
 */
function isBlockedCrossCountryDetection(detected: { countryIso: string }): boolean {
  if (!hasManualCountrySelection.value) return false
  const detectedIsoUpper = detected.countryIso.toUpperCase()
  const currentIsoUpper = (selectedIso.value || '').toUpperCase()
  return detectedIsoUpper !== currentIsoUpper
}

function handleInput(raw: string | null) {
  // No isInternalUpdate guard here: InputText doesn't echo programmatic
  // model-value changes back as @update:model-value, so any call into this
  // handler is a real user keystroke and must not be dropped — even when it
  // arrives mid-flight during applyDetectedCountry's nextTick window.
  const original = raw ?? ''

  // Detect backspace-of-literal: when the formatter previously appended a
  // trailing literal (closing ")", space, dash …) past the last digit and
  // the user pressed backspace, the browser only removes the literal. Re-
  // formatting would re-add the same literal and trap the user inside the
  // mask. Strip the trailing digit too so deletion actually progresses.
  const previousDisplay = displayValue.value
  let intent = original
  if (
    previousDisplay
    && intent.length === previousDisplay.length - 1
    && previousDisplay.startsWith(intent)
  ) {
    const removedChar = previousDisplay[previousDisplay.length - 1]
    if (removedChar && !/\d/.test(removedChar)) {
      intent = intent.replace(/\d(?=\D*$)/, '')
    }
  }

  // Strip anything that isn't a phone-allowed character (digits, parens,
  // dash, dot, space, plus). handleBeforeInput blocks these at keystroke
  // level, but pasted content or programmatic injections can still arrive
  // here, so we strip again as a defence in depth. Detection runs BEFORE
  // the digit cap — otherwise a typed international-format number that
  // exceeds the country's national length (e.g. "12232332139" with US
  // selected) would have its trailing digit truncated before detection
  // could recognise the leading "1" as the calling-code prefix.
  const stripped = intent.replace(/[^0-9()+\-. ]/g, '')

  // Live country auto-detection. Triggers on:
  //   "+44 …"   → flips on first parseable prefix (early)
  //   "0044 …"  → treated identically to "+44 …"
  //   "44…" naked → flips only when the implied "+44…" is fully isValid()
  //                  AND differs from the current country (strict, to avoid
  //                  mis-classifying a local national number).
  //   "1…" with US selected → strips the calling-code prefix without
  //                  flipping the country (same-country same-code case).
  //
  // When the user has manually picked a country, suppress the cross-country
  // flip but still allow the same-country prefix strip so a pasted "+1 555…"
  // with US locked still drops its "+1".
  const detected = detectCountryFromInput(stripped, selectedIso.value)
  if (detected && !isBlockedCrossCountryDetection(detected)) {
    void applyDetectedCountry(detected)
    return
  }

  // No detection — cap to the active country's max digit count and force-
  // sync the DOM input so visual state matches even when the sanitized value
  // equals the current displayValue (Vue would otherwise skip the update).
  const value = capDigits(stripped, maxDigits.value)
  if (value !== original) {
    const sanitizedEl = getInputEl()
    if (sanitizedEl) sanitizedEl.value = value
  }

  const inputEl = getInputEl()
  const cursorPos = inputEl?.selectionStart ?? value.length
  const digitsBeforeCursor = countDigits(value.slice(0, cursorPos))
  const caretWasAtEnd = cursorPos >= value.length

  // AsYouType-driven live formatting handles variable-length numbers
  // (DE / FR / AR / MX / etc.) that a static mask would reject.
  const { formatted, nationalNumber, isValid: isValidNumber } = formatAndParse(value)
  displayValue.value = formatted

  // Force-sync the DOM to `formatted`. Vue's reactivity skips the
  // :model-value patch when displayValue equals its previous value, which
  // strands typed-but-stripped characters in the DOM input (e.g. a typed
  // space or dash that AsYouType normalises away — or a "=" before the
  // handleBeforeInput allow-list was tightened). Setting the DOM value
  // directly guarantees the visual state matches `formatted`.
  if (inputEl && inputEl.value !== formatted) {
    inputEl.value = formatted
  }

  // Restore the cursor at the same digit-offset after Vue patches the DOM.
  // Without this, formatting reflows would jump the caret to the end.
  if (inputEl) {
    const newCursor = findCursorPositionAfterDigits(formatted, digitsBeforeCursor, caretWasAtEnd)
    nextTick(() => {
      inputEl.setSelectionRange(newCursor, newCursor)
    })
  }

  emitValue({ number: nationalNumber })
  emit('validity-change', isValidNumber)
}

async function handlePaste(event: ClipboardEvent) {
  const pasted = event.clipboardData?.getData('text') ?? ''
  const trimmed = pasted.trim()
  // Pasted content with an explicit international prefix ("+44…" or "0044…")
  // expresses unambiguous intent — bypass the manual-selection lock so the
  // country flips to match. Naked-digit pastes ("92…") stay subject to the
  // lock so they can't override a country the user already set.
  const isExplicitInternationalPaste = trimmed.startsWith('+') || trimmed.startsWith('00')
  const detected = detectCountryFromInput(pasted, selectedIso.value)
  if (detected && (isExplicitInternationalPaste || !isBlockedCrossCountryDetection(detected))) {
    event.preventDefault()
    await applyDetectedCountry(detected)
    return
  }
  // For non-international pastes, strip alphabet characters before they
  // reach the input and cap to the country's digit limit. Manually inserting
  // the cleaned string here is more reliable than letting the browser paste
  // then sanitizing in handleInput, because some flows skip the
  // @update:model-value emit when the resulting displayValue happens to
  // match the previous value.
  const cap = maxDigits.value
  const insertedDigits = (pasted.match(/\d/g) || []).length
  const inputEl = getInputEl()
  const currentValue = inputEl?.value ?? displayValue.value
  const start = inputEl?.selectionStart ?? currentValue.length
  const end = inputEl?.selectionEnd ?? currentValue.length
  const keptDigits = countDigits(currentValue.slice(0, start)) + countDigits(currentValue.slice(end))
  const wouldOverflow = cap != null && keptDigits + insertedDigits > cap
  if (/[a-zA-Z]/.test(pasted) || wouldOverflow) {
    event.preventDefault()
    if (!inputEl) return
    const cleaned = pasted.replace(/[a-zA-Z]/g, '')
    const next = currentValue.slice(0, start) + cleaned + currentValue.slice(end)
    handleInput(next)
  }
}

function handleBeforeInput(event: InputEvent) {
  // Block any non-phone character at the keystroke level so it never lands in
  // the DOM. Sanitising in @update:model-value is too late — by the time Vue
  // fires that event the character is already visible to the user, and round-
  // tripping through displayValue can be no-op'd by Vue's reactivity when the
  // cleaned value happens to equal what we last emitted (leaving the stale
  // typed character stranded in the DOM input).
  //
  // Allowed: digits, parens, dash, dot, space, plus (typed as part of an
  // explicit international prefix). Everything else — letters, "=", "*", "#",
  // "@", etc. — is blocked.
  const inserted = event.data
  if (inserted && /[^0-9()+\-. ]/.test(inserted)) {
    event.preventDefault()
    return
  }

  // Enforce the country's max digit count. Only block when the keystroke
  // actually adds digits — deletions, navigation, and inserting formatting
  // characters (space/dash/paren) at an existing position must still pass.
  const cap = maxDigits.value
  if (cap == null || !inserted) return
  const insertedDigits = (inserted.match(/\d/g) || []).length
  if (insertedDigits === 0) return

  const inputEl = getInputEl()
  if (!inputEl) return
  const currentValue = inputEl.value ?? ''
  const start = inputEl.selectionStart ?? currentValue.length
  const end = inputEl.selectionEnd ?? currentValue.length
  // Digits that will remain after the inserted range replaces the selection.
  const keptDigits = countDigits(currentValue.slice(0, start)) + countDigits(currentValue.slice(end))
  if (keptDigits + insertedDigits > cap) {
    event.preventDefault()
  }
}

function handleCountryChange(nextId: number | null) {
  // Country changed via embedded Select — clear stale phone input.
  emit('update:modelValue', {
    countriesId: nextId ?? null,
    number: '',
    extension: null,
  })
  displayValue.value = ''
  emit('validity-change', false)
}

function handleBlur() {
  const parsed = parse(displayValue.value)
  if (!props.modelValue?.extension && parsed.extension) {
    emitValue({ number: parsed.nationalNumber, extension: parsed.extension })
    // Strip the extracted extension from the visible string and re-pretty
    // the remaining national portion — using formatStripped so the trunk
    // prefix isn't reintroduced (matches syncDisplayFromModel and
    // applyDetectedCountry).
    displayValue.value = formatStripped(parsed.nationalNumber, selectedIso.value)
  }
  emit('validity-change', parsed.isValid)
}

function handleExtensionInput(value: string) {
  const digits = sanitizeExtension(value)
  emitValue({ extension: digits || null })
}
</script>

<template>
  <!-- Phone-only mode — render InputText as root so parent wrappers like
       <InputGroup> can target it as a direct child (shared height, joined
       border-radius). AsYouType handles formatting; no static mask. -->
  <InputText
    v-if="hideCountry && hideExtension"
    :id="inputId ?? undefined"
    ref="inputElRef"
    class="phone-field"
    :model-value="displayValue"
    :placeholder="displayPlaceholder"
    :disabled="disabled || !selectedIso"
    :invalid="invalid"
    inputmode="tel"
    autocomplete="off"
    v-no-autofill
    fluid
    @update:model-value="handleInput"
    @beforeinput="handleBeforeInput"
    @paste="handlePaste"
    @blur="handleBlur"
  />

  <!-- Full composite mode — country Select + InputText + optional extension. -->
  <div
    v-else
    class="phone-number-input"
  >
    <div class="phone-number-input__row">
      <div
        v-if="!hideCountry"
        class="phone-number-input__country"
      >
        <Select
          :model-value="modelValue?.countriesId ?? null"
          :options="countryOptions"
          :option-label="(country) => formatCountryLabel(country)"
          option-value="id"
          :placeholder="countryPlaceholder"
          :disabled="disabled"
          :filter="countryOptions.length > 10"
          fluid
          @update:model-value="handleCountryChange"
        />
      </div>

      <div class="phone-number-input__number">
        <InputText
          :id="inputId ?? undefined"
          ref="inputElRef"
          class="phone-field"
          :model-value="displayValue"
          :placeholder="displayPlaceholder"
          :disabled="disabled || !selectedIso"
          :invalid="invalid"
          inputmode="tel"
          autocomplete="off"
          v-no-autofill
          fluid
          @update:model-value="handleInput"
          @paste="handlePaste"
          @blur="handleBlur"
        />
      </div>
    </div>

    <div
      v-if="showExtension && !hideExtension"
      class="phone-number-input__extension"
    >
      <label class="form-field__label">Extension</label>
      <InputText
        :model-value="modelValue?.extension ?? ''"
        :disabled="disabled"
        :maxlength="MAX_EXTENSION_DIGITS"
        inputmode="numeric"
        placeholder="Optional"
        autocomplete="off"
        v-no-autofill
        fluid
        @beforeinput="blockNonDigitBeforeInput"
        @update:model-value="handleExtensionInput"
      />
    </div>
  </div>
</template>

<style scoped>
.phone-number-input {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}

.phone-number-input__row {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-2);

    @media (min-width: 768px) {
        grid-template-columns: minmax(10rem, 1fr) 1.5fr;
    }
}

.phone-number-input--external-country .phone-number-input__row {
    grid-template-columns: 1fr;
}

.phone-number-input__extension {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
}
@keyframes phone-field-pulse {
    0%,
    100% {
        box-shadow: inset 0 0 0 0 var(--p-red-400);
    }

    50% {
        box-shadow: inset 0 0 0 1px var(--p-red-400);
    }
}
.phone-field {
    padding-inline: var(--p-spacing-2);
    transition:
        background-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        border-color var(--p-transition-duration-slow) var(--p-transition-timing-ease-out),
        box-shadow var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        outline-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

/* Only while the field is in error: keep the border red on hover/focus so it
   never mixes the primary blue with the error red. The normal (valid) state
   keeps PrimeVue's default blue hover/focus. */
.phone-field.p-invalid:hover,
.phone-field.p-invalid:focus,
.phone-field.p-invalid:focus-visible {
    border-color: var(--p-red-400);
}
.phone-field.p-invalid:not(:focus):not(:hover) {
    animation: phone-field-pulse var(--p-field-pulse-duration)
        var(--p-transition-timing-ease-in-out) infinite;
}
@media (prefers-reduced-motion: reduce) {
    .phone-field.p-invalid:not(:focus):not(:hover) {
        animation: none;
    }
}
</style>
