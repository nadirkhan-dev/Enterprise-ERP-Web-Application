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
  // Confirm action (e.g. the check that commits an inline card) — green glyph.
  confirm?: boolean
  // Show the button's border at rest instead of only on hover, and size it to the
  // 28px action box the inline editors' confirm/cancel pair uses.
  outlined?: boolean
  // Non-interactive informational state (e.g. a "no website" globe): grayed like
  // disabled, but still hoverable — it keeps pointer events, so a tooltip can
  // explain it. Rendered as a plain span rather than a link/button.
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
  confirm: false,
  outlined: false,
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
  'base-icon-button--confirm': props.confirm,
  'base-icon-button--outlined': props.outlined,
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
   colour (e.g. a deep-blue or gray icon), without each having to restate it.
   The disabled variant opts out by class: it keeps pointer events now (for the
   not-allowed cursor) and must not light up under them. */
.base-icon-button:hover:not(.base-icon-button--disabled),
.base-icon-button:focus-visible:not(.base-icon-button--disabled),
.base-icon-button:active:not(.base-icon-button--disabled) {
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

/* The <Button> branch is natively disabled, so it dispatches no click whatever
   pointer-events says — they're restored only so the not-allowed cursor renders.
   The <NuxtLink> branch has no native disabled state: there, `pointer-events:
   none` is what makes it inert, so it keeps it (and the default cursor with it). */
.base-icon-button--disabled {
    color: var(--p-surface-300);
    cursor: not-allowed;
    pointer-events: none;
}

.base-icon-button--disabled.p-button {
    pointer-events: auto;
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

/* An outlined muted button keeps its border through hover. The muted rules above
   clear border-color so the plain (borderless) variant shows no box, but that
   also out-specifies `--outlined`'s border on hover only — so an outlined muted
   control drew its box at rest and dropped it under the cursor. */
.base-icon-button--outlined.base-icon-button--muted,
.base-icon-button--outlined.base-icon-button--muted:hover,
.base-icon-button--outlined.base-icon-button--muted:focus-visible {
    border-color: var(--p-gray-200);
}

.base-icon-button--destructive {
    color: var(--p-red-700);
}

/* Confirm (check) — the green half of an inline card's confirm/cancel pair. */
.base-icon-button--confirm {
    color: var(--p-vividgreen-500);
}

.base-icon-button--confirm:hover,
.base-icon-button--confirm:focus-visible,
.base-icon-button--confirm:active,
.base-icon-button--confirm.p-button:not(:disabled):hover,
.base-icon-button--confirm.p-button:not(:disabled):focus-visible,
.base-icon-button--confirm.p-button:not(:disabled):active {
    background: var(--p-vividgreen-50);
    border-color: var(--p-vividgreen-300);
    color: var(--p-vividgreen-500) !important;
}

/* Outlined — the border shows at rest rather than on hover, on the same small
   icon-button box the drawer section headers use: 28px wide, height left to the
   small button's vertical padding (Figma 7469-104412 measures 24.75px). The
   variant tints follow it: confirm reads green, destructive red, anything else
   neutral. */
.base-icon-button--outlined {
    display: flex;
    width: var(--button-sm-icon-only-width, 28px);
    min-width: var(--button-sm-icon-only-width, 28px);
    height: auto;
    padding: var(--button-sm-padding-y, 5.25px) 0;
    justify-content: center;
    align-items: center;
    border-radius: var(--p-border-radius-xs);
    border-color: var(--p-gray-200);
    background: var(--p-surface-0);
}

.base-icon-button--outlined.base-icon-button--confirm {
    border-color: var(--p-vividgreen-200);
}

.base-icon-button--outlined.base-icon-button--destructive {
    border-color: var(--p-red-200);
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

/* The outlined box, restated against `.p-button` — the rule above sizes every
   icon button to a 20px square and PrimeVue's `rounded` gives it a pill, both of
   which outrank a lone variant class. */
.base-icon-button--outlined.p-button {
    display: flex;
    width: var(--button-sm-icon-only-width, 28px);
    min-width: var(--button-sm-icon-only-width, 28px);
    height: auto;
    padding: var(--button-sm-padding-y, 5.25px) 0;
    justify-content: center;
    align-items: center;
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);
}

.base-icon-button--outlined.p-button:not(:disabled) {
    border-color: var(--p-gray-200);
}

/* A disabled outlined button keeps its neutral border. `outlined` exists to show
   the border at rest, and the link/muted branches already hold theirs when
   disabled — only the colour-coded confirm/destructive borders drop away, so the
   control reads as unavailable rather than as having lost its box. */
.base-icon-button--outlined.p-button:disabled {
    border-color: var(--p-gray-200);
}

.base-icon-button--outlined.base-icon-button--confirm.p-button:not(:disabled) {
    border-color: var(--p-vividgreen-200);
}

.base-icon-button--outlined.base-icon-button--destructive.p-button:not(:disabled) {
    border-color: var(--p-red-200);
}

/* Hover tints, restated last so they beat the generic tideblue hover above. */
.base-icon-button--outlined.base-icon-button--confirm.p-button:not(:disabled):hover,
.base-icon-button--outlined.base-icon-button--confirm.p-button:not(:disabled):focus-visible,
.base-icon-button--outlined.base-icon-button--confirm.p-button:not(:disabled):active {
    background: var(--p-vividgreen-50);
    border-color: var(--p-vividgreen-300);
    color: var(--p-vividgreen-500) !important;
}

.base-icon-button--outlined.base-icon-button--destructive.p-button:not(:disabled):hover,
.base-icon-button--outlined.base-icon-button--destructive.p-button:not(:disabled):focus-visible,
.base-icon-button--outlined.base-icon-button--destructive.p-button:not(:disabled):active {
    background: var(--p-red-50);
    border-color: var(--p-red-300);
    color: var(--p-red-700) !important;
}
</style>
