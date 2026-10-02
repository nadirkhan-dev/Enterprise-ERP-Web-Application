# Code Review

Review the specified file(s) against Liberty Connect coding standards. Check all rules in `.claude/rules/`.

## Review Checklist

1. **Coding Standards** (01): `<script setup>`, JS only, async/await, proper file organization, auto-imports
2. **PrimeVue Usage** (02): No raw HTML elements, no thin wrappers, correct component APIs
3. **CSS & Tokens** (03): No raw values, design tokens used, no inline styles, BEM naming, scoped styles
4. **Naming** (08): Function prefixes match purpose, no prohibited names, boolean `is*` pattern
5. **Error Handling** (09): `tryCatch` for operations, explicit optional defaults
6. **Security** (07): No secrets, no `v-html` with user content, auth via SDK only
7. **DRY**: No duplicated code across files, shared patterns extracted

## Output Format

### Violations
List each violation with file, line, rule broken, and fix.

### Suggestions
Optional improvements that don't violate rules but could enhance code quality.

### Summary
Overall assessment: pass, pass with notes, or needs changes.
