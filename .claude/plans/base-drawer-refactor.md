# Plan: BaseDrawer Refactor — Unify All Drawer Components

**Created:** 2026-05-06
**Status:** Draft — Pending Review
**Task:** Extract a single `BaseDrawer` composite component (header / body / footer slots) and refactor every existing `Drawer*` component to consume it, without altering visible UI or breaking any current behavior.

---

## High Level Plan

There are **9 drawer components** in `app/components/` that all share an almost-identical PrimeVue `Drawer` skeleton: same `position`, same `:show-close-icon="false"`, same `class="drawer-width"` (with one variant — `drawer-width-landing-page`), same close-button header pattern, same `useDrawerScroll` + `useIsMobile` wiring, and a virtually identical `drawerPt` passthrough object that toggles header/footer shadows from scroll state. Today this boilerplate is duplicated verbatim across `DrawerAccountInfo.vue`, `DrawerAccountNote.vue`, `DrawerActivity.vue`, `DrawerAddressInfo.vue`, `DrawerContactInfo.vue`, `DrawerCreditCard.vue`, `DrawerErrorState.vue`, `DrawerManufacturer.vue`, and `DrawerViewContactInfo.vue`. Per `CLAUDE.md` and `.claude/rules/02-primevue-usage.md`, `Base*` wrappers are explicitly allowed when "genuinely composing multiple PrimeVue primitives" — `Drawer` + `Button` (close) + the scroll-shadow logic + body-scroll lock qualifies. This refactor replaces the duplication with one composite, **without touching the inner content of any drawer** (forms, sections, validation, save/load logic).

The new component is `app/components/BaseDrawer.vue`. Externally it accepts a `v-model:visible` (forwards `update:visible`), a `title` string, an optional `width` variant (`'default' | 'landing'`), an optional `hasError` boolean (which, when true, swaps the body content for an inline `Error500` and hides the footer — mirroring the pattern already in `DrawerAddressInfo`/`DrawerAccountInfo`), and an optional `errorMessage`. It exposes three slots: `#header` (extra content rendered **below** the title row, e.g., the StepProgress in `DrawerContactInfo` or the filter input in `DrawerViewContactInfo`), `default` (the body — what currently lives inside the `<div ref="contentRef" class="drawer-body">`), and `#footer` (action buttons; usually `BaseActionButtons`). The title row (left-aligned bold title + right-aligned `Button icon="pi pi-times"`) is rendered by `BaseDrawer` itself so that every consumer gets the identical close-button affordance for free.

The rationale for slots-only (rather than props for footer buttons) is that footers vary widely: `DrawerActivity`/`DrawerAccountInfo`/`DrawerAccountNote`/`DrawerCreditCard`/`DrawerManufacturer` use `BaseActionButtons` with different prop combinations, `DrawerContactInfo` has six footer variants gated on `currentStep` and `isEditMode`, and `DrawerErrorState`/`DrawerViewContactInfo` have no footer at all. A `#footer` slot keeps the base agnostic. Likewise an extra-header slot (rendered below the title row inside the same `<template #header>`) cleanly handles the two outliers (`StepProgress`, filter input) without forcing them to override the close-button row.

CSS strategy: the duplicated overrides (`:deep(.p-drawer-content) { padding: 0; overflow-y: auto; ... }`, `.drawer-header` row layout, `.drawer-title` typography, the base `.drawer-body` flex column with gap) move into `BaseDrawer.vue`'s scoped styles. Section-specific styles (the shipping cards in `DrawerAccountInfo`, the autocomplete styling in `DrawerAddressInfo`, the StepProgress styles in `DrawerContactInfo`, etc.) remain in their respective components — only the drawer chrome moves. The `.drawer-width` and `.drawer-width-landing-page` rules live in `app/assets/css/modules/drawer.css` and stay there (they're already shared); `BaseDrawer` will apply the right class based on the `width` prop. Because `BaseDrawer` provides `contentRef` to its body slot via `slotProps`, consumers don't need to wire up `useDrawerScroll` themselves anymore — but the `is-scrollable` class is still applied to the body wrapper (rendered by `BaseDrawer`) so existing CSS selectors that rely on `.drawer-body.is-scrollable` continue to match.

The refactor is **mechanical and reversible**: every drawer keeps its current props, emits, watchers, validation, store calls, and DOM structure inside the slots — nothing about the data flow or business logic changes. We will refactor one component at a time and verify visually before moving on.

## Low Level Description

### New file: `app/components/BaseDrawer.vue`

**Props (TypeScript interface, matching existing patterns):**
```ts
interface Props {
  visible?: boolean
  title?: string
  width?: 'default' | 'landing'   // maps to .drawer-width / .drawer-width-landing-page
  hasError?: boolean              // when true, render <Error500 mode="inline"> in body and skip #footer
  errorMessage?: string           // forwarded to Error500's :message prop (DrawerErrorState parity)
}
```
Defaults via `withDefaults`: `visible: false`, `title: ''`, `width: 'default'`, `hasError: false`, `errorMessage: undefined`.

**Emits:** `'update:visible': [value: boolean]`.

**Internal state (replicates the duplicated boilerplate):**
- `localVisible` — `computed` get/set wrapper around `visible` ↔ `update:visible` (matches every existing drawer's pattern at e.g. `DrawerAccountInfo.vue:22-25`).
- `contentRef = ref<HTMLElement | null>(null)` — passed to `useDrawerScroll(contentRef, localVisible)`.
- `{ isScrollable, showFooterShadow, showHeaderShadow }` from `useDrawerScroll` (`app/composables/useDrawerScroll.ts`).
- `{ isMobile }` from `useIsMobile()`.
- `drawerPt` — the exact `computed` object currently duplicated in 7 of 9 drawers (`DrawerAccountInfo.vue:105-133`, `DrawerActivity.vue:29-57`, etc.):
  ```js
  ({
    header: { style: { paddingBottom: isMobile.value ? undefined : 'clamp(0.375rem, 0.4vw + 0.25rem, 0.625rem)', boxShadow: showHeaderShadow.value ? 'var(--p-shadow-md)' : 'none', position: 'relative', zIndex: 99 } },
    content: { style: { position: 'relative', zIndex: 0, overflowX: 'hidden', paddingLeft: 'var(--p-spacing-4-375)', paddingRight: 'var(--p-spacing-4-375)' } },
    footer: { style: { boxShadow: showFooterShadow.value ? 'var(--p-shadow-top)' : 'none' } },
    root: { style: { overflowX: 'hidden' } },
  })
  ```
  Note: `DrawerViewContactInfo` omits `footer` and `content.position/zIndex` and uses different content padding — it currently has no footer. We keep the unified object and gate it via `useFooterShadow` only when a `#footer` slot is provided. Easier: always emit the same passthrough; the `footer` style is harmless when no footer renders. We will verify this in the implementation step. `DrawerErrorState` (no `useDrawerScroll` today) will gain the same passthrough — visually no change since both shadows resolve to `'none'` when `isScrollable` is false.

**Template structure:**
```html
<Drawer
  v-model:visible="localVisible"
  position="right"
  :show-close-icon="false"
  :class="width === 'landing' ? 'drawer-width-landing-page' : 'drawer-width'"
  :pt="drawerPt"
>
  <template #header>
    <div class="base-drawer__header-wrapper">
      <div class="base-drawer__header">
        <span class="base-drawer__title">{{ title }}</span>
        <Button icon="pi pi-times" text rounded severity="secondary" @click="localVisible = false" />
      </div>
      <slot name="header" />
    </div>
  </template>

  <Error500 v-if="hasError" mode="inline" :message="errorMessage" />

  <div
    v-else
    ref="contentRef"
    :class="['base-drawer__body', { 'is-scrollable': isScrollable }]"
  >
    <slot :content-ref="contentRef" :is-scrollable="isScrollable" />
  </div>

  <template v-if="!hasError && $slots.footer" #footer>
    <slot name="footer" />
  </template>
</Drawer>
```

**Scoped styles (extracted from the 9 components):**
- `:deep(.p-drawer-content) { padding: 0; overflow-y: auto; display: flex; flex-direction: column; }` — currently in 7 drawer files; safe to centralize. `DrawerErrorState` uses `overflow: hidden`; we will keep that as a one-line scoped override inside that consumer (see below).
- `.base-drawer__header-wrapper { width: 100%; display: grid; gap: var(--p-spacing-3); }` — only renders the gap when an extra `#header` slot is present (e.g. `DrawerViewContactInfo`'s filter, `DrawerContactInfo`'s StepProgress). When there is no extra slot content, the grid still works because there's only one row.
- `.base-drawer__header { display: flex; justify-content: space-between; align-items: center; width: 100%; }` — verbatim from `DrawerActivity.vue:250-255` etc.
- `.base-drawer__title { font-size: var(--p-font-size-lg); font-weight: var(--p-font-weight-bold); color: var(--p-deepblue-900); @media (min-width: 768px) { font-size: var(--p-font-size-xl); } }` — Title sizing varies between components. The mobile `lg`/desktop `xl` pattern (used by `DrawerCreditCard`, `DrawerErrorState`, `DrawerViewContactInfo`) is the most deferential. Components that previously used `xl` at all viewports (`DrawerAccountInfo`, `DrawerAccountNote`, `DrawerActivity`, `DrawerAddressInfo`, `DrawerContactInfo`, `DrawerManufacturer`) will become `lg` on mobile — this **does change mobile rendering for 6 components**. Flag in blockers; option B is to keep `xl` always and let the three currently-`lg`-on-mobile drawers grow on mobile. Option C is a `titleSize` prop. Recommendation in implementation: **Option A (lg→xl responsive) as default, plus a `titleSize` prop with `'responsive' | 'xl'` to preserve the legacy size for the six drawers that need it**. This way zero pixels move on existing screens.
- `.base-drawer__body { display: flex; flex-direction: column; gap: var(--p-spacing-4); padding: 0; flex: 1; }` — body gap also varies (`var(--p-spacing-4)` in 4 drawers, `var(--p-spacing-5)` in 2). Add a `bodyGap` prop with values `'4' | '5'` (default `'4'`) so existing visuals are preserved exactly.
- The `:deep(.p-drawer-header) { padding: ... }` overrides from `DrawerActivity`, `DrawerManufacturer`, `DrawerAddressInfo`, `DrawerCreditCard`, `DrawerViewContactInfo` are **identical** (`var(--p-spacing-3) var(--p-spacing-4-375)` mobile, `var(--p-spacing-4-375)` desktop). Move to `BaseDrawer`. The drawers that didn't have this override (`DrawerAccountInfo`, `DrawerAccountNote`, `DrawerContactInfo`, `DrawerErrorState`) will now inherit it. We will visually verify nothing shifts; if it does, gate via prop.

### Per-component refactor

Each existing drawer becomes a thin shell: keep `<script setup>` exactly as is (props, emits, watchers, validators, store calls, computed), and replace the `<template>` to use `<BaseDrawer>` instead of `<Drawer>`. Remove the now-redundant `useDrawerScroll`, `contentRef`, `useIsMobile`, and `drawerPt` declarations from each component's script — these now live in `BaseDrawer`. **Exception:** if a component still needs `isMobile` for non-drawer reasons (e.g., `DrawerContactInfo` uses `isMobile` for `dragHandle`, collapsed-state gating, and `StepProgress` `hide-chrome`), keep it as a separate `useIsMobile()` call.

Per-component changes:

1. **`DrawerErrorState.vue`** — Becomes the most trivial: `<BaseDrawer :title="title" v-model:visible="localVisible" has-error :error-message="message" />`. The `.drawer-error-container` wrapper inside the body becomes irrelevant because `BaseDrawer` already renders `Error500` inline when `hasError` is true. Removes ~60 lines.

2. **`DrawerAccountNote.vue`** — `<BaseDrawer :title="\`${context} Notes\`" v-model:visible="localVisible">` with default slot containing the `BaseCopyText` heading + textarea + char counter, and `#footer` slot containing the existing `BaseActionButtons`. Drop `contentRef`, `useDrawerScroll`, `drawerPt`, `useIsMobile`, the `:deep(.p-drawer-content)` rule, the `.drawer-header`/`.drawer-title` rules, and the `.drawer-body` rule. Keep `.form-field--grow`, `.note-skeleton`, `.char-counter`. Keep the `document.body.style.overflow` lock in the `watch` — wait, that's redundant: `useDrawerScroll` already locks body scroll. Remove the manual lock from `DrawerAccountNote.vue:84-93` and `DrawerActivity.vue:71/107` and `DrawerManufacturer.vue:78/91-93` (these double-lock today; `useDrawerScroll` covers it). Verify before removing.

3. **`DrawerActivity.vue`** — Same pattern: `<BaseDrawer title="Activity" v-model:visible="localVisible">` with body slot and `#footer` slot. Drop the same boilerplate. Keep `.form-field`, `.form-row--full` styles (these are the body-level styles, not drawer chrome).

4. **`DrawerManufacturer.vue`** — Same pattern: `<BaseDrawer title="Manufacturers" v-model:visible="localVisible">` with body slot and `#footer` slot. Keep `.manufacturer-image`, `.manufacturer-image__icon`, `.form-field`, `.form-row` body styles.

5. **`DrawerCreditCard.vue`** — Same pattern: `<BaseDrawer title="Credit Card" v-model:visible="localVisible">`. Keep `.card-type-addon`, `.card-type-icon`, `.form-row` styles. Title currently uses `lg→xl` responsive — this matches `BaseDrawer`'s default; no `titleSize` override needed. Body gap currently `var(--p-spacing-5)` — pass `body-gap="5"`.

6. **`DrawerAccountInfo.vue`** — `<BaseDrawer title="Account Information" v-model:visible="localVisible" :has-error="hasLoadError">` with body slot (the existing `<div class="drawer-section">` blocks) and `#footer` slot. The previous `<template v-if="!hasLoadError" #footer>` becomes implicit via `BaseDrawer`'s own `hasError` gate. Title currently `xl` always — pass `title-size="xl"`. Body gap `var(--p-spacing-4)` — default. Keep `.account-row--mobile/--desktop`, `.shipping-card*`, `.shipping-edit*`, `.phone-card*` styles.

7. **`DrawerAddressInfo.vue`** — `<BaseDrawer title="..." v-model:visible="localVisible" :has-error="hasLoadError">` with body slot and `#footer` slot. Title — currently `xl` always (no responsive media query at `DrawerAddressInfo.vue` ~903-907); pass `title-size="xl"`. Header padding override: the existing `:deep(.p-drawer-header)` rule (lines 883-889) becomes redundant — already in BaseDrawer. Verify by searching the rest of the file for any other `:deep(.p-drawer-header)` rule. Keep `.checkbox-group`, `.autocomplete-icon-wrapper`, `.address-suggestion`, `.tag-chip`, `.map-placeholder*`, `.form-row*` styles.

8. **`DrawerContactInfo.vue`** — `<BaseDrawer title="Contact Information" v-model:visible="localVisible" :has-error="hasLoadError">`. The previous `<DrawerErrorState v-if="hasLoadError" :visible="localVisible" @update:visible="localVisible = $event" />` early-return path (lines 1027-1031) is replaced by passing `:has-error="hasLoadError"` to `BaseDrawer` and removing the separate `<DrawerErrorState>` invocation. The existing `<template #header>` inner HTML (`drawer-header-wrapper` + `drawer-header` + `drawer-title` + close button + StepProgress) collapses to: title row is rendered by BaseDrawer; only the `<StepProgress v-if="!isMobile && !(isEditMode && currentStep === 1)" :steps="contactSteps" :current-step="currentStep" />` is passed through `#header` slot. Body slot wraps the existing body div — but `BaseDrawer` already renders the `drawer-body` wrapper, so the inner content of the existing `<div ref="contentRef" :class="['drawer-body', { 'is-scrollable': isScrollable }]">` becomes the slot content (drop the wrapping div). Footer slot wraps the multi-`v-if` action sets. **Important:** the existing scoped CSS uses `.drawer-body` selectors throughout; rename them to `.base-drawer__body` is **not** an option (we're not touching consumer styles). Instead, BaseDrawer's body wrapper class is `.drawer-body` (verbatim) so existing consumer `:deep(.drawer-body ...)` selectors keep matching. Confirmed: 7 of 9 drawers use `.drawer-body` — we keep this name for the BaseDrawer body wrapper to avoid touching every consumer. Update plan accordingly.

   **Correction to the BaseDrawer template:** the body wrapper class is `drawer-body` (not `base-drawer__body`) so consumer `:deep(.drawer-body ...)` selectors match unchanged. The header wrapper class is `drawer-header-wrapper` (matches `DrawerContactInfo.vue:1042` and `DrawerViewContactInfo.vue:111`'s `drawer-header-parent` — pick one and consolidate; recommendation: `drawer-header-wrapper`). The title row class is `drawer-header`, the title span class is `drawer-title`. **All four class names are reused verbatim from existing components**; this preserves consumers' `:deep()` overrides.

9. **`DrawerViewContactInfo.vue`** — `<BaseDrawer :title="title" v-model:visible="localVisible" width="landing">`. The filter input goes into `#header` slot. Body slot contains the contact list. **No footer.** Keep the `<Toast group="drawer-contact" ...>` — it lives outside the drawer in the template. Body uses different layout than `.drawer-body` (it uses `.drawer-view-contact__content` directly without the `.drawer-body` wrapper). Two options:
   - **A:** Pass a `bodyClass` prop or expose a body-replacement scoped slot. Cleaner: introduce a `noBodyWrapper` boolean prop; when true, BaseDrawer renders the `<slot />` raw without the `.drawer-body` div, and consumers handle their own `contentRef`/scroll wrapper. `DrawerViewContactInfo` would set `no-body-wrapper`, and its existing `<div ref="contentRef" :class="['drawer-view-contact__content', { 'is-scrollable': isScrollable }]">` would still need `useDrawerScroll` — but `BaseDrawer` doesn't expose `contentRef` in that mode.
   - **B:** Use the default body wrapper but allow class override. Change the body wrapper to `:class="['drawer-body', bodyClass, { 'is-scrollable': isScrollable }]"` — but `DrawerViewContactInfo` deliberately uses `.drawer-view-contact__content` only, not `.drawer-body`. Visual difference: `.drawer-view-contact__content` has its own gap/padding rules.
   - **Recommendation:** Option C — keep the `.drawer-body` wrapper always (it's just a flex column); have `DrawerViewContactInfo` add `.drawer-view-contact__content` as an additional class on the slot's inner element, or accept that the wrapper wraps the inner element. Simplest: expose `contentRef` and `isScrollable` via slot props (`v-slot="{ contentRef, isScrollable }"`) so the consumer renders its own inner wrapper inside the BaseDrawer body div. `DrawerViewContactInfo` would put `<div ref="contentRef" :class="[...]"><div class="drawer-view-contact__content">...</div></div>` — but then `useDrawerScroll` would be wired by `BaseDrawer` (correct) and the consumer's inner div is purely cosmetic. That keeps the visual layout untouched.

   Decision: **Option C — expose `contentRef` and `isScrollable` via the default slot's slot props.** Most consumers don't need them (the `.drawer-body` wrapper rendered by `BaseDrawer` is sufficient). The two outliers can still wire their own inner element inside the wrapper. This keeps the API minimal and zero-risk.

### Slot-prop contract

The default slot is the body. `BaseDrawer` already renders `<div ref="contentRef" :class="['drawer-body', { 'is-scrollable': isScrollable }]">` and passes `{ isScrollable }` as slot props. Consumers that need `isScrollable` (none currently outside the wrapper class) can use `v-slot="{ isScrollable }"`; otherwise they can use the bare `<slot />`.

### Migration order (low risk first)

The implementation order is intentional — start with the simplest drawers and grow into the complex ones. Each step is independently mergeable:

1. `DrawerErrorState.vue` (smallest; ~83 lines → ~25)
2. `DrawerAccountNote.vue` (~236 → ~110)
3. `DrawerActivity.vue` (~298 → ~180)
4. `DrawerManufacturer.vue` (~286 → ~190)
5. `DrawerCreditCard.vue` (~428 → ~310)
6. `DrawerAccountInfo.vue` (~842 → ~700) — has `hasError`/conditional footer
7. `DrawerAddressInfo.vue` (~880 → ~760) — same
8. `DrawerViewContactInfo.vue` (~376 → ~280) — `width="landing"`, no footer, custom inner element
9. `DrawerContactInfo.vue` (~2300 → ~2200) — most complex; `#header` slot, multi-step footer slot, replaces `DrawerErrorState` early-return path

### Existing consumer pages (zero changes expected)

The drawer **consumers** — `app/pages/Customers/[id].vue`, `app/pages/Customers/Index.vue`, `app/pages/Items/[id].vue`, `app/pages/Manufacturers/[id].vue`, `app/pages/Suppliers/[id].vue`, `app/components/SectionAddresses.vue`, `app/components/SectionActivities.vue`, `app/components/SectionContacts.vue`, `app/components/SectionCreditCards.vue`, `app/components/SectionManufacturers.vue` — **must not require any changes.** Each `Drawer*` component keeps its existing public API (props, emits, slots), so its consumers work unchanged. We will grep these consumers after the refactor to confirm no API drift.

### Verification per drawer

After each component is refactored, manually open the drawer in `npm run dev` and check:
- It opens/closes via the close button and via the `update:visible` v-model from the parent
- The save button still saves (where applicable) — no broken store calls
- The cancel button still closes — no broken handlers
- The header shadow appears on scroll-down, the footer shadow appears when not scrolled to bottom (test in a tall body — `DrawerAccountInfo`, `DrawerContactInfo` are easy candidates)
- Body scroll is locked while the drawer is open and unlocked on close (`useDrawerScroll` handles this in the composable; verify after removing the duplicate `document.body.style.overflow` locks)
- On mobile (≤767px): drawer is full-width via `.drawer-width` (or 92vw via `.drawer-width-landing-page` for `DrawerViewContactInfo`)
- On desktop (≥768px): drawer is `var(--p-layout-drawer-width)` wide
- Title font-size matches the previous render (use `titleSize="xl"` where the legacy was always-`xl`; otherwise `responsive` `lg→xl`)
- For `DrawerAccountInfo` and `DrawerAddressInfo`: simulate a server error to verify `Error500` renders inline and the footer is hidden (per `BaseDrawer`'s `hasError` gate)
- For `DrawerContactInfo`: walk through all three steps in both create and edit mode, verify all six footer variants render, and verify `StepProgress` placement in the header is unchanged on desktop

## Specific Actions

1. **Read CLAUDE.md and `.claude/rules/02-primevue-usage.md`** — confirm `Base*` wrapper policy applies to this composite (multiple PrimeVue primitives + scroll/body-lock logic). Already done in this plan; no further action.

2. **Create `app/components/BaseDrawer.vue`** with the props, slots, and template described above. Specifically:
   - `<script setup lang="ts">` with the `Props` interface (`visible`, `title`, `width`, `hasError`, `errorMessage`, `titleSize`, `bodyGap`)
   - `withDefaults(defineProps<Props>(), { visible: false, title: '', width: 'default', hasError: false, errorMessage: undefined, titleSize: 'responsive', bodyGap: '4' })`
   - `defineEmits<{ 'update:visible': [value: boolean] }>()`
   - `localVisible` computed
   - `contentRef`, `useDrawerScroll(contentRef, localVisible)` for `{ isScrollable, showFooterShadow, showHeaderShadow }`
   - `useIsMobile()` for `isMobile`
   - `drawerPt` computed (verbatim from the duplicated objects)
   - Template: `<Drawer>` with the dynamic class (`drawer-width` vs `drawer-width-landing-page`), `:pt="drawerPt"`, `position="right"`, `:show-close-icon="false"`, `v-model:visible="localVisible"`
   - `<template #header>`: `.drawer-header-wrapper` > (`.drawer-header` row with `.drawer-title` span + close `Button`) + `<slot name="header" />`
   - Body: `<Error500 v-if="hasError" mode="inline" :message="errorMessage" />` else `<div ref="contentRef" :class="['drawer-body', { 'is-scrollable': isScrollable }]"><slot :is-scrollable="isScrollable" /></div>`
   - Footer: `<template v-if="!hasError && $slots.footer" #footer><slot name="footer" /></template>`
   - Scoped styles: `:deep(.p-drawer-content)`, `:deep(.p-drawer-header)` padding, `.drawer-header-wrapper`, `.drawer-header`, `.drawer-title` (with the `titleSize === 'xl'` modifier class for fixed-`xl` rendering), `.drawer-body` (with `bodyGap === '5'` modifier for `gap: var(--p-spacing-5)`)
   - Apply title-size conditional: `:class="['drawer-title', { 'drawer-title--xl': titleSize === 'xl' }]"` — `responsive` is the default base rule (lg → xl @768px), `--xl` adds `font-size: var(--p-font-size-xl)` at all breakpoints.
   - Apply body-gap conditional similarly: `:class="['drawer-body', { 'drawer-body--gap-5': bodyGap === '5' }, { 'is-scrollable': isScrollable }]"`.

3. **Refactor `app/components/DrawerErrorState.vue`** to a thin wrapper using `<BaseDrawer :title="title" has-error :error-message="message" v-model:visible="localVisible" />`. Remove the local `:deep(.p-drawer-content)`, `.drawer-header`, `.drawer-title`, `.drawer-error-container`, and the body div. **Important caveat:** `DrawerErrorState` currently uses `:deep(.p-drawer-content) { padding: 0; overflow: hidden; }` (note `hidden`, not `auto`). `BaseDrawer` ships with `overflow-y: auto`. Visually, when only an `Error500` panel renders (no scrollable content), there's no scroll either way — should be visually identical. Verify in the browser; if not, add a `scrollableContent: boolean` prop (default `true`) to `BaseDrawer` to switch.

4. **Refactor `app/components/DrawerAccountNote.vue`**:
   - Remove `contentRef`, `useDrawerScroll(...)`, `useIsMobile()`, `drawerPt`, the `watch(... document.body.style.overflow ...)`, and `onBeforeUnmount(() => { document.body.style.overflow = '' })` — `useDrawerScroll` (now inside `BaseDrawer`) handles body-scroll lock.
   - Keep `noteText`, `MAX_CHARS`, `charCount`, `stripHtmlTags`, the `watch(props.visible, ...)` for `noteText.value = stripHtmlTags(props.remarks)`, `onSave`, `onCancel`.
   - Replace template's `<Drawer>` with `<BaseDrawer :title="\`${context} Notes\`" v-model:visible="localVisible" title-size="xl">`. Default slot: existing `.drawer-section__heading` + `.form-field--grow` block. `#footer` slot: existing `<BaseActionButtons />` block.
   - Remove styles: `:deep(.p-drawer-content)`, `.drawer-header`, `.drawer-title`, `.drawer-body`. Keep `.form-field--grow`, `.note-skeleton`, `.char-counter`.

5. **Refactor `app/components/DrawerActivity.vue`**:
   - Remove `contentRef`, `useDrawerScroll`, `useIsMobile`, `drawerPt`, the `document.body.style.overflow` lock in `watch` and `onBeforeUnmount`.
   - Replace `<Drawer>` with `<BaseDrawer title="Activity" v-model:visible="localVisible" title-size="xl">`. Default slot: existing form rows. `#footer` slot: existing `<BaseActionButtons :show-destructive="isEditing" ... />`.
   - Remove styles: `:deep(.p-drawer-header)`, `:deep(.p-drawer-content)`, `.drawer-header`, `.drawer-title`, `.drawer-body`. Keep `.form-field`, `.form-row--full` and the `:deep(.form-row--full ...)` selectors.

6. **Refactor `app/components/DrawerManufacturer.vue`**:
   - Remove `contentRef`, `useDrawerScroll`, `useIsMobile`, `drawerPt`, the `document.body.style.overflow` lock.
   - Replace `<Drawer>` with `<BaseDrawer title="Manufacturers" v-model:visible="localVisible" title-size="xl" body-gap="5">`. Default slot: existing add/edit mode template. `#footer` slot: existing `<BaseActionButtons />`.
   - Remove drawer-chrome styles. Keep `.manufacturer-image*`, `.form-field`, body-internal styles.

7. **Refactor `app/components/DrawerCreditCard.vue`**:
   - Remove `contentRef`, `useDrawerScroll`, `useIsMobile`, `drawerPt`.
   - Replace `<Drawer>` with `<BaseDrawer title="Credit Card" v-model:visible="localVisible" body-gap="5">`. (`titleSize` defaults to `responsive` — matches the existing `lg→xl` behavior.) Default slot: form fields. `#footer` slot: existing `<BaseActionButtons save-label="Add" ... />`.
   - Remove drawer-chrome styles. Keep `.card-type-addon`, `.card-type-icon*`.

8. **Refactor `app/components/DrawerAccountInfo.vue`**:
   - Remove `contentRef`, `useDrawerScroll`, `useIsMobile`, `drawerPt`.
   - Replace `<Drawer>` with `<BaseDrawer title="Account Information" v-model:visible="localVisible" title-size="xl" :has-error="hasLoadError">`. Drop the `<Error500 v-if="hasLoadError" mode="inline" />` block — `BaseDrawer` renders this. Drop the `v-else` on the body div. Drop the `<template v-if="!hasLoadError" #footer>` gating — `BaseDrawer` handles it. Default slot: the existing two `.drawer-section` blocks. `#footer` slot: `<BaseActionButtons :save-loading="isSaving" :save-disabled="isSaving" @save="onSave" @cancel="onCancel" />`.
   - Remove drawer-chrome styles. Keep all section/shipping/phone/account-row/form-row styles.

9. **Refactor `app/components/DrawerAddressInfo.vue`**:
   - Same pattern as #8: remove drawer-internal composable wiring, pass `:has-error="hasLoadError"`, drop the inline `<Error500>` block and `v-else` body branch, drop the `<template v-if="!hasLoadError" #footer>` gate. `<BaseDrawer :title="isEditMode ? 'Edit Address' : 'Add Address'" v-model:visible="localVisible" title-size="xl" :has-error="hasLoadError">`. Default slot: form rows + map. `#footer` slot: existing `<BaseActionButtons :show-destructive="isEditMode" ... />`.
   - Keep `useGeocoder`, map logic, autocomplete logic, validation — all unchanged.

10. **Refactor `app/components/DrawerViewContactInfo.vue`**:
    - Remove `contentRef`, `useDrawerScroll`, `useIsMobile`, `drawerPt`. Note: this drawer uses `useDrawerScroll` for header shadow only (no footer shadow). `BaseDrawer`'s shared `drawerPt` includes `footer.boxShadow` — but the consumer has no footer slot, so the footer style is unused. Verified safe.
    - Replace `<Drawer ... class="drawer-width-landing-page">` with `<BaseDrawer :title="title" v-model:visible="localVisible" width="landing">`.
    - `#header` slot: existing `.drawer-view-contact__filter` block.
    - Default slot: existing `.drawer-view-contact__list` block. Wrap inner content with `<div class="drawer-view-contact__content">...</div>` (no `ref`, no `is-scrollable` class — those are on the `BaseDrawer`-rendered `.drawer-body` parent now). Update `.drawer-view-contact__content`'s scoped styles to drop the `is-scrollable` selector reference if any.
    - Keep the `<Toast>` outside the drawer.
    - Keep filter logic (`filterText`, `filteredContacts`, `handleFilterIconClick`, `copyEmail`).
    - Drop the `drawer-header-parent` block — its grid layout (gap between title row and filter input) is now provided by `BaseDrawer`'s `.drawer-header-wrapper`.

11. **Refactor `app/components/DrawerContactInfo.vue`** (most complex, last):
    - Remove `contentRef`, `useDrawerScroll`, `useIsMobile` for the drawer chrome (keep `useIsMobile` separately for the `dragHandle`, `detailsCollapsed` etc. computeds), `drawerPt`.
    - Drop the `<DrawerErrorState v-if="hasLoadError" ...>` early return. Pass `:has-error="hasLoadError"` to `BaseDrawer` instead.
    - Replace `<Drawer>` with `<BaseDrawer title="Contact Information" v-model:visible="localVisible" title-size="xl" :has-error="hasLoadError">`.
    - `#header` slot: `<StepProgress v-if="!isMobile && !(isEditMode && currentStep === 1)" :steps="contactSteps" :current-step="currentStep" />`.
    - Default slot: the existing `<template v-if="isEditMode && currentStep === 1">` block + the `<StepProgress>` mobile chrome wrapper + all step content.
    - `#footer` slot: the existing six-variant `v-if` block, **but drop the outer `<template v-if="!hasLoadError" #footer>` because `BaseDrawer` already gates the footer on `hasError`**. Replace with a fragment that contains the six `v-if` branches.
    - Keep all script logic: form, validation, step progression, duplicate-check, `originalDuplicateFields`, `step3Snapshot`, `searchContactDuplicates`, `onSave`, `onCancel`, `onDelete`, `handleContactNextStep`, `handleContactBackToForm`, `handleContactFinalReview`, `editingContact*` flags, collapse computeds — completely unchanged.
    - Remove drawer-chrome styles (`:deep(.p-drawer-content)`, `.drawer-header-wrapper`, `.drawer-header`, `.drawer-title`, `.drawer-body`). Keep the StepProgress, step-card, contact-detail, phone-card, etc. styles.

12. **Run `npm run dev`** and walk through every drawer end-to-end:
    - Customer detail page (`/Customers/[id]`): open Account Note, Account Info, Contacts (Section), Addresses (Section), Activities (Section), Credit Cards (Section), Manufacturers (Section)
    - Customer landing (`/Customers/Index`): open Contact Info preview drawer
    - Items detail (`/Items/[id]`): open Account Note
    - Suppliers detail (`/Suppliers/[id]`): open Account Note
    - Manufacturers detail (`/Manufacturers/[id]`): open Account Note
    - For each: verify open/close, save/cancel, scroll shadows (header + footer when scrollable), error state (force a 500 if practical), mobile width (≤767px), desktop width (≥768px), title font-size, footer button placement and labels.

13. **Run `grep -rn "useDrawerScroll" app/components/Drawer*.vue`** to confirm only `BaseDrawer.vue` uses it after the refactor. Run `grep -rn "drawerPt" app/components/Drawer*.vue` likewise.

14. **Run `grep -rn "@media.*max-width" app/components/Drawer*.vue app/components/BaseDrawer.vue`** to confirm `13-mobile-first.md` policy is preserved (zero hits expected).

15. **Confirm no consumer pages were touched** — `git status` should show changes only in `app/components/Drawer*.vue` and `app/components/BaseDrawer.vue`. The user will commit; this plan does not include git operations.

## Possible Blockers

- **Title font size on mobile (lg vs xl)** — Six existing drawers render the title at `xl` even on mobile. The proposed mitigation is a `titleSize: 'responsive' | 'xl'` prop with `responsive` (lg→xl) as the default and `xl` for the legacy six. If you'd rather keep the legacy size everywhere by default and explicitly opt into the responsive variant for the three currently-responsive drawers (`DrawerCreditCard`, `DrawerErrorState`, `DrawerViewContactInfo`), invert the default to `'xl'` and add `title-size="responsive"` to those three. Either way, no pixels move unless we agree to.

- **Body gap (spacing-4 vs spacing-5)** — Same shape: a `bodyGap: '4' | '5'` prop preserves both layouts. `DrawerCreditCard` and `DrawerManufacturer` use `'5'`; everyone else `'4'`.

- **`:deep(.p-drawer-content) { overflow: hidden }` in `DrawerErrorState`** — `BaseDrawer` defaults to `overflow-y: auto`. Visually identical when content fits, but if the inline `Error500` renders taller than the viewport (unlikely on a drawer-sized container), it would scroll instead of clipping. Mitigation: add a `scrollableContent: boolean` prop (default `true`) to `BaseDrawer`; `DrawerErrorState` would set `:scrollable-content="false"`. Defer until visual diff appears.

- **`document.body.style.overflow` double-locking** — `DrawerActivity`, `DrawerManufacturer`, and `DrawerAccountNote` each lock `document.body.style.overflow = 'hidden'` in their own `watch(props.visible)` on top of `useDrawerScroll`'s `lockBodyScroll()`. The composable also resets to `''` on close. Removing the duplicate locks is safe in theory; verify by opening these three drawers and confirming the page behind doesn't scroll, and that closing the drawer restores scroll. If a regression appears, leave the duplicate locks in (harmless but redundant).

- **`DrawerViewContactInfo` body has different padding/gap than other drawers** — `.drawer-view-contact__content` uses its own `gap` and `padding`. `BaseDrawer`'s `.drawer-body` provides a baseline `gap: var(--p-spacing-4)`. Two cascading gaps could double up (slot's outer wrapper has gap, slot's inner content also has gap). The cleanest fix is to keep the `.drawer-view-contact__content` div as the immediate child of `.drawer-body` — `.drawer-body` is a flex column that wraps a single child (the inner div), so the `.drawer-body`'s own gap has no effect. Verified safe.

- **`DrawerContactInfo` Error500 path** — Currently it renders `<DrawerErrorState v-if="hasLoadError" :visible="..." @update:visible="..." />` as an entirely separate drawer when `hasLoadError` is true. After the refactor, `BaseDrawer`'s built-in error state will render `Error500` inline within the same drawer instance. The user-visible difference: the error drawer used to have `title="Internal Error Occured"` (`DrawerErrorState`'s default), but the inline error path will keep the original `title="Contact Information"`. Confirm this is acceptable — if not, expose a `errorTitle` prop (or pass a different `title` prop to `BaseDrawer` when in error mode). Recommendation: keep `"Contact Information"` for context; the inline `Error500` already conveys "an error occurred."

- **PrimeVue `Drawer` MCP API** — the `pt` (passthrough), `:show-close-icon`, `position`, `class`, `v-model:visible`, `#header` and `#footer` slots are confirmed by `.claude/rules/02-primevue-usage.md` and exist in the current code. No MCP query needed beyond what we already see in use across all 9 drawers.

- **Unintended style cascade** — Centralizing `:deep(.p-drawer-header)` padding in `BaseDrawer` will apply it to drawers that previously didn't override it (`DrawerAccountInfo`, `DrawerAccountNote`, `DrawerContactInfo`, `DrawerErrorState`). Visual side effect: header padding becomes `var(--p-spacing-3) var(--p-spacing-4-375)` on mobile, `var(--p-spacing-4-375)` on desktop. The PrimeVue default it overrides is `1.125rem 1.5rem`. Likely visually neutral or improved. Verify per-drawer; if anything looks off, add a `headerPadding: 'default' | 'compact'` prop to switch between PrimeVue's default and the override.

- **TypeScript and slot types** — `$slots.footer` access in the template is fine in `<script setup lang="ts">`, but conditional slot rendering should use `useSlots()` if we want a typed `slots.footer` reference. Either approach works; this is a stylistic call.

- **No automated tests** — the project has no test runner configured (`CLAUDE.md` Quick Start). All verification is manual via `npm run dev`. This is a significant refactor across 9 files and 6+ pages; budget time accordingly. Recommendation: refactor and verify one drawer at a time before moving to the next.

- **DrawerContactInfo size** — at ~2300 lines, it's the largest file in the codebase. The refactor only touches its `<template>` chrome (lines ~1027-1041 and ~2116-2249) and removes ~30 lines of script boilerplate. The other ~95% is unchanged. Low risk per-line, but the template diff will be large; review with care.
