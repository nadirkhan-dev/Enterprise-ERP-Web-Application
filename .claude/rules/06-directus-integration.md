# Directus Integration

## SDK Usage
- Use `@directus/sdk` for all Directus communication
- Access via `useDirectus()` composable (see `app/composables/`)
- Auth flow patterns are established in `auth.js` store

## Configuration
- Directus URL must come from env-backed `runtimeConfig` in `nuxt.config.js` (`process.env.DIRECTUS_URL`) — never hardcode host values in code
- Auth tokens managed by Directus SDK — never store manually
- Environment variables: `DIRECTUS_URL`, `DIRECTUS_TOKEN` in `.env`

## Data Fetching Patterns
- **Shared state**: Use Pinia stores — fetch in store actions, expose via getters
- **Page-specific data**: Use local `ref()` with `onMounted` or `useFetch`
- Always handle loading and error states
- Use `tryCatch` utility for error handling (see `09-error-handling.md`)

## Schema Exploration
Use the Directus MCP server (`read-collections`, `read-fields`, `read-items`) to explore the backend schema before building pages. This ensures correct field names, types, and relationships.
