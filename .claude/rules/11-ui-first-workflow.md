# UI-First Development Workflow

## Development Phases

### Phase 1: UI Build
- Build pages from Figma designs using hardcoded/mock data in `ref()`
- Focus on layout, styling, and interactions
- Use PrimeVue components + design tokens exclusively
- Mock data should match expected Directus field shapes

### Phase 2: Pattern Extraction
- Before moving to the next page, review for repeated patterns
- Extract reusable components and composables when a pattern appears **2+ times** across pages
- Keep components data-agnostic — receive data via props, never contain mock data

### Phase 3: Functionality Wiring
- Replace hardcoded data with Directus integration via `useDirectus()` composable and Pinia stores
- Wire up in a separate pass/commit from the UI build

## Component Extraction Rules

### Component Tiers
- `Base*` — composes multiple PrimeVue primitives (BasePanel, BaseBackButton)
- **Domain components** — page-specific composites (ProfileCard, StatusTag, InfoGrid)
- **Composables** — shared reactive logic (`useDataTableScroll`, `useCollapsibleState`)

### Extraction Criteria
- Extract when a UI pattern appears **2+ times** — whether across pages or within a single page
- Never extract thin single-component wrappers — use PrimeVue directly
- Mock data lives in page `<script setup>`, never inside reusable components
- Don't extract unique, single-use sections into components just to shorten a file — only extract to eliminate duplication

## When Building a New Page
1. Check Figma design for UI elements
2. Check existing components in `app/components/` — reuse before creating new
3. Build with hardcoded data matching expected Directus field shapes
4. Identify new repeatable patterns → extract immediately
5. Functionality wiring comes in a separate pass/commit
