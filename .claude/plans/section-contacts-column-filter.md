---
name: SectionContacts column filter
description: Plan to add a popover-driven, column-based filter as a second filtering layer in SectionContacts (in addition to the existing text search)
type: project
---

# Plan: SectionContacts Column-Based Filter (Popover)

**Created:** 2026-04-28
**Status:** Draft — Pending Review
**Task:** Add a second filter layer to `SectionContacts.vue` that filters contacts by a chosen DataTable column and one of that column's distinct values, presented through a popover anchored to a new filter button.

---

## High Level Plan

Today, `SectionContacts.vue` exposes a single text search (`filterText`) wired through `loadContacts()` (server-side via `fetchPartnerContacts`) and `clientFilteredContacts` (client-side when `initialContacts` is provided). This plan layers a **column filter** *on top of* search: the user picks a column from a "Filter By" dropdown, then picks a value, and the table is narrowed further. The two layers are independent and combine via AND.

The trigger is a new icon-only filter button (`pi pi-filter`) placed next to the existing search controls in `BasePanel`'s `#actions` slot. Clicking it opens a PrimeVue **`Popover`** anchored to the button (Figma node `3598:47197` shows a small floating panel — explicitly not a centered Dialog or side Drawer). The popover hosts a **`Select`** for the column (placeholder "Filter By"), and conditionally renders a second control below once a column is chosen: a **`Select`** (single-value) for text-like columns, or a **`MultiSelect`** with a custom `option` slot rendering checkbox + status `Tag` for the `status` column (Figma node `3721:37796`). Per the Figma spec, there is no Apply/Cancel button — selection commits live, click-outside dismisses (PrimeVue `Popover.dismissable` default).

The "Filter By" options are **dynamic** — derived from a single column-metadata array (`{ field, header }[]`) that is *also* used to render the table columns in the template. This guarantees the filter dropdown matches what the table actually shows (no drift). The second dropdown's options are computed from distinct values present in the **currently loaded** dataset for the selected column (`Set`-based de-dup, empty values stripped). For `notes`, distinct values are normalized to `Yes` / `No` since that column renders a boolean tag, not raw text. For `status`, the values are `active` / `inactive`, displayed via existing `.status-active` / `.status-inactive` Tag classes from `main.css`.

Filter application is **client-side only** for the column layer (the search layer keeps its existing server-side wiring untouched). This is intentional: distinct values can only be enumerated from data that is already in the browser, and contacts-per-partner are typically small lists. Server-side column filtering would require schema-aware Directus filter construction across heterogeneous fields and a separate "distinct values" query — out of scope for this UI feature. Implications are flagged in **Possible Blockers**.

## Low Level Description

**File touched:** `app/components/SectionContacts.vue` only (single-file change). No new components, composables, or shared CSS — this is a localized enhancement, and per `11-ui-first-workflow.md` extraction is not warranted until a 2nd consumer appears.

### State additions (`<script setup>`)

```ts
const filterPopoverRef = ref<any>(null)
const selectedFilterColumn = ref<string | null>(null)   // e.g. 'status', 'name'
const selectedFilterValues = ref<string[]>([])           // array for both modes; single-select pushes/replaces single entry

// Single source of truth for columns shown in the DataTable AND in the "Filter By" dropdown.
const FILTER_COLUMNS = [
  { field: 'name', header: 'Name' },
  { field: 'jobTitle', header: 'Job Title' },
  { field: 'email', header: 'Email Address' },
  { field: 'phone', header: 'Phone Number' },
  { field: 'notes', header: 'Notes' },
  { field: 'status', header: 'Status' },
]
```

### Distinct-value computation

```ts
const filterValueOptions = computed<{ label: string; value: string }[]>(() => {
  const column = selectedFilterColumn.value
  if (!column) return []

  // Source set: prefer the post-search dataset, so options reflect what the user can currently see.
  const source = isClientSide.value ? clientFilteredContacts.value : contacts.value

  if (column === 'notes') {
    const hasAny = source.some((c) => !!c.notes)
    const hasNone = source.some((c) => !c.notes)
    return [
      hasAny ? { label: 'Yes', value: 'yes' } : null,
      hasNone ? { label: 'No', value: 'no' } : null,
    ].filter(Boolean)
  }

  const distinct = new Set<string>()
  source.forEach((c) => {
    const raw = c[column]
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      distinct.add(String(raw))
    }
  })

  if (column === 'status') {
    return [...distinct].map((value) => ({ label: formatStatus(value), value }))
  }
  return [...distinct].map((value) => ({ label: value, value }))
})
```

### Filter combine logic

`displayedContacts` already accounts for search. Wrap it with a column-filter pass:

```ts
const columnFilteredContacts = computed(() => {
  const baseList = isClientSide.value ? clientFilteredContacts.value : contacts.value
  const column = selectedFilterColumn.value
  const values = selectedFilterValues.value
  if (!column || values.length === 0) return baseList

  return baseList.filter((c) => {
    if (column === 'notes') {
      const hasNotes = !!c.notes
      return values.includes(hasNotes ? 'yes' : 'no')
    }
    return values.includes(String(c[column] ?? ''))
  })
})

const displayedContacts = computed(() => columnFilteredContacts.value)
const displayedTotalRecords = computed(() => columnFilteredContacts.value.length)
```

`emptyMessage` and `BaseDataTableFooterLoader` props naturally inherit the new filtered counts. `isCompactTable` continues to work because it depends on `displayedTotalRecords`.

### Template additions

Inside `BasePanel`'s `#actions` slot, **before** the Add button and **after** the existing search button(s):

```vue
<Button
  outlined
  size="small"
  icon="pi pi-filter"
  :class="['section-contacts__column-filter', { 'section-contacts__column-filter--active': isColumnFilterActive }]"
  aria-label="Filter contacts by column"
  @click="(e) => filterPopoverRef.toggle(e)"
/>
<Popover
  ref="filterPopoverRef"
  class="section-contacts__filter-popover"
  @hide="onFilterPopoverHide"
>
  <div class="section-contacts__filter-popover-body">
    <Select
      v-model="selectedFilterColumn"
      :options="FILTER_COLUMNS"
      option-label="header"
      option-value="field"
      placeholder="Filter By"
      fluid
      @change="selectedFilterValues = []"
    />

    <!-- Status: MultiSelect with checkbox + Tag rows -->
    <MultiSelect
      v-if="selectedFilterColumn === 'status'"
      v-model="selectedFilterValues"
      :options="filterValueOptions"
      option-label="label"
      option-value="value"
      placeholder="Select Status"
      display="comma"
      fluid
    >
      <template #option="{ option }">
        <Tag
          :value="option.label"
          :class="option.value === 'active' ? 'status-active' : 'status-inactive'"
        />
      </template>
    </MultiSelect>

    <!-- All other columns: single Select -->
    <Select
      v-else-if="selectedFilterColumn"
      :model-value="selectedFilterValues[0] ?? null"
      :options="filterValueOptions"
      option-label="label"
      option-value="value"
      :placeholder="`Select ${columnHeader(selectedFilterColumn)}`"
      fluid
      show-clear
      @update:model-value="(v) => selectedFilterValues = v ? [v] : []"
    />
  </div>
</Popover>
```

`isColumnFilterActive = computed(() => !!selectedFilterColumn.value && selectedFilterValues.value.length > 0)`. `columnHeader(field)` is a tiny helper returning the matching header from `FILTER_COLUMNS`.

`onFilterPopoverHide` stays empty for now — Figma shows no Clear/Cancel buttons; live-commit semantics mean the filter persists across opens. This matches the existing `filterText` behavior (it persists too).

### showFilter / button visibility

Reuse the same `showFilter` gating (only render the toolbar's filter controls when `totalRecords > ROWS_PER_PAGE` or a filter is active). Extend its activation condition to include `isColumnFilterActive`.

### Styling notes (per `03-css-tokens.md` and `13-mobile-first.md`)

All new styles in `<style scoped>`:

- `.section-contacts__column-filter` — sized button (mobile-first base 36×36 like the existing search button), border `var(--p-skyblue-600)`, color `var(--p-skyblue-600)`, background `var(--p-surface-0)`.
- `.section-contacts__column-filter--active` — `:deep()` override changes color to `var(--p-red-500)` (mirrors `.section-contacts__filter--active` pattern).
- `.section-contacts__filter-popover` — sets popover panel padding `var(--p-spacing-3)` and width via `min-width: 222px` matching Figma; `:deep(.p-popover)` token-based overrides only.
- `.section-contacts__filter-popover-body` — `display: flex; flex-direction: column; gap: var(--p-spacing-2);`
- Status tag rendering re-uses existing `.status-active` / `.status-inactive` from `main.css` — no new styles needed.
- All `@media` queries nested inside class blocks using `min-width` only.

## Specific Actions

1. **Open `app/components/SectionContacts.vue`** — single file edit, no new files.
2. **Add `FILTER_COLUMNS` constant** (top of `<script setup>`, after `ROWS_PER_PAGE`/`SEARCH_DEBOUNCE_MS`): array of `{ field, header }` objects mirroring the 6 existing `Column` definitions. Use it later both as the table column source and as the filter dropdown options.
3. **Add reactive state**: `filterPopoverRef`, `selectedFilterColumn` (`ref<string | null>(null)`), `selectedFilterValues` (`ref<string[]>([])`).
4. **Add `columnHeader(field)` helper** — local function returning `FILTER_COLUMNS.find(c => c.field === field)?.header ?? ''`.
5. **Add `filterValueOptions` computed** — distinct, de-duped value list scoped to the current loaded dataset. Source is `clientFilteredContacts.value` when `isClientSide.value`, else `contacts.value`. Special-case `notes` (Yes/No) and `status` (label via `formatStatus()`); other columns use raw value as both label and value.
6. **Add `columnFilteredContacts` computed** — filters baseline contacts by `selectedFilterColumn` × `selectedFilterValues` (notes mapped to `yes`/`no`).
7. **Replace `displayedContacts`** to return `columnFilteredContacts.value` instead of branching directly on `isClientSide`. Update `displayedTotalRecords` to derive from the same computed.
8. **Add `isColumnFilterActive` computed** — `selectedFilterColumn != null && selectedFilterValues.length > 0`.
9. **Update `showFilter`** to also become `true` when `isColumnFilterActive.value` (so toolbar stays visible while filter chip is in effect).
10. **Update `emptyMessage`** to mention column filter when active and zero results, e.g. `0 of N contacts match`. Refactor existing condition `if (filterText.value.trim() && !displayedContacts.value.length)` → `if ((filterText.value.trim() || isColumnFilterActive.value) && !displayedContacts.value.length)`.
11. **Add filter `Button`** to `BasePanel`'s `#actions` slot, placed between the existing mobile/desktop search controls and the existing Add button. `icon="pi pi-filter"`, `outlined`, `size="small"`, `aria-label="Filter contacts by column"`. Click handler calls `filterPopoverRef.value.toggle($event)`.
12. **Add `<Popover ref="filterPopoverRef">`** at the bottom of the template (sibling to `<DrawerContactInfo>`) with the body described in *Low Level Description* — `Select` for column choice, then conditional `MultiSelect` (status) or single `Select` (others). Use `@change` on the column Select to clear `selectedFilterValues` when the column changes.
13. **Pass `option` slot to `MultiSelect`** for the status case, rendering `<Tag>` with `.status-active`/`.status-inactive` classes (no checkbox needed in slot — `MultiSelect` renders its own checkbox in the option row).
14. **Add scoped CSS**:
    - `.section-contacts__column-filter` (mobile-first base 36×36, scales like existing add/search buttons).
    - `.section-contacts__column-filter--active` `:deep()` color/border red-500 swap.
    - `.section-contacts__filter-popover` panel width/padding via `:deep(.p-popover-content)` (or `pt` prop) using token values only.
    - `.section-contacts__filter-popover-body` flex column with `var(--p-spacing-2)` gap.
    - All breakpoints nested with `@media (min-width: 768px)` — no `max-width` width queries.
15. **Verify mobile/desktop rendering** at 360, 768, 1024, 1440 viewport widths. Confirm the popover anchors correctly on both.
16. **Verify the existing search + new column filter combine** correctly:
    - Search + column filter both active → both layers narrow results.
    - Clearing search keeps column filter intact and vice versa.
    - Changing column resets value (`@change` handler).
17. **Verify edge cases**: column with no distinct values shows empty value dropdown; switching from MultiSelect to Select clears state; popover dismisses cleanly on outside click without losing filter state (matches Figma live-commit semantics).
18. **Pre-commit check**: run `grep -rnE "@media[^{]*max-width" app/components/SectionContacts.vue` and `grep -rnE "^@media" app/components/SectionContacts.vue` — both should return zero hits per `13-mobile-first.md`.

## Possible Blockers

- **Server-side mode + column filter scope.** When `initialContacts === null`, `contacts.value` only holds the currently-paged 10 rows (more loaded on scroll). `filterValueOptions` will only see what's loaded, so distinct values are *incomplete* until the user scrolls. Two options: (a) accept the limitation and document it, (b) eagerly fetch all contacts for the partner when the popover opens. Recommend (a) for v1; flag for follow-up if the customer/supplier contact lists grow large in production. Confirm with user.
- **PrimeVue `MultiSelect` `option` slot availability.** PrimeVue MCP returned no slots for `MultiSelect`, but the live PrimeVue 4 docs do list an `option` slot. Existing usage in `DrawerManufacturer.vue:109` does not use a custom `option` slot, so we have no in-repo precedent. If the slot does not work as expected, fallback is to render the status options as plain checkbox+text and add tag styling via PrimeVue passthrough (`pt`).
- **No Apply/Clear controls in Figma.** The design shows live-commit only. There is currently no way to clear the column filter except by re-opening the popover and emptying the second dropdown (Select has `show-clear`, MultiSelect uses `showClear` or via individual unchecks). Confirm this UX is acceptable, or add a small "Clear" link/button to the popover footer.
- **`notes` column semantic mismatch.** The column doesn't expose raw text — it shows a Yes tag iff `contact.notes` is truthy. Filtering by raw note content would be inconsistent with what the user sees. Plan filters on the boolean (Yes/No). Confirm this matches the user's intent or whether `notes` should be excluded from filterable columns.
- **Sort order of distinct values.** `Set` preserves insertion order, which equals row order. Some columns (status) only have 2 values so this is fine; for `name`/`email` this gives an unsorted list. Plan does not currently sort. Confirm whether alphabetical sort is required.
- **Filter button visibility gating.** Currently `showFilter` is gated by `totalRecords > ROWS_PER_PAGE`. The new column filter button shares this gate. If a user wants to filter a 4-row table, the controls won't show. Confirm whether the column filter should be gated identically or always visible when there is at least 1 row.
- **Mobile UX for the popover.** PrimeVue `Popover` is anchored to a button — on a small viewport the popover may overflow the screen. Defaults usually handle this, but verify on a 360px viewport. If problematic, fall back to `Drawer` for `< 768px` (would require a `useBreakpoint`-style branch).
- **Interaction with virtual scroller.** `DataTable` uses `virtual-scroller-options` when not compact. `displayedContacts` length changes as the column filter narrows results — verify the virtual scroller refreshes correctly (it should, since the array reference changes).
