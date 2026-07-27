# Mobile-First CSS

## Policy
Styles are authored for the smallest viewport first. The base rule (no media query) defines the **mobile** layout. Wider viewports layer on enhancements via `@media (min-width: …)` queries only.

## Banned
`@media (max-width: …)` for **width** breakpoints. Desktop-first inverted queries fight the mental model and cause overlap bugs at the boundary (e.g. `max-width: 768px` + `min-width: 768px` both fire at exactly 768px).

## Exceptions (allowed)
- Viewport-**height** queries: `@media (max-height: …)` / `@media (min-height: …)` — these target height, not width, and are orthogonal to mobile-first.

## Canonical Breakpoints

| Tier | Range | Media form |
|---|---|---|
| Mobile (base) | 0–767px | *no query — base rule* |
| Tablet | 768–1023px | `@media (min-width: 768px)` |
| Laptop | 1024–1439px | `@media (min-width: 1024px)` |
| Desktop | ≥1440px | `@media (min-width: 1440px)` |

Values mirror `app/presets/extend.js` (`breakpoint` tokens) and `app/utils/breakpoints.ts`. Do not introduce other boundaries (no `425px`, `600px`, `1200px`, etc.) without a rule update.

## Authoring Pattern

```css
/* BAD — desktop-first, mobile declared via override */
.drawer-width {
    width: var(--p-layout-drawer-width) !important;
}
@media (max-width: 767px) {
    .drawer-width {
        width: 100vw !important;
    }
}

/* GOOD — mobile as base, desktop as enhancement, nested inside the class */
.drawer-width {
    width: 100vw !important;

    @media (min-width: 768px) {
        width: var(--p-layout-drawer-width) !important;
    }
}
```

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

Shared width breakpoints that previously covered multiple unrelated selectors must be **duplicated inside each selector's block** rather than kept as a grouped top-level rule. Locality beats repetition.

Pseudo-elements and state modifiers nest via the `&` selector:

```css
:deep(.step-body--has-line) {
    position: relative;

    &::before {
        content: '';
        position: absolute;
        /* … */
    }

    @media (min-width: 768px) {
        border-left: none;
    }
}
```

Exception: `@media (max-height: …)` / `@media (min-height: …)` viewport-height queries follow the same nested pattern as width queries; they are not exempt from nesting even though they are exempt from the mobile-first width policy.

## Conversion Recipe (when inverting an existing block)

For `@media (max-width: 767px) { .X { prop: MOBILE } }`:

1. Move MOBILE declarations into the base `.X` rule (replace the current base value).
2. Nest a `@media (min-width: 768px) { … }` block inside the `.X` rule with the displaced base declarations.
3. Delete the empty `max-width` wrapper.

For a top-level `@media (min-width: 768px) { .X { prop: DESKTOP } }`:

1. Move the `DESKTOP` declarations into a nested `@media (min-width: 768px) { … }` block inside the base `.X` rule.
2. Delete the top-level `@media` wrapper.

## Pre-Commit Check

```bash
grep -rnE "@media[^{]*max-width[^{]*\)" app/
grep -rnE "^@media" app/
```
Both expected: **zero hits**. The first ensures no `max-width` width breakpoints. The second ensures no top-level `@media` rules — every `@media` must be indented (nested inside a class block).

## Related Rules
- `03-css-tokens.md` — token usage (no raw `px`, use `var(--p-spacing-*)` etc.)
- `11-ui-first-workflow.md` — UI-first development phases
