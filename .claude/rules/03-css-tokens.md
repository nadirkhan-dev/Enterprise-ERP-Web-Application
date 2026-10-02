# CSS & Design Tokens

## Zero Raw Values Policy
Every CSS value must use a design token. No exceptions for colors, spacing, font sizes, font weights, border-radius, shadows, or transitions.

```css
/* BAD */  gap: 7px;
/* GOOD */ gap: var(--p-spacing-2);

/* BAD */  color: white;
/* GOOD */ color: var(--p-surface-0);

/* BAD */  font-size: 12px;
/* GOOD */ font-size: var(--p-font-size-xs);
```

**If no token exists** for a needed value → add it to `app/presets/extend.js` first, then use it.

**Allowed raw values:** `0`, `none`, `auto`, `inherit`, `currentColor`, `1px` (borders), `50%`/`100%` (percentages), PrimeVue `Column` `style` prop widths.

## Token Hierarchy
```
primitive.js  → Raw color palettes (deepblue, skyblue, vividgreen, red, gray, tideblue, tidegreen, mildgreen, yellow, lavender, orange, neutral, alpha, shadow)
semantic.js   → Intent tokens referencing primitives (primary, surface, form fields)
extend.js     → Custom tokens (font sizes, spacing, shadows, opacity, transitions)
components.js → Component-level token overrides (border radius, specific component tweaks)
index.js      → Combines all via definePreset(Aura, { ... })
```

All tokens become CSS variables prefixed with `--p-`:
- Colors: `var(--p-deepblue-900)`, `var(--p-primary-500)`
- Spacing: `var(--p-spacing-4)` = 16px
- Font: `var(--p-font-size-sm)` = 14px, `var(--p-font-weight-medium)` = 400
- Shadows: `var(--p-shadow-sm)`

## Property-Specific Rules

| Property | Must Use | Never Use |
|---|---|---|
| Colors | `var(--p-deepblue-900)`, `var(--p-surface-0)`, `var(--p-primary-500)` | `white`, hex values, named colors |
| Spacing (gap, padding, margin) | `var(--p-spacing-*)` | Raw `px` values |
| Font size | `var(--p-font-size-*)` | Raw `12px`, `14px`, etc. |
| Font weight | `var(--p-font-weight-*)` | Raw `300`, `500`, etc. |
| Border radius | `var(--p-border-radius-*)` | Raw `4px`, `8px`, etc. |
| Shadows | `var(--p-shadow-*)` or token-based opacity | Hardcoded opacity values |

## DRY CSS Extraction Rules

**Where styles live — decision tree:**

1. **`app/presets/components.js`** — PrimeVue component tokens (border-radius, padding, colors exposed by PrimeVue's token system). Applies globally.
2. **`app/assets/css/main.css`** — Shared overrides and utility classes that appear in **2+ files**. Examples: DataTable styling, status tags, info grid, form fields.
3. **`<style scoped>`** — Single-use page/component styles. Always scoped. `:deep()` for PrimeVue internals only used in that one file.

**Extraction trigger:** When any CSS pattern appears in 2+ files → extract to `main.css` immediately.

## PrimeVue Override Hierarchy

Strict priority order:

1. **Component tokens** (`components.js`) — For properties exposed in PrimeVue's design token system
2. **`pt` (passthrough) prop** — For one-off structural/class overrides on a specific instance
3. **`:deep()` scoped styles** — For PrimeVue internal elements not exposed via tokens or `pt`
4. **`:deep()` in `main.css`** — For shared PrimeVue overrides used across 2+ files

## Media Queries (Mobile-First)
All width breakpoints use `@media (min-width: …)` exclusively. Mobile styles live in the base rule; wider viewports layer enhancements on top. See `13-mobile-first.md` for the full policy, canonical breakpoint values (768 / 1024 / 1440), and the conversion recipe.

## No Inline Styles
Avoid `style="..."` or `:style` bindings. Allowed exceptions:
- PrimeVue `Column` `style` prop for DataTable column widths
- Dynamic CSS custom properties that cannot be expressed in scoped CSS

## Class Naming
- BEM-like: `.component-name__element--modifier` or `.is-state`
- Scoped styles always
- `:deep()` for PrimeVue internal overrides
- Remove unused classes — no dead CSS

## Pre-Commit CSS Checklist
- [ ] No raw `px`, hex, or named color values (use tokens)
- [ ] No inline styles (except Column widths)
- [ ] No duplicated `:deep()` patterns (check if `main.css` already has it)
- [ ] `:deep()` only used for PrimeVue internals, not custom classes
- [ ] All classes follow BEM naming
- [ ] No unused CSS classes
- [ ] No `@media (max-width: …)` for width breakpoints (see `13-mobile-first.md`)
