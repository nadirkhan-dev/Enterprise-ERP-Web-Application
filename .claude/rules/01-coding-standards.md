# Coding Standards

## Language & Syntax
- JavaScript only (no TypeScript), ES modules throughout
- `<script setup>` for all Vue components — no Options API
- Prefer `async/await` in application code (pages, components, stores, composables)
- Avoid `.then()` chains in application code; utility internals may use promise chaining when returning normalized helper shapes
- Use `Promise.all()` for concurrent independent operations

## File Organization
- **Pages**: flat in `app/pages/` (PascalCase filenames), routes controlled via `nuxt.config.js` `pages:extend` hook — never create subdirectories
- **Components**: `App*` for singletons (AppSideNav, AppTopNav), `Base*` for composites only (BasePanel, BaseBackButton), descriptive PascalCase otherwise
- **Composables**: `use*.js` in `app/composables/`
- **Stores**: `app/stores/*.js`, `defineStore` with options syntax
- **Utils**: `app/utils/*.js` — auto-imported by Nuxt

## Auto-Imports
PrimeVue components, Nuxt composables (`useRoute`, `navigateTo`, `definePageMeta`, etc.), Vue reactivity (`ref`, `computed`, `watch`, `onMounted`, etc.), and Pinia stores are all auto-imported. Never add manual imports for these.

## Reactivity
- Use `ref()` for primitives and simple values
- Use `reactive()` for objects/arrays where you need deep reactivity without `.value`
- Never destructure reactive objects — it breaks reactivity
- Never mutate props directly — emit events or use a local copy

## Variables & Constants
- `const` for config objects and values that won't be reassigned
- `let` for variables that will be reassigned
- Never use `var`
