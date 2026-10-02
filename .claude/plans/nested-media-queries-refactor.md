# Plan: Nested Media Queries Refactor

**Created:** 2026-04-20
**Status:** Draft — Pending Review
**Task:** Convert every top-level `@media` block across `app/**/*.vue` and `app/assets/css/**/*.css` into CSS-native nested media queries authored **inside** the class rule they affect.

---

## High Level Plan

All `@media` blocks in the codebase are currently authored as top-level rules that repeat the class selector inside the breakpoint wrapper. This separates responsive styles from the base rule they modify, which hurts locality and — combined with the mobile-first rule already in force — makes it easy for contributors to leave orphaned `max-width` overrides (as happened in `DrawerContactInfo.vue` line 2396). The goal is to refactor every breakpoint to live **inside** the class block it modifies, using native CSS Nesting Module Level 1 syntax.

The refactor is purely syntactic for the vast majority of rules: move each `@media (min-width: 768px) { .foo { prop: val } }` inside the `.foo { … }` block as `@media (min-width: 768px) { prop: val }`. Browser-native nesting is used throughout — no build-tool changes. Native nesting is supported in Chrome 112+ (Apr 2023), Safari 16.5+ (May 2023), and Firefox 117+ (Aug 2023); for a Nuxt 4 SPA in Apr 2026, the floor is well below required support. Vite/Nuxt 4 ship CSS through PostCSS 8.5.6 but without a nesting plugin installed (`node_modules/postcss-nesting` absent, `node_modules/lightningcss` absent), so nested rules are passed through to the browser verbatim — which is the desired behavior.

A secondary correctness step is included: the single remaining `@media (max-width: 767px)` block at `app/components/DrawerContactInfo.vue:2396–2413` violates `.claude/rules/13-mobile-first.md` and must be converted to mobile-first authoring **before** being nested. Multi-selector shared `@media` blocks (e.g. `app/assets/css/main.css:59–73`, one `@media (min-width: 768px)` wrapping 14 PrimeVue input selectors for the iOS zoom fix) are expanded so each selector owns its own nested breakpoint — per user decision, locality wins over DRY in this pass.

Finally, `.claude/rules/13-mobile-first.md` is updated to codify nested media queries as the required authoring style, so future code (and Claude Code assistants reading the rules directory) defaults to the new convention automatically. An accompanying pre-commit grep check is added to detect accidental regressions to top-level `@media` rules.

## Low Level Description

### Toolchain verification (no changes)

- `package.json` declares no `postcss-nesting`, no `lightningcss`, no `autoprefixer`.
- `node_modules/postcss` v8.5.6 is present only as a transitive dependency of Vue/Vite.
- `nuxt.config.ts` has no PostCSS options configured.
- Vite 7 (via `@vitejs/plugin-vue` ^6.0.4) passes SFC `<style scoped>` CSS through Vue's SFC compiler, which performs scoped-class rewriting but does **not** flatten nesting. Native browser nesting handles the final flattening.
- Prettier 3 (`.prettierrc.json`) formats nested CSS correctly — no config changes needed.

### Nesting syntax conventions

Adopt these canonical forms so the codebase stays uniform:

**1. Simple class + single breakpoint enhancement**

```css
/* Before */
.drawer-width {
    width: 100vw !important;
}
@media (min-width: 768px) {
    .drawer-width {
        width: var(--p-layout-drawer-width) !important;
    }
}

/* After */
.drawer-width {
    width: 100vw !important;

    @media (min-width: 768px) {
        width: var(--p-layout-drawer-width) !important;
    }
}
```

**2. Multiple breakpoints (tablet + laptop + desktop tiers)**

```css
.info-grid {
    grid-template-columns: 1fr;

    @media (min-width: 768px) {
        grid-template-columns: repeat(2, 1fr);
    }
    @media (min-width: 1024px) {
        grid-template-columns: repeat(3, 1fr);
    }
    @media (min-width: 1440px) {
        grid-template-columns: repeat(4, 1fr);
    }
}
```

**3. `:deep()` selectors** — the media query sits inside the `:deep(...)` rule:

```css
:deep(.step-body--has-line) {
    border-left: 2px solid transparent;

    @media (min-width: 768px) {
        border-left: none;
    }
}
```

**4. Compound selectors (`.a :deep(.b)`)** — nest the breakpoint inside the compound rule block. Do not split the compound across rules.

```css
.step-progress--confirm :deep(.step-body--has-line) {
    /* base — none, since mobile styles live on :deep(.step-body--has-line) directly */

    @media (min-width: 768px) {
        border-left: none;
    }
}
```

**5. Pseudo-elements with nested breakpoints** — nest `::before`/`::after` via `&::before { … }`, with `@media` inside as needed:

```css
:deep(.step-body--has-line) {
    position: relative;

    &::before {
        content: '';
        position: absolute;
        left: -2px;
        top: 0;
        bottom: var(--p-spacing-4);
        width: 2px;
        background: var(--p-gray-200);
    }

    @media (min-width: 768px) {
        /* desktop overrides here */
    }
}
```

**6. Multi-selector expansion** — per user decision, duplicate the nested breakpoint per selector when a shared top-level `@media` covered many unrelated classes. Example (`main.css:44–73`):

```css
/* Before — one @media covering 14 selectors */
.p-inputtext, .p-textarea, /* ...12 more... */ {
    font-size: var(--p-font-size-base) !important;
}
@media (min-width: 768px) {
    .p-inputtext, .p-textarea, /* ...12 more... */ {
        font-size: var(--p-font-size-sm) !important;
    }
}

/* After — 14 individual class blocks, each with its own nested breakpoint */
.p-inputtext {
    font-size: var(--p-font-size-base) !important;

    @media (min-width: 768px) {
        font-size: var(--p-font-size-sm) !important;
    }
}
.p-textarea {
    font-size: var(--p-font-size-base) !important;

    @media (min-width: 768px) {
        font-size: var(--p-font-size-sm) !important;
    }
}
/* ...12 more... */
```

**7. Height queries** (`@media (max-height: …)` / `@media (min-height: …)`) — same nesting pattern as width queries. These are exempt from the mobile-first rule but still get nested. Only `AppSideNav.vue:916` and `AppSideNav.vue:930` use them today.

### Files in scope

Per `grep -rn "@media" app/`, the refactor touches **35 files** with **60 `@media` occurrences**:

**CSS modules (9 files, 11 blocks):**
- `app/assets/css/main.css` (1 block, 14 selectors — multi-selector expansion)
- `app/assets/css/modules/drawer.css` (2 blocks)
- `app/assets/css/modules/form-field.css` (1 block)
- `app/assets/css/modules/create-form.css` (1 block)
- `app/assets/css/modules/toast.css` (2 blocks)
- `app/assets/css/modules/data-table.css` (1 block)
- `app/assets/css/modules/info-grid.css` (1 block)

**Vue SFCs (26 files, ~49 blocks):**
- `app/layouts/default.vue` (1)
- `app/pages/Customers/[id].vue` (1), `app/pages/Customers/Create.vue` (1)
- `app/pages/Items/[id].vue` (5)
- `app/pages/Suppliers/[id].vue` (1), `app/pages/Suppliers/Create.vue` (1)
- `app/pages/Manufacturers/[id].vue` (4)
- `app/components/DrawerContactInfo.vue` (9 — including the one `max-width` block)
- `app/components/DrawerActivity.vue` (2), `app/components/ProfileCard.vue` (2), `app/components/AppSideNav.vue` (2 — max-height), `app/components/AppTopNav.vue` (2), `app/components/ConfirmCreate.vue` (3), `app/components/DuplicateCheck.vue` (3)
- 13 more single-occurrence components (list from the grep earlier).

Exact per-file occurrence counts are in the grep output captured during planning and must be re-verified before execution (files will have changed since).

### Prerequisite: convert the remaining `max-width` block

`app/components/DrawerContactInfo.vue:2396` still wraps `:deep(.step-body--has-line)` and its `::before` inside `@media (max-width: 767px)`. Before nesting this block, apply the mobile-first conversion recipe from `.claude/rules/13-mobile-first.md`:

1. Unwrap the `max-width: 767px` block; move its body to the base `:deep(.step-body--has-line) { … }` / `:deep(.step-body--has-line)::before { … }` rules.
2. The existing `@media (min-width: 768px)` block at line 2417 already resets the desktop side for `.step-progress--confirm`; leave it in place — it will be nested in step 2 of this plan.

This prerequisite is identical to the conversion authored earlier at `/home/gerard/.claude/plans/there-s-a-recent-changes-parsed-planet.md` (which was reverted); it's incorporated here so the work is self-contained.

### Rule-doc update (`.claude/rules/13-mobile-first.md`)

Add a **"Authoring: nested media queries"** subsection after the existing **Authoring Pattern** block. Content (full text proposed):

```markdown
## Authoring: nested media queries

All width breakpoints MUST be authored **nested inside the class block** they modify, using native CSS nesting syntax. Top-level `@media` rules are banned — even for `min-width`.

```css
/* GOOD — nested */
.drawer-body {
    gap: var(--p-spacing-5);

    @media (min-width: 768px) {
        gap: var(--p-spacing-6);
        padding: var(--p-spacing-3) 0 0;
    }
}

/* BAD — top-level @media */
.drawer-body {
    gap: var(--p-spacing-5);
}
@media (min-width: 768px) {
    .drawer-body {
        gap: var(--p-spacing-6);
    }
}
```

Exception: **`@media (max-height: …)` / `@media (min-height: …)`** viewport-height queries MAY remain top-level when they intentionally affect multiple unrelated classes (see `AppSideNav.vue`). Width-based height queries must still follow the nested pattern.

Shared width breakpoints that previously covered multiple unrelated selectors must be **duplicated inside each selector's block** rather than kept as a grouped top-level rule. Locality beats repetition.
```

Also append one line to the **Pre-Commit Check** section:

```bash
grep -rnE "^@media[^{]*\(min-width" app/
```
Expected: **zero hits**. All `min-width` media queries should be nested inside class blocks (indented).

### Verification tooling

No new scripts; two shell checks become the contract:

1. **No top-level `max-width` width queries** (existing rule):
   ```bash
   grep -rnE "@media[^{]*max-width[^{]*\)" app/
   ```
   Expected: zero hits.

2. **No top-level `min-width` width queries** (new rule):
   ```bash
   grep -rnE "^@media[^{]*\(min-width" app/
   ```
   Expected: zero hits. (Top-level = starts at column 0; nested `@media` inside a rule is always indented.)

## Specific Actions

Actions are ordered so the codebase compiles and runs after every step.

### Phase 1 — Prerequisites

1. In `app/components/DrawerContactInfo.vue`, unwrap the `@media (max-width: 767px)` block at lines 2396–2413: move `:deep(.step-body--has-line)` and `:deep(.step-body--has-line)::before` rules to the base (no media query). Leave the `@media (min-width: 768px)` block below untouched for now.

### Phase 2 — CSS modules (smaller, easier to verify)

Each action here: convert every top-level `@media` in the named file to nested form, following conventions 1–5 from the Low Level Description. No behavioral changes — the rendered CSS must be byte-equivalent in effect after browser flattening.

2. `app/assets/css/modules/drawer.css` — nest both `@media (min-width: 768px)` blocks (`.drawer-width`, `.drawer-width-landing-page`) into their respective class rules.
3. `app/assets/css/modules/form-field.css` — nest the `@media (min-width: 768px)` block into `.form-row`.
4. `app/assets/css/modules/create-form.css` — nest the `@media (min-width: 768px)` block into `.customer-create-page .customer-create-back.base-back-button` (compound selector convention 4).
5. `app/assets/css/modules/toast.css` — nest both `@media (min-width: 768px)` blocks (`.p-toast`, `.drawer-contact-toast`) into their respective class rules.
6. `app/assets/css/modules/data-table.css` — nest the `@media (min-width: 768px)` block into `.scroll-nav`.
7. `app/assets/css/modules/info-grid.css` — nest the `@media (min-width: 768px)` block into `.info-grid`.
8. `app/assets/css/main.css` — apply **multi-selector expansion** (convention 6): split the shared 14-selector base + `@media` pair into 14 individual class blocks, each with its own nested `@media (min-width: 768px)`. Also nest any other top-level `@media` in this file.

**Checkpoint after Phase 2**: `npm run dev`, smoke test, then run grep check (2) above against `app/assets/css/` — expect zero hits.

### Phase 3 — Component SFCs (largest surface, incremental)

Convert SFCs in the order below. Within each file, follow conventions 1–7 and the `:deep()` / compound-selector guidance. Test the component visually after each conversion (drawer opens, list renders, layout flows correctly at <768px, 768–1023, 1024–1439, ≥1440px).

9. `app/components/AppSideNav.vue` — nest `@media (max-height: 570px)` and `@media (max-height: 469px)` into `.app-side-nav__nav` (height-query nesting, convention 7).
10. `app/components/AppTopNav.vue` (2 blocks).
11. `app/components/BasePanel.vue`, `app/components/BaseAvatarEditMenu.vue` (1 each).
12. `app/components/ProfileCard.vue` (2 blocks).
13. `app/components/DrawerActivity.vue` (2 blocks).
14. `app/components/DrawerContactInfo.vue` — nest all 9 `@media` blocks. Special care at the confirm step progress (lines ~2396–2459) because it mixes `:deep()` with compound selectors. Base styles on `:deep(.step-body--has-line)`; nest `@media (min-width: 768px)` inside to undo them for `.step-progress--confirm` compound. Also nest blocks around `.drawer-body`, `.phone-card__*`, `:deep(.step-header)`, `:deep(.confirm-collapse-btn)`, `:deep(.confirm-edit-btn)`, and the footer button.
15. `app/components/DrawerAccountInfo.vue`, `DrawerAddressInfo.vue`, `DrawerViewContactInfo.vue`, `DrawerCreditCard.vue`, `DrawerAccountNote.vue`, `DrawerManufacturer.vue` (1 each).
16. `app/components/SectionActivities.vue`, `SectionContacts.vue`, `SectionAddresses.vue`, `SectionCreditCards.vue`, `SectionManufacturers.vue` (1 each).
17. `app/components/ConfirmCreate.vue` (3 blocks), `DuplicateCheck.vue` (3 blocks), `StepProgress.vue` (1 block).

### Phase 4 — Pages

18. `app/pages/Customers/[id].vue`, `app/pages/Customers/Create.vue` (1 each).
19. `app/pages/Suppliers/[id].vue`, `app/pages/Suppliers/Create.vue` (1 each).
20. `app/pages/Manufacturers/[id].vue` (4 blocks).
21. `app/pages/Items/[id].vue` (5 blocks).
22. `app/layouts/default.vue` (1 block).

### Phase 5 — Rule-doc update and verification

23. Update `.claude/rules/13-mobile-first.md` with the new **Authoring: nested media queries** subsection and the additional pre-commit grep line — full proposed content in Low Level Description above.
24. Run final verification:
    - `grep -rnE "@media[^{]*max-width[^{]*\)" app/` → zero hits (existing rule, preserved).
    - `grep -rnE "^@media[^{]*\(min-width" app/` → zero hits (new rule).
    - `grep -rnE "^@media[^{]*\(max-height" app/` → may show `AppSideNav.vue` pre-nest; expected zero after step 9.
25. `npm run dev` — full smoke test across mobile (<768px), tablet (768–1023), laptop (1024–1439), desktop (≥1440) viewports.
26. `npm run build` — confirm production build succeeds and emits equivalent CSS.
27. `npm run typecheck` — sanity only (no types involved in CSS), confirms no SFC parse regression.

## Possible Blockers

- **Vue SFC scoped-style interaction with native nesting.** Vue's scoped compiler rewrites selectors (adds `[data-v-xxxx]` attribute). This works on nested rules in Vue 3.5, but any SFC using `<style scoped>` + deep-nested `:deep()` + nested `@media` needs a quick smoke test per component. If a rendering bug appears in a single SFC, fall back to flattening just that one and document the exception — do not add a PostCSS plugin globally without user approval.
- **Vue SFC parser tolerance for nested-at-rules.** `@vitejs/plugin-vue` ^6.0.4 (shipped with Vue 3.5) handles nested CSS, but the combo has not been load-tested in this repo. First SFC conversion (recommend step 9, `AppSideNav.vue`) acts as the canary; if it parses and renders clean, the rest follow.
- **Pseudo-element nesting syntax.** `&::before { … }` inside a parent rule requires native nesting's **relaxed nesting** (accepted in all target browsers since 2023, but older tutorials show `& ::before` which is a descendant combinator, not pseudo). Reviewers must confirm `&::before` (no space) in diffs.
- **DrawerContactInfo.vue complexity.** This file has 9 `@media` blocks, multiple `:deep()` selectors, and nested `.step-progress--confirm` compound rules. It is the highest-risk SFC in the refactor; plan for a dedicated QA pass on all three drawer modes (new, edit, confirm step) at every breakpoint tier.
- **Prettier format churn.** Prettier 3 formats nested CSS, but line-diffs will be noisy (every `@media` block becomes +1 indent level, every base rule gains trailing members). Reviewer should use a whitespace-ignoring diff (`git diff -w`) for meaningful review.
- **Pre-existing raw values.** This refactor does not touch raw hex values (e.g., `#E2E8F0`, `#334155` in `DrawerContactInfo.vue`) or the `17.5px` padding at line 2016. Those violate `.claude/rules/03-css-tokens.md` but are explicitly out of scope; flagging here so the reviewer doesn't expect them to change.
- **No test coverage for CSS.** There is no snapshot or visual-regression layer in the repo (`.claude/rules/12-testing.md` forbids snapshots). Verification is manual-visual only; regressions at boundary viewports (especially 768px and 1024px) will only surface via the dev-server smoke test in Phase 5 step 25.
- **Rule-doc drift.** `.claude/rules/13-mobile-first.md` is loaded into every Claude session — if the doc update lands before the code refactor completes, future Claude runs may flag in-progress files as non-compliant. Recommend landing the doc change **last** (step 23) to preserve this consistency window, even though it's listed in Phase 5.
