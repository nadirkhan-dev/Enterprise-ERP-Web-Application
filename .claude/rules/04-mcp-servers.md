# MCP Server Usage

## PrimeVue MCP
Use for component API lookups before guessing:
- `get_component` — full component documentation
- `get_component_props` — available props and types
- `get_component_slots` — template slots
- `get_component_events` — emitted events
- `suggest_component` — find the right component for a use case
- `get_usage_example` — code examples
- `get_component_pt` — passthrough options

## Nuxt MCP
Use for framework questions:
- Routing, `definePageMeta`, middleware
- Composables (`useRoute`, `useRuntimeConfig`, `useFetch`)
- SSR/SSG behavior, `pages:extend` hook
- Module configuration

## Figma MCP
Design file key: `15QMM9zN5nQWYjLSLGAGKN`
- `get_screenshot` — capture current design state
- `get_design_context` — extract design details with code hints
- `get_metadata` — file structure and pages
- Always adapt Figma output to project's token system and existing components

## Directus MCP
Use for backend schema exploration:
- `read-collections` — list all collections
- `read-fields` / `read-field` — inspect collection schemas
- `read-items` — query data for development/testing
- `read-flows` — inspect automation flows
- Never hardcode Directus URLs or tokens — use `runtimeConfig`
