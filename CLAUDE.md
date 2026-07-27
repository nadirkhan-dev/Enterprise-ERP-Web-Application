# CLAUDE.md — Liberty Connect

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start (Read This First)

**Critical Rules (Always Follow):**

- **No git operations** — all git is handled manually by the user. Never run git commands of any kind.
- **100% PrimeVue** — never use raw HTML interactive elements (`<button>`, `<input>`, `<select>`, etc.)
- **Zero raw CSS values** — every value must use a design token (`var(--p-*)`)
- **Mobile-first CSS** — no `@media (max-width: …)` for width breakpoints; use `min-width` on 768 / 1024 / 1440 (see `.claude/rules/13-mobile-first.md`)
- **No inline styles** — all styling in `<style scoped>`, except PrimeVue `Column` widths
- **No thin wrappers** — use PrimeVue components directly; only create `Base*` for multi-primitive composites
- **UI-first workflow** — build with mock data first, extract patterns, wire Directus later
- **Use `tryCatch` utility** for error handling (`app/utils/tryCatch.js`)
- **Check MCP servers** before guessing component APIs (PrimeVue, Nuxt, Directus, Figma)

**Commands:**

```bash
npm run dev        # Start dev server at http://localhost:3000
npm run build      # Build for production
npm run preview    # Preview production build
npm run generate   # Generate static site
```

There is no test runner configured. ESLint and Prettier are installed (`.eslintrc.json` extends `@johndugan` config).

---

## Documentation Structure

This documentation is split across multiple files for maintainability:

| File | Content |
| --- | --- |
| `CLAUDE.md` | Quick start, architecture overview, key file locations (this file) |
| `.claude/rules/01-coding-standards.md` | Language, syntax, file organization, reactivity, auto-imports |
| `.claude/rules/02-primevue-usage.md` | Component mapping, DataTable patterns, status tags |
| `.claude/rules/03-css-tokens.md` | Zero raw values policy, token hierarchy, DRY extraction, override priority |
| `.claude/rules/04-mcp-servers.md` | PrimeVue, Nuxt, Directus, Figma MCP server usage |
| `.claude/rules/05-git-workflow.md` | Git policy (user-managed, no Claude git operations) |
| `.claude/rules/06-directus-integration.md` | SDK usage, data fetching patterns, schema exploration |
| `.claude/rules/07-security.md` | Secrets, XSS prevention, authentication |
| `.claude/rules/08-naming-conventions.md` | Function prefixes, variable naming, prohibited names |
| `.claude/rules/09-error-handling.md` | `tryCatch` utility patterns, optional parameter defaults |
| `.claude/rules/10-domain-guides.md` | HVAC/manufacturing context, abbreviations, part numbers |
| `.claude/rules/11-ui-first-workflow.md` | Development phases, component extraction rules |
| `.claude/rules/13-mobile-first.md` | Mobile-first media queries, canonical breakpoints, conversion recipe |
| `.claude/rules/14-implementation-rules.md` | Consistency-first meta-policy: reuse before creating, minimal changes, plan-before-implement, definition of done |

All files in `.claude/rules/` are automatically loaded by Claude Code.

**Slash commands** (`.claude/commands/`): `bug-hunt`, `security-audit`, `code-review`, `best-practices`, `figma-implement`, `new-page`

---

## Architecture

This is a **Nuxt 4 / Vue 3 frontend application** (`fe-connect-app`) — an ERP frontend for HVAC and manufacturing businesses (customer/contact management, inventory, estimates). The backend is **Directus** (headless CMS) accessed via `@directus/sdk`. The Directus instance URL is configured via `runtimeConfig` in `nuxt.config.js`.

### Key Modules

Configured in `nuxt.config.js`:

- **PrimeVue 4** (`@primevue/nuxt-module`) — UI component library with auto-imports
- **Pinia** (`@pinia/nuxt`) — state management
- **PrimeIcons** — icon set (used as `pi pi-*` classes)

### Layout System

`app/app.vue` wraps `NuxtLayout > NuxtPage`. The **default layout** (`app/layouts/default.vue`) renders:

- `AppSideNav` — fixed left sidebar (collapsible: 224px ↔ 64px) with navy background
- `AppTopNav` — top bar with search and user avatar
- `<main>` content area with `margin-left` matching sidebar width

Pages opt out of the default layout with `definePageMeta({ layout: false })` (e.g., the Login page).

### Component Patterns

**Base wrappers** (`app/components/Base*.vue`) — composite patterns only:

- `BasePanel` — combines `Panel` + `Button` (toggle) + `Divider` + slots into a collapsible card
- `BaseBackButton` — combines `NuxtLink` with a back-arrow icon and project-standard styling

**Domain components:**

- `ProfileCard` — avatar overlap + header slots + tab navigation. Props: `tabs`. Slots: `#avatar`, `#header-left`, `#header-right`, `#identity`.
- `RelatedItemsPanel` — `BasePanel` + `DataTable` with scroll navigation. Props: `title`, `items`.

### Theme System (PrimeVue Preset)

Built on **Aura** base preset, customized in `app/presets/`:

| File | Purpose |
| --- | --- |
| `primitive.js` | Raw color palettes: `deepblue`, `skyblue`, `vividgreen`, `red`, `gray`, `tideblue`, `tidegreen`, `mildgreen`, `yellow`, `lavender`, `orange`, `neutral`, `alpha`, `shadow` |
| `semantic.js` | Intent-based tokens referencing primitives |
| `extend.js` | Custom tokens: font, spacing, shadow, opacity, transition |
| `components.js` | Component-level token overrides |
| `index.js` | Combines all layers via `definePreset(Aura, { ... })` |

All tokens become CSS variables prefixed with `--p-` (e.g. `var(--p-spacing-4)` = 16px, `var(--p-font-size-sm)` = 14px).

**Brand colors:** Deepblue `#1c3c70` (identity, shade 900), Skyblue `#009bd4` (primary CTA, shade 600), Vividgreen `#00aa00` (success, shade 500), Red `#ff2b12` (danger, shade 500).

**Font:** TT Norms Pro (self-hosted). Weights: thin=100, normal=300, medium=400, bold=500, black=900. Dark mode disabled.

---

## Key File Locations

| Purpose | Location |
| --- | --- |
| Nuxt config + route mappings | `nuxt.config.js` |
| Theme presets | `app/presets/` (`primitive.js`, `semantic.js`, `extend.js`, `components.js`, `index.js`) |
| Shared CSS (global utilities) | `app/assets/css/main.css` |
| Sidebar navigation config | `app/components/AppSideNav.vue` (`NAV_ITEMS`) |
| Pinia stores | `app/stores/` (`navigation.js`, `auth.js`) |
| Composables | `app/composables/` (`useDirectus.js`, `useTableScroll.js`) |
| Utilities | `app/utils/tryCatch.js` |
| Pages (flat, PascalCase) | `app/pages/` (`Items.vue`, `Item.vue`, `Login.vue`) |
| MCP server config | `.mcp.json` (uses `${DIRECTUS_URL}`, `${DIRECTUS_TOKEN}` env vars) |
| Environment template | `.env.example` |

### Shared CSS Classes (`main.css`)

| Class | Purpose |
| --- | --- |
| `.form-field`, `.form-field__label`, `.form-field__required`, `.form-field__error` | Form field layout |
| `.checkbox-field`, `.checkbox-field__label` | Checkbox/radio + label |
| `.info-grid`, `.info-item`, `.info-label`, `.info-value` | Label/value pair grids |
| `.status-active`, `.status-inactive` | Status tag styling |
| `.scroll-nav` | DataTable scroll navigation buttons |

DataTable structural overrides (header, body, frozen column shadow, paginator) are also in `main.css`.

---

**Document Version:** 2.0
**Last Updated:** February 26, 2026
**Status:** Active — reflects current codebase architecture
