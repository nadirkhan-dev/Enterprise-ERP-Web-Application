<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'

interface Props {
  icon: string
  label: string
  // Render as a NuxtLink when `to` is provided; otherwise renders as a Button.
  to?: RouteLocationRaw
  external?: boolean
  target?: string
  // Reserve layout space without showing the icon (visibility: hidden).
  hidden?: boolean
  disabled?: boolean
  // Apply a destructive tint (e.g. trash icon).
  destructive?: boolean
  // Non-interactive informational state (e.g. a "no website" globe): grayed like
  // disabled, but still hoverable (cursor default, not not-allowed) so a tooltip
  // can explain it. Rendered as a plain span rather than a link/button.
  muted?: boolean
  // Optional tooltip applied to the icon's root element.
  tooltip?: string
}

const props = withDefaults(defineProps<Props>(), {
  to: undefined,
  external: false,
  target: undefined,
  hidden: false,
  disabled: false,
  destructive: false,
  muted: false,
  tooltip: undefined,
})

const linkRel = computed(() =>
  props.external || props.target === '_blank' ? 'noopener noreferrer' : undefined,
)

const rootClasses = computed(() => ({
  'base-icon-button--hidden': props.hidden,
  'base-icon-button--disabled': props.disabled,
  'base-icon-button--destructive': props.destructive,
  'base-icon-button--muted': props.muted,
}))
</script>

<template>
  <span
    v-if="muted"
    v-tooltip.top="tooltip"
    class="base-icon-button"
    :class="rootClasses"
    role="img"
    :aria-label="label"
  >
    <i :class="['base-icon-button__icon', icon]" />
  </span>
  <NuxtLink
    v-else-if="to"
    :to="to"
    :external="external"
    :target="target"
    :rel="linkRel"
    :aria-label="label"
    :aria-hidden="hidden ? 'true' : undefined"
    :tabindex="hidden || disabled ? -1 : undefined"
    class="base-icon-button"
    :class="rootClasses"
  >
    <i :class="['base-icon-button__icon', icon]" />
  </NuxtLink>
  <Button
    v-else
    text
    rounded
    :disabled="disabled"
    :aria-label="label"
    :aria-hidden="hidden ? 'true' : undefined"
    :tabindex="hidden ? -1 : undefined"
    class="base-icon-button"
    :class="rootClasses"
  >
    <i :class="['base-icon-button__icon', icon]" />
  </Button>
</template>

<style scoped>
.base-icon-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--p-spacing-5);
    height: var(--p-spacing-5);
    min-width: var(--p-spacing-5);
    padding: 0;
    /* Transparent 1px border reserved at rest so the outlined hover state below
       never shifts the icon (mirrors the contacts pill on the Customers list). */
    border: 1px solid transparent;
    border-radius: var(--p-border-radius-xs);
    background: transparent;
    color: var(--p-primary-500);
    text-decoration: none;
    flex-shrink: 0;
    cursor: pointer;
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        border-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

/* Canonical interaction state (source of truth, mirrors the top nav): light-blue
   background + brand-blue icon on hover / focus / active — regardless of the
   resting colour, so secondary (gray) icons behave exactly like primary ones.
   `!important` lets this win over consumers that override only the RESTING
   colour (e.g. a deep-blue or gray icon), without each having to restate it. */
.base-icon-button:hover,
.base-icon-button:focus-visible,
.base-icon-button:active {
    background: var(--p-tideblue-50);
    border-color: var(--p-skyblue-200);
    color: var(--p-skyblue-600) !important;
}

.base-icon-button:focus-visible {
    outline: var(--p-spacing-px) solid var(--p-primary-500);
    outline-offset: var(--p-spacing-px);
}

.base-icon-button--hidden {
    visibility: hidden;
    pointer-events: none;
}

.base-icon-button--disabled {
    color: var(--p-surface-300);
    cursor: not-allowed;
    pointer-events: none;
}

/* Informational, non-interactive: grayed and inert (no hover tint), but keeps
   pointer events so its tooltip still surfaces on hover. `!important` beats the
   canonical hover rule's `!important` colour so it never turns blue. */
.base-icon-button--muted,
.base-icon-button--muted:hover,
.base-icon-button--muted:focus-visible {
    color: var(--p-surface-300) !important;
    background: transparent;
    border-color: transparent;
    cursor: default;
}

.base-icon-button--destructive {
    color: var(--p-red-700);
}

/* Destructive (delete) keeps its danger colour through every state — a red icon
   on a soft-red wash — instead of turning blue, so the affordance is preserved. */
.base-icon-button--destructive:hover,
.base-icon-button--destructive:focus-visible,
.base-icon-button--destructive:active {
    background: var(--p-red-50);
    border-color: var(--p-red-200);
    color: var(--p-red-700) !important;
}

.base-icon-button__icon {
    font-size: var(--p-font-size-sm);
    line-height: 1;
}

/* PrimeVue Button override: kill its default sizing/padding so we control it.
   Without this, `text rounded` Button is ~40×40 with extra padding. */
:deep(.p-button-icon),
:deep(.p-button-label) {
    line-height: 1;
}

.base-icon-button.p-button {
    width: var(--p-spacing-5);
    height: var(--p-spacing-5);
    min-width: var(--p-spacing-5);
    padding: 0;
}

.base-icon-button.p-button:not(:disabled):hover,
.base-icon-button.p-button:not(:disabled):focus-visible,
.base-icon-button.p-button:not(:disabled):active {
    background: var(--p-tideblue-50);
    border-color: var(--p-skyblue-200);
    color: var(--p-skyblue-600) !important;
}

.base-icon-button--destructive.p-button:not(:disabled):hover,
.base-icon-button--destructive.p-button:not(:disabled):focus-visible,
.base-icon-button--destructive.p-button:not(:disabled):active {
    background: var(--p-red-50);
    border-color: var(--p-red-200);
    color: var(--p-red-700) !important;
}
</style>
