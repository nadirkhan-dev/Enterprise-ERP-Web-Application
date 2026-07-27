# Naming Conventions

## Function Prefixes — Exported Functions

### Common
| Prefix | Purpose |
|---|---|
| `build*` | Constructs configuration objects (pure functions) |
| `create*` | Constructs new objects, streams |
| `fetch*` | Retrieves data via network requests (HTTP/I/O) |
| `get*` | Retrieves local, cached, or computed data (no network I/O) |
| `handle*` | Orchestrates workflows, events, flows |
| `validate*` | Performs validation with error throwing |

### Available when needed
| Prefix | Purpose |
|---|---|
| `apply*` | Mutates config/pipeline with overrides |
| `generate*` | Creates filenames, handles, derived values |
| `init*` | Creates instances with internal state |
| `map*` | Reshapes one structure into another |

Vue/Nuxt framework callbacks and lifecycle names are exempt.

## Variable Naming
- Descriptive, unabbreviated names
- Booleans: `isVerb` pattern (e.g., `isLoading`, `isVisible`, `hasPermission`)
- `const` for config objects, `let` for reassigned variables

## Prohibited Names

| Banned | Use Instead |
|---|---|
| `data` | Descriptive name: `userData`, `invoiceList`, `responsePayload` |
| `result` | Descriptive name: `validationOutcome`, `searchMatches` |
| `item` | Domain name: `product`, `contact`, `invoice` |
| `val`, `tmp` | Full descriptive name |
| `opts`, `cfg` | `options`, `config` |
| Single-letter vars | Full name (loop counters `i`/`j` in simple loops are acceptable) |

**Exception:** `tryCatch` returns `{ data, error }` — this is an allowed pattern for the utility's destructured return value.

## Unused Parameters
Remove unused parameters entirely — never use `_` prefix to silence linting warnings.
