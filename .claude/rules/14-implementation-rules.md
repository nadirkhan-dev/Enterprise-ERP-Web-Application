# Implementation Rules — Consistency First

You are working in an existing production codebase. The primary objective is
**maintaining consistency with the existing codebase**, not introducing new
patterns. These rules govern every change and take precedence over personal
preference or novelty.

## Core Principles

### 1. Follow Existing Architecture
- Before making any changes, analyze the surrounding code.
- Reuse existing components, composables, stores, services, utilities, patterns, and abstractions.
- Do not introduce a new pattern if an equivalent already exists.

### 2. UI Consistency
Every UI change must match the existing design system. Follow existing:
spacing, margin, padding, gap, typography, font sizes, font weights, line
heights, colors, border radius, borders, shadows, transitions, animations, icon
sizes, button styles, input styles, loading states, and hover/focus/disabled
states. Never invent new values if existing ones already exist. (See
`03-css-tokens.md`, `02-primevue-usage.md`.)

### 3. Design Tokens
Use existing theme tokens / CSS variables (`var(--p-*)`) / design tokens /
constants. Never hardcode values unless the project already does so. (See
`03-css-tokens.md`.)

### 4. Reuse Before Creating
Before creating a component, composable, helper, utility, style, API client, or
validation logic — search for an existing implementation. If one exists, reuse
or extend it. (See `11-ui-first-workflow.md` for the extraction criteria: extract
only when a pattern appears 2+ times; never thin single-component wrappers.)

### 5. Global Consistency
If a change affects a shared component or pattern:
- Identify every location where it is used.
- Explain the impact.
- Apply the change consistently across all affected screens unless instructed otherwise.
- Never leave the UI inconsistent.

### 6. Minimal Changes
Change only what is necessary. Avoid unnecessary refactoring, renaming,
formatting unrelated files, moving code, and changing architecture.

### 7. Code Style
Match the existing project: naming conventions, folder structure, import order,
file organization, component composition, error handling, state management, and
testing patterns. (See `01-coding-standards.md`, `08-naming-conventions.md`,
`09-error-handling.md`, `12-testing.md`.)

### 8. Responsive Design
Preserve the existing responsive behavior. Follow current breakpoints and layout
rules. (See `13-mobile-first.md`.)

### 9. Accessibility
Preserve keyboard navigation, ARIA attributes, focus states, and semantic HTML.

### 10. Before Writing Code
First determine:
- Which existing pattern matches this request?
- Which files should be updated?
- Which shared components are involved?
- Whether similar functionality already exists.

If something similar exists, use it instead of creating a new implementation.

### 11. Implementation Plan
Before making changes, provide:
- Files to modify
- Existing components to reuse
- Existing patterns being followed
- Risks
- Any shared components affected

Wait for approval before implementing.

### 12. Definition of Done
The implementation is complete only if:
- No duplicate logic is introduced.
- No duplicate UI is created.
- Existing styling conventions are preserved.
- Existing architecture is respected.
- Shared components remain consistent.
- All affected locations have been updated.
- The code appears as though it was originally written by the project authors.

### 13. If Unsure
If multiple approaches are possible:
- Choose the one that best matches the existing codebase.
- Do not invent a new pattern.
- Explain why the selected approach is the closest match.
