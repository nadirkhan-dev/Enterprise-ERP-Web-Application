# Testing

## Framework
- **Vitest** + `@vue/test-utils` + `happy-dom`
- Config: `vitest.config.js`
- Run: `npm test` (single run), `npm run test:watch` (watch mode)

## File Structure
- All tests in `tests/` directory, mirroring source structure
  - `tests/stores/auth.test.js` → `app/stores/auth.js`
  - `tests/composables/useDirectus.test.js` → `app/composables/useDirectus.js`
- File naming: `*.test.js` only

## Scenario-Based Testing
Each `describe` block represents a **feature/scenario**, not a unit:

```javascript
describe('Scenario: Successful Login', () => {
  it('authenticates the user with valid credentials', ...)
  it('redirects to the items page after login', ...)
  it('persists the session when remember me is checked', ...)
})
```

Each `it()` describes a **user-facing behavior** within that scenario.

## Rules
- **Mock external dependencies** — Directus SDK calls, `navigateTo`, `useRuntimeConfig`
- **Never hit real APIs** in tests
- **No snapshot tests** — test behavior, not markup
- **Auto-imports available** — `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach` (via `globals: true`)
- **No manual imports** for Vitest globals
- **Pinia** — use `createPinia()` + `setActivePinia()` in `beforeEach` for store tests

## Cleanup After Testing
- **Always delete test files and `vitest.config.js` once testing is complete** — test artifacts are temporary and should not persist in the repo
- Recreate `vitest.config.js` and `tests/` when needed for the next testing session

## Mocking Patterns

### Directus SDK
```javascript
vi.mock('~/composables/useDirectus', () => ({
  useDirectus: vi.fn(),
  setAuthPersistence: vi.fn(),
}))
```

### Nuxt Auto-Imports
```javascript
// Mock navigateTo, useRuntimeConfig, etc. as globals
globalThis.navigateTo = vi.fn()
globalThis.useRuntimeConfig = vi.fn(() => ({
  public: { directusUrl: 'https://test.directus.app', passwordResetUrl: '' },
}))
```
