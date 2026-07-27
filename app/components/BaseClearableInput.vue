<script setup lang="ts">
/**
 * InputText with a clear (×) affordance. The clear button only appears when the
 * field holds a value AND focus is within the component, so it stays out of the
 * way until it is actually useful.
 *
 * Tab support: the clear control is a real focusable Button, so keyboard users
 * (Tab → Enter/Space) can clear a populated field. Focus is tracked across the
 * whole wrapper via focusin/focusout, so tabbing from the input onto the clear
 * button keeps it visible; clearing returns focus to the input.
 *
 * Touch: the clear span uses `@pointerdown.prevent` (load-bearing — do not
 * remove). On mobile, tapping a button does not focus it, so the input's
 * focusout would fire with no relatedTarget, flip isFocused false, and unmount
 * the button via v-if before its click could fire — leaving the field
 * uncleared. Preventing the pointerdown default keeps focus on the input so the
 * click lands.
 *
 * All undeclared attributes (id, placeholder, invalid, autocomplete, …) fall
 * through to the underlying InputText.
 */
defineOptions({ inheritAttrs: false })

interface Props {
  modelValue?: string | null
  /** Stretch to fill the parent's width (mirrors PrimeVue InputText `fluid`). */
  fluid?: boolean
  /** Accessible label for the clear button. */
  clearLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  fluid: false,
  clearLabel: 'Clear input',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  clear: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const inputRef = ref<{ $el?: HTMLInputElement } | null>(null)
const isFocused = ref(false)

const hasValue = computed(() => props.modelValue != null && String(props.modelValue).length > 0)
const isClearVisible = computed(() => hasValue.value && isFocused.value)

function handleFocusIn() {
  isFocused.value = true
}

function handleFocusOut(event: FocusEvent) {
  // Keep "focused" while focus moves between the input and the clear button.
  const nextTarget = event.relatedTarget as Node | null
  if (!nextTarget || !rootRef.value?.contains(nextTarget)) {
    isFocused.value = false
  }
}

function handleClear() {
  emit('update:modelValue', '')
  emit('clear')
  // Return focus to the input so the user can keep typing.
  nextTick(() => inputRef.value?.$el?.focus())
}

// Let a parent move focus here programmatically (e.g. cursor → First Name).
function focus() {
  inputRef.value?.$el?.focus()
}
defineExpose({ focus })
</script>

<template>
  <div
    ref="rootRef"
    class="clearable-input"
    @focusin="handleFocusIn"
    @focusout="handleFocusOut"
  >
    <InputText
      ref="inputRef"
      :model-value="modelValue ?? ''"
      :fluid="fluid"
      class="clearable-input__field"
      :class="{ 'clearable-input__field--reserved': hasValue }"
      v-bind="$attrs"
      @update:model-value="emit('update:modelValue', $event ?? '')"
    />
    <span
      v-if="isClearVisible"
      class="clearable-input__clear"
      @pointerdown.prevent
    >
      <BaseIconButton
        icon="pi pi-times"
        :label="clearLabel"
        @click="handleClear"
      />
    </span>
  </div>
</template>

<style scoped>
/* Full width by default — this wraps form-field inputs, which are full width.
   The inner InputText still receives `fluid` so it fills the wrapper. */
.clearable-input {
    position: relative;
    display: block;
    width: 100%;
}

.clearable-input__field {
    width: 100%;
    /* PrimeVue InputText defaults to weight 400; restore the app's regular body
       weight (per the per-wrapper font-weight convention in components.js). */
    font-weight: var(--p-font-weight-normal);
}

/* Reserve room for the clear button as soon as the field has a value, so
   focusing a populated field does not shift the text. */
.clearable-input__field--reserved {
    padding-right: var(--p-spacing-9);
}

.clearable-input__clear {
    position: absolute;
    top: 50%;
    right: var(--p-spacing-3);
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
}
.clearable-input__clear :deep(.base-icon-button:not(.base-icon-button--disabled)) {
    color: var(--p-gray-400);
}

.clearable-input__clear :deep(.base-icon-button:not(.base-icon-button--disabled):hover),
.clearable-input__clear :deep(.base-icon-button:not(.base-icon-button--disabled):focus-visible) {
    color: var(--p-skyblue-600);
}
</style>
