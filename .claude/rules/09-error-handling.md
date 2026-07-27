# Error Handling

## Use `tryCatch` Utility for Operation Results

Use `tryCatch` (`app/utils/tryCatch.js`) when you want normalized `{ data, error }` handling for sync/async operations.

### Pattern
```javascript
// Async operation
const { data, error } = await tryCatch(fetchUserData(userId))
if (error) {
  console.error('Failed to fetch user:', error.message)
  return
}

// Sync operation
const { data: config, error: configError } = tryCatch(() => buildConfig(options))
if (configError) {
  console.error('Config build failed:', configError.message)
  return
}
```

### Rules
- Returns `{ data, error }` destructured pattern
- Prefer `tryCatch` for request/transform operations in stores, composables, and utils
- Traditional `try/catch` or `try/finally` is allowed when required for control flow, cleanup, state resets, or rethrowing
- Always check `error` before using `data`

## Optional Parameter Defaults
- Always explicit: `= null` for "not provided", `= {}` for options objects
- No implicit `undefined` for optional parameters

### Example
```javascript
/**
 * @param {string} userId
 * @param {Object} options
 * @param {boolean} [options.includeInactive=false]
 * @param {number} [options.limit=null]
 */
function fetchContacts(userId, options = {}) {
  const { includeInactive = false, limit = null } = options
  // ...
}
```
