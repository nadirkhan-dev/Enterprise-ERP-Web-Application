# Plan: Mobile-First CSS Refactor (min-width media queries, breakpoint consolidation)

**Created:** 2026-04-17
**Status:** Draft — Pending Review
**Task:** Convert the CSS codebase to a strict mobile-first architecture. Eliminate `@media (max-width: …)` queries in favor of `@media (min-width: …)`, consolidate breakpoints onto the 4 defined tokens, and document the rule so future work stays consistent.

---

## High Level Plan

The codebase is already *partially* mobile-first. `app/presets/extend.js` (lines 119–126) defines a 4-tier `breakpoint` scale (`mobile: 0`, `tablet: 768`, `laptop: 1024`, `desktop: 1440`) with the comment *"min-width, mobile-first"*, and `app/utils/breakpoints.ts` exposes the same constants to JS with the same intent. Newer CSS modules (`toast.css`, `form-field.css`, `data-table.css`, `create-form.css`) already follow the mobile-first pattern — the mobile styles are the default and `@media (min-width: 768px)` layers on tablet/desktop enhancements. But ~14 files still mix in `@media (max-width: …)` blocks (desktop-first overrides), and a couple of shared modules (`info-grid.css`) default to a desktop layout that pages then have to re-override for mobile. The goal is to flip the remaining inverted rules so the *mobile* declarations are the base, and widen screens *add* to the base via `min-width` queries only.

On the specific question "does changing `max-width` → `min-width` help?" — **yes, but it is not a find-and-replace**. True mobile-first means the stylesheet reads top-to-bottom as: "here is the mobile layout → at 768px add tablet refinements → at 1024px add laptop refinements." Every `max-width: 767px` block today carries declarations that *should be the default*, with its sibling `min-width: 768px` block carrying the overrides. To invert, we hoist the mobile declarations out of the media query to become the base rule, and move any conflicting default declarations into a new or existing `min-width: 768px` block. This produces a cleaner cascade, removes breakpoint overlap risk (e.g. `max-width: 768px` + `min-width: 768px` both fire at exactly 768px), and makes the mobile experience the first thing a future reader sees.

The refactor also standardizes the four breakpoints (768 / 1024 / 1440). Today there are one-off values (`425px`/`426px` in `BasePanel.vue`, `max-width: 768px` typo in `DrawerCreditCard.vue` and `DrawerViewContactInfo.vue` that overlaps with `min-width: 768px`) that should collapse onto the tablet token or be explicitly justified. `AppSideNav.vue`'s `max-height` queries are left alone — they target viewport *height*, not width, so they aren't in scope for mobile-first width-based breakpoints. The ban on `@media (max-width: …)` in `.claude/rules/03-css-tokens.md` (new section) will stop the pattern from creeping back in.

Finally, `.claude/rules/03-css-tokens.md` and (new) `.claude/rules/13-mobile-first.md` will document: (1) `min-width`-only policy, (2) the four-breakpoint scale with canonical pixel values, (3) the "mobile defaults in base rule, desktop enhancements in `min-width` blocks" authoring pattern, and (4) guidance on `clamp()` / fluid values for spacing where a breakpoint jump isn't needed. No changes to `extend.js` are required — the breakpoint tokens already exist; CSS can't consume them inside `@media` without PostCSS `@custom-media` support (flagged as a blocker, not tackled here).

## Low Level Description

### Canonical breakpoint scale (already defined, just enforce)

From `app/presets/extend.js:119-126` and `app/utils/breakpoints.ts:5-8`:

| Tier | Range | `@media` form |
| --- | --- | --- |
| Mobile (base) | 0–767px | *no media query — base rules* |
| Tablet | 768–1023px | `@media (min-width: 768px) { … }` |
| Laptop | 1024–1439px | `@media (min-width: 1024px) { … }` |
| Desktop | ≥1440px | `@media (min-width: 1440px) { … }` |

All width media queries in the codebase must use exactly these four boundaries. The boundary is `768px` (not `767px`, not `769px`). Mobile styles go in the base rule (no query wrapper).

### Inversion recipe (applied per-file)

For every `@media (max-width: 767px) { .X { prop: value; } }` block:

1. Identify the sibling rule for `.X` in the same file that declares the same property at desktop scope — this might be a `@media (min-width: 768px)` block or a bare declaration.
2. Move the *mobile* declarations (currently inside the `max-width` block) into the base (unmediated) rule for `.X`.
3. Move the *desktop* declarations (the ones we displaced, if any) into a `@media (min-width: 768px)` block, merging with any existing one.
4. Delete the empty `@media (max-width: 767px)` block.

Example — `app/assets/css/modules/drawer.css:1-11` (current):
```css
.drawer-width { width: var(--p-layout-drawer-width) !important; }
@media (max-width: 767px) {
  .drawer-width { width: 100vw !important; }
}
```
After inversion:
```css
.drawer-width { width: 100vw !important; }
@media (min-width: 768px) {
  .drawer-width { width: var(--p-layout-drawer-width) !important; }
}
```

### Files to change (complete list from `grep '@media.*max-width'`)

| File | Current `max-width` queries | Action |
| --- | --- | --- |
| `app/layouts/default.vue:62` | 1 block — mobile padding-top FAB reserve | Invert; move mobile padding into base, wrap current base padding in `min-width: 768px`. |
| `app/assets/css/main.css:44` | iOS input 16px rule | Invert; make 16px the mobile default on input selectors, scope today's `font-size: sm` to `min-width: 768px`. |
| `app/assets/css/modules/drawer.css:6,18` | 2 blocks | Invert both `.drawer-width` and `.drawer-width-landing-page` per recipe above. |
| `app/components/AppTopNav.vue:609` | `.nav-toggle` hidden on mobile | Invert: `display: none` becomes the base, add `display: flex` (or current value) inside `min-width: 768px`. |
| `app/components/BaseAvatarEditMenu.vue:178` | Overlay centering on mobile | Invert: hoist mobile positioning to base, add desktop positioning to `min-width: 768px`. |
| `app/components/ConfirmCreate.vue:795` | Form-row column stacking | Merge mobile rules into existing base `.create-form-row` defaults; the sibling `min-width: 768px` block at 777, 829, 923 already exists. |
| `app/components/DrawerAddressInfo.vue:937` | Checkbox group flex-direction | Invert: hoist `flex-direction: row` into base, keep existing `min-width: 768px` block at line 895. |
| `app/components/DrawerContactInfo.vue:2205,2380` | Phone-card sort handle + step-progress border | Invert both; merge with neighboring `min-width: 768px` blocks where applicable. |
| `app/components/DrawerCreditCard.vue:376` | **Typo: `max-width: 768px` (overlaps with min-width: 768px at line 395)** | Fix to `max-width: 767px` semantic first, then invert. |
| `app/components/DrawerViewContactInfo.vue:197` | **Same typo: `max-width: 768px`** | Fix + invert. |
| `app/pages/Items/[id].vue:1316,1331,1336` | Postal-code-row, full-address toggle, `.item-profile__header-left` | Invert all three; merge into base rules; keep `min-width: 768px` block at 1366. |
| `app/pages/Manufacturers/[id].vue:543,569,574` | Edit-actions, width override, `.base-panel__header` wrap | Invert per recipe; merge with existing `min-width: 768px` blocks at 458, 505. |
| `app/components/DuplicateCheck.vue:884` | Form-row + phone-row stacking | Merge mobile into base `.create-form-row`/`.create-phone-row`; confirm no conflict with `create-form.css` base defaults. |
| `app/components/AppSideNav.vue:916,930` | **`max-height` — leave as-is** | Out of scope (viewport height, not width). |
| `app/components/BasePanel.vue:113` | `@media (min-width: 426px)` — non-canonical breakpoint | Reconsider: either drop the breakpoint (inline the rule) or promote to `768px`. Needs design confirmation. |

### Non-media-query `max-width` usage — **NOT in scope**

`max-width` as a *CSS property* (e.g. `max-width: 100%`, `max-width: 600px` on dialogs, `max-width: 175px` on tooltips, the `min-width: 600px` on `.duplicate-dialog`) is unrelated to mobile-first and should be left alone. The refactor only touches `@media (max-width: …)` *query expressions*. Grep must filter on `@media` specifically.

### Desktop-first default overrides (also in scope)

A few shared modules default to a desktop layout rather than mobile, which forces pages to override them back to mobile:

- **`app/assets/css/modules/info-grid.css:2-6`** — `grid-template-columns: repeat(4, 1fr)` is a desktop default. Pages using `.info-grid` re-declare `grid-template-columns: repeat(2, 1fr)` at base and `repeat(4, 1fr)` at `min-width: 768px` (see `Customers/[id].vue:978-982, 1103-1106`). Fix the module default to `repeat(1, 1fr)` (or auto-fit) at base and add `min-width: 768px { grid-template-columns: repeat(4, 1fr); }` in the module itself. Pages can then drop their duplicated declarations.
- **`app/components/BasePanel.vue:80-85`** — base `.base-panel__title` declares `white-space: normal; line-height: 1.2` (mobile-friendly) and the `min-width: 426px` block switches to `nowrap` — structure is already mobile-first, just needs breakpoint normalization (see above).

### New rule file — `.claude/rules/13-mobile-first.md`

Add a new rule file documenting the policy, loaded automatically like the others. Contents:

- Mobile-first authoring convention (mobile = base, add enhancements via `min-width`).
- Banned: `@media (max-width: …)` for width breakpoints (exception: viewport *height* queries).
- Canonical breakpoint boundaries: 768 / 1024 / 1440.
- Pattern example (before/after snippet).
- Pre-commit checklist item: `grep -n '@media.*max-width' app/` returns only height-based queries.

### Update `.claude/rules/03-css-tokens.md`

Add a short "Media queries" subsection cross-referencing `13-mobile-first.md` so a reader of the CSS rules finds the policy.

### Update `CLAUDE.md`

Add a bullet under **Critical Rules**: *"Mobile-first CSS — no `@media (max-width: …)` for width breakpoints; use `min-width` on 768 / 1024 / 1440."*

## Specific Actions

1. Create `.claude/rules/13-mobile-first.md` with the authoring policy, banned patterns, canonical breakpoints, and pattern example.
2. Add the mobile-first bullet to the "Critical Rules" list at the top of `CLAUDE.md`.
3. Add a "Media queries" subsection under "## Property-Specific Rules" (or new section) in `.claude/rules/03-css-tokens.md` pointing to rule 13.
4. Invert `app/assets/css/main.css:44-58` — make the `font-size: base` (16px) declaration the base rule; wrap the current desktop `font-size: sm` behavior in `@media (min-width: 768px)` if it's needed (may not be — verify the iOS rule isn't already the production default).
5. Invert `app/layouts/default.vue:62-70` — hoist the mobile `padding-top` and `padding: spacing-8 …` to the base `.app-layout__main` / `.app-layout__content` rules; wrap the current desktop-default `padding: spacing-4 …` in `@media (min-width: 768px)`.
6. Invert both blocks in `app/assets/css/modules/drawer.css` as shown in the example above.
7. Invert `app/components/AppTopNav.vue:609` — `.nav-toggle` base becomes `display: none`; add/merge a `@media (min-width: 768px)` block that restores `display: flex` (see existing desktop block at line 462).
8. Invert `app/components/BaseAvatarEditMenu.vue:178` — hoist mobile overlay positioning to base; any competing desktop positioning goes into `@media (min-width: 768px)`.
9. Invert `app/components/ConfirmCreate.vue:795-828` — merge the mobile form-row/phone-row column rules into the base selectors (already mobile-shaped in `create-form.css:84-124`); delete the redundant `max-width` block.
10. Invert `app/components/DuplicateCheck.vue:884` — same as step 9; verify no conflict with `create-form.css` module base.
11. Invert `app/components/DrawerAddressInfo.vue:937-946` — hoist checkbox-group mobile flex-direction to base; the sibling `min-width: 768px` block at 895 already carries desktop state.
12. Invert `app/components/DrawerContactInfo.vue:2205-2213` (phone-card sort handle / actions) — hoist mobile visibility rules to base; merge into neighboring `min-width: 768px` blocks as needed.
13. Invert `app/components/DrawerContactInfo.vue:2380-2397` (step-progress border) — hoist mobile border treatment to base; wrap desktop override in `min-width: 768px`.
14. Fix `app/components/DrawerCreditCard.vue:376` — the `max-width: 768px` overlaps with the `min-width: 768px` block at line 395 (both fire at exactly 768px). Correct to the inverted mobile-first form: hoist `padding: 0 var(--p-spacing-8)` to the base `:deep(.p-drawer-content)` rule (or equivalent); keep `padding: 0 var(--p-spacing-6)` inside the `min-width: 768px` block.
15. Fix `app/components/DrawerViewContactInfo.vue:197` — same issue and same fix pattern as step 14.
16. Invert `app/pages/Items/[id].vue:1316-1320` (`.postal-code-row`) — hoist `flex-direction: column; align-items: stretch` to the base `.postal-code-row` rule; the current `display: flex; align-items: flex-end; gap: spacing-3` defaults become the `min-width: 768px` branch.
17. Invert `app/pages/Items/[id].vue:1331-1334` (`.full-address-toggle`) — hoist `padding-bottom: 0` to base; move the current `padding-bottom: spacing-3` into `min-width: 768px`.
18. Invert `app/pages/Items/[id].vue:1336-1364` — the three selectors (`.item-profile__header-left`, its nested `.base-copy-text`/`__link`, `.info-grid`, `.info-item`) all become base rules; delete the empty `max-width` wrapper.
19. Invert `app/pages/Manufacturers/[id].vue:543-548, 569-571, 574-578` — each `max-width` block becomes part of the base selector; merge with the existing `min-width: 768px` blocks at 458 and 505.
20. Update `app/assets/css/modules/info-grid.css:2-6` — change base `grid-template-columns` from `repeat(4, 1fr)` to `repeat(1, 1fr)` (or `minmax` auto-fit per design review); add a module-level `@media (min-width: 768px) { .info-grid { grid-template-columns: repeat(4, 1fr); } }` block.
21. Remove the now-duplicated `.info-grid` column declarations from `app/pages/Customers/[id].vue:978-982, 1103-1106` and `app/pages/Items/[id].vue:1355-1359` (verify each file only declares grid columns if it genuinely differs from the new module default; otherwise delete).
22. Normalize the non-canonical `@media (min-width: 426px)` in `app/components/BasePanel.vue:113-122` — either drop the breakpoint and inline the declarations (if always safe) or promote to `768px`. Flag for design confirmation in review.
23. Leave `app/components/AppSideNav.vue:916, 930` untouched (viewport-height queries, not width).
24. Run `grep -rn '@media.*max-width' app/` and confirm the only remaining hits are the two `max-height` queries in `AppSideNav.vue`.
25. Run `npm run build` to verify no CSS breakage; smoke-test the dev server (`npm run dev`) at viewport widths 375px, 768px, 1024px, 1440px on each page touched (`/`, `/customers`, `/customers/[id]`, `/customers/create`, `/items`, `/items/[id]`, `/suppliers`, `/suppliers/[id]`, `/manufacturers/[id]`) plus each drawer.

## Possible Blockers

- **Semantic equivalence at inversion** — `@media (max-width: 767px)` matches `<= 767.99…px`; `@media (min-width: 768px)` matches `>= 768px`. There is no gap if we use `767` and `768` as the boundary pair, but one of the current files (`DrawerCreditCard.vue:376`, `DrawerViewContactInfo.vue:197`) uses `max-width: 768px` which overlaps with `min-width: 768px` at exactly 768px. The fix in steps 14–15 eliminates the overlap, but we need to confirm the current visual behavior at 768px was incidental, not intentional.
- **`info-grid` default change risks visual regression** — today the module defaults to 4 columns and every page overrides back to 2 on mobile. If any page used the default 4-col at mobile intentionally (none found in grep, but worth a design review), switching the default could regress it.
- **`BasePanel.vue`'s `426px` breakpoint** — unclear whether this was intentional for very-narrow phones (e.g. iPhone SE in landscape) or a legacy value. Needs design confirmation before collapsing.
- **Breakpoint tokens in `@media` queries** — CSS doesn't natively allow `@media (min-width: var(--p-breakpoint-tablet))`. The literal `768px` etc. must be repeated. A follow-up task could introduce PostCSS `@custom-media` (`postcss-custom-media` plugin) so breakpoint values live in one place. Out of scope here; flag for a separate plan.
- **iOS input 16px rule in `main.css`** — inverting step 4 assumes the 16px baseline is safe as the default everywhere. Verify that no existing desktop design expects the `sm` input font-size to beat 16px — if it does, the `min-width: 768px` override in step 4 is required, not optional.
- **Scoped-style nesting in Vue SFC** — Vue `<style scoped>` with CSS nesting (e.g. `app/pages/Items/[id].vue:1282` uses `@media (min-width: 1024px)` nested inside a rule) must keep the nesting structure during inversion or the specificity may shift; prefer hoisting the nested `max-width` blocks out to top-level rather than re-nesting a `min-width` block inside.
- **Pre-commit CSS checklist (rule 03)** — after the refactor, add an entry: *"no `@media (max-width: …)` for width breakpoints"* — to the checklist at the bottom of `03-css-tokens.md` so reviewers catch regressions.
- **Testing without a test runner** — `12-testing.md` notes Vitest exists but test artifacts are deleted after each session; there is no CSS regression harness. Manual browser verification at the four breakpoint widths is the only safety net.
