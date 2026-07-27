# Plan: CustomerToolbar — Add "Customer Group" & "National Account" Filters

**Created:** 2026-05-07
**Status:** Draft — Pending Review
**Task:** Extend `CustomerToolbar` with two new server-side filter dimensions: **Customer Group** (multi-select sourced from `business_partner_groups` collection, scoped to `relationship_type: 'customer'`) and **National Account** (a single checkbox toggling `business_partners.is_national_account = true`). Both filters compose into the existing Directus query alongside Status + Account Manager + search + sort, and both surface in the `OverlayBadge` total count.

---

## High Level Plan

`CustomerToolbar.vue` already implements a two-tier popover pattern: a root "Filter By" list with one row per dimension, and a detail view (selected via a `filterBy` ref) that renders the dimension-specific control. State lives in the `customerFilter` Pinia store (`app/stores/customerFilter.ts`), which is also responsible for re-fetching the prev/next sequence and clearing cached table state on change. Adding two new dimensions is therefore an *additive* change against three artifacts: the store (new state + actions + persistence keys + sequence-key composition), the toolbar (two new root rows + two new detail views), and the Customers landing page (pass new filter values into `loadCustomers` + watch them for refetch). The Directus query layer (`useBusinessPartners.buildPartnerFilter`) needs two new clauses: `business_partner_groups_id: { _in: [...] }` for Customer Group and `is_national_account: { _eq: true }` for National Account.

**Customer Group** is a multi-select identical in shape to the existing Status filter — a `MultiSelect` bound to an array of `business_partner_groups.id` values. The option list is fetched lazily on first popover entry (mirroring the Account Manager lazy-load at `CustomerToolbar.vue:41`) via the existing `useBusinessPartnerGroups().fetchBusinessPartnerGroups({ relationshipType: 'customer' })` composable — no new fetcher required. The filter clause is `{ business_partner_groups_id: { _in: ids } }` since `business_partner_groups_id` is the M2O field on `business_partners` (`app/types/directus/collections.ts:59`). Selected IDs persist as numbers (the PK is `int` per the BusinessPartnerGroup type), but the store stores them as `number[]` to match the Directus payload — the `MultiSelect` v-model handles primitive arrays natively.

**National Account** is a single boolean. Per the user spec, selecting the filter row drills into a detail view that renders one `Checkbox` (binary) labelled "National customer account" — i.e. it is a *toggleable single-state* filter, not a multi-select. The store models it as `isNationalAccountOnly: boolean`. When `true`, the Directus query gets `{ is_national_account: { _eq: true } }`; when `false`, the clause is omitted (we never filter for *non*-national accounts because the user spec only describes one positive direction). The `OverlayBadge` count contributes `1` when the toggle is on, `0` otherwise — consistent with how Status (a multi-select) contributes its `.length`. The root row's per-dimension badge uses the same convention.

This is a **Phase 3** change (UI + Directus wiring in the same PR) because the filter has no observable behavior without the server params; the existing filter pattern already mixes UI + wiring in `Index.vue`.

## Low Level Description

### Files touched

| File | Change |
| --- | --- |
| `app/stores/customerFilter.ts` | Add `selectedBusinessPartnerGroupIds: number[]` and `isNationalAccountOnly: boolean` to state. Add `setBusinessPartnerGroupIds(values)` and `setNationalAccountOnly(value)` actions. Extend `totalFilterCount`, `clearAll`, `resetToDefaults`, `invalidateSequence` triggers, `buildSequenceKey`, `ensureSequenceLoaded` filter args, and `persist.pick` list. |
| `app/components/CustomerToolbar.vue` | Extend `FilterBy` union to `'root' \| 'status' \| 'accountManager' \| 'customerGroup' \| 'nationalAccount'`. Add lazy-load helper `ensureBusinessPartnerGroupsLoaded()`. Add two new root rows (with badges + clear-on-badge-click). Add two new detail views: `customerGroup` MultiSelect and `nationalAccount` Checkbox. Extend the `showNavigation` watcher so navigation sequence invalidates on the new dimensions. |
| `app/pages/Customers/Index.vue` | In `loadCustomers`, pass `businessPartnerGroupIds` and `isNationalAccountOnly` to `fetchBusinessPartners` + `fetchBusinessPartnerCount`. Extend the `watch` on filter state (lines 242–255) to include the two new state slices. |
| `app/composables/useBusinessPartners.ts` | Extend `FetchBusinessPartnersOptions` and `BuildPartnerFilterOptions` with `businessPartnerGroupIds: number[] \| null` and `isNationalAccountOnly: boolean`. Extend `buildPartnerFilter` with two new conditions. |

No new files. The existing `useBusinessPartnerGroups` composable (`app/composables/useBusinessPartnerGroups.ts`) already exposes `fetchBusinessPartnerGroups({ relationshipType: 'customer' })` returning `BusinessPartnerGroup[]` with `id`, `name`, `relationship_type` — directly consumable.

### Directus schema confirmation

Verified via repo source — no MCP query needed:

- `business_partners.is_national_account: boolean` — `app/types/directus/collections.ts:55`. Already in `LIST_FIELDS` at `app/composables/useBusinessPartners.ts:15`.
- `business_partners.business_partner_groups_id: number | BusinessPartnerGroup` — `app/types/directus/collections.ts:59` (M2O singular FK to `business_partner_groups`).
- `business_partner_groups: { id: number, name: string, relationship_type: 'customer' | 'supplier', sort: number | null, sap_id: number }` — `app/types/directus/collections.ts:71-77`.

The M2O singular field name is **`business_partner_groups_id`** (already used as a Directus filter key in `LIST_FIELDS`/`fields` and as a sort field). Filter shape: `{ business_partner_groups_id: { _in: [ids] } }`.

### Store changes (`app/stores/customerFilter.ts`)

State additions:

```ts
interface CustomerFilterState {
  selectedStatuses: string[]
  selectedAccountManagerIds: string[]
  selectedBusinessPartnerGroupIds: number[]   // NEW
  isNationalAccountOnly: boolean              // NEW
  sortField: string
  sortOrder: number
  sequence: CustomerSequenceEntry[]
  sequenceKey: string | null
  isSequenceLoading: boolean
}
```

Initial values: `selectedBusinessPartnerGroupIds: []`, `isNationalAccountOnly: false`.

`buildSequenceKey` extension:

```ts
function buildSequenceKey(state: CustomerFilterState): string {
  return JSON.stringify({
    s: [...state.selectedStatuses].sort(),
    m: [...state.selectedAccountManagerIds].sort(),
    g: [...state.selectedBusinessPartnerGroupIds].sort((a, b) => a - b),
    n: state.isNationalAccountOnly,
    f: state.sortField,
    o: state.sortOrder,
  })
}
```

`totalFilterCount` getter:

```ts
totalFilterCount: (state): number =>
  state.selectedStatuses.length
  + state.selectedAccountManagerIds.length
  + state.selectedBusinessPartnerGroupIds.length
  + (state.isNationalAccountOnly ? 1 : 0),
```

New actions (mirror `setStatuses`/`setAccountManagerIds`):

```ts
setBusinessPartnerGroupIds(values: number[]): void {
  this.selectedBusinessPartnerGroupIds = [...values]
  this.invalidateSequence()
  useTableStateStore().clearTableState('/customers')
},

setNationalAccountOnly(value: boolean): void {
  this.isNationalAccountOnly = value
  this.invalidateSequence()
  useTableStateStore().clearTableState('/customers')
},
```

`clearAll` and `resetToDefaults` reset both to their initial values. `ensureSequenceLoaded` passes the new filter args into `fetchBusinessPartners`:

```ts
const { data, error } = await fetchBusinessPartners({
  relationshipType: 'customer',
  fields: ['sap_id', 'name'],
  sort: this.sortOrder === -1 ? [`-${this.sortField}`] : [this.sortField],
  statusValues: this.selectedStatuses.length ? this.selectedStatuses : null,
  userCreatedIds: this.selectedAccountManagerIds.length ? this.selectedAccountManagerIds : null,
  businessPartnerGroupIds: this.selectedBusinessPartnerGroupIds.length ? this.selectedBusinessPartnerGroupIds : null,
  isNationalAccountOnly: this.isNationalAccountOnly,
  limit: -1,
  page: 1,
})
```

`persist.pick` extends to:

```ts
pick: [
  'selectedStatuses',
  'selectedAccountManagerIds',
  'selectedBusinessPartnerGroupIds',
  'isNationalAccountOnly',
  'sortField',
  'sortOrder',
],
```

### `useBusinessPartners.ts` changes

Extend interfaces:

```ts
interface BuildPartnerFilterOptions {
  relationshipType?: string | null
  status?: string | null
  statusValues?: string[] | null
  userCreatedIds?: string[] | null
  businessPartnerGroupIds?: number[] | null    // NEW
  isNationalAccountOnly?: boolean              // NEW
}

interface FetchBusinessPartnersOptions {
  // ...existing fields...
  businessPartnerGroupIds?: number[] | null    // NEW
  isNationalAccountOnly?: boolean              // NEW
}
```

`buildPartnerFilter` additions inside the existing `conditions` builder (after the `userCreatedIds` clause at lines 235-237):

```ts
if (businessPartnerGroupIds?.length) {
  conditions.push({ business_partner_groups_id: { _in: businessPartnerGroupIds } })
}

if (isNationalAccountOnly) {
  conditions.push({ is_national_account: { _eq: true } })
}
```

Destructure them at the top of `buildPartnerFilter`:

```ts
const {
  relationshipType = null,
  status = null,
  statusValues = null,
  userCreatedIds = null,
  businessPartnerGroupIds = null,
  isNationalAccountOnly = false,
} = options
```

### `CustomerToolbar.vue` changes

Extend the discriminated union:

```ts
type FilterBy = 'root' | 'status' | 'accountManager' | 'customerGroup' | 'nationalAccount'
```

Add new computed v-models bound to the store:

```ts
const selectedBusinessPartnerGroupIds = computed<number[]>({
  get: () => filterStore.selectedBusinessPartnerGroupIds,
  set: (values) => filterStore.setBusinessPartnerGroupIds(values),
})

const isNationalAccountOnly = computed<boolean>({
  get: () => filterStore.isNationalAccountOnly,
  set: (value) => filterStore.setNationalAccountOnly(value),
})
```

Lazy-load helper for groups (mirrors `ensureAccountManagersLoaded`, lines 41-59):

```ts
const { fetchBusinessPartnerGroups } = useBusinessPartnerGroups()
const businessPartnerGroups = ref<Array<{ id: number, name: string }>>([])
const isBusinessPartnerGroupsLoading = ref(false)
let businessPartnerGroupsLoaded = false

async function ensureBusinessPartnerGroupsLoaded() {
  if (businessPartnerGroupsLoaded || isBusinessPartnerGroupsLoading.value) return
  isBusinessPartnerGroupsLoading.value = true
  const { data, error } = await fetchBusinessPartnerGroups({ relationshipType: 'customer' })
  if (error || !data) {
    isBusinessPartnerGroupsLoading.value = false
    return
  }
  businessPartnerGroups.value = data.map((group) => ({ id: group.id, name: group.name }))
  businessPartnerGroupsLoaded = true
  isBusinessPartnerGroupsLoading.value = false
}
```

`selectFilterBy` extends to handle the two new values; `customerGroup` triggers the lazy load, `nationalAccount` does not need any fetch:

```ts
function selectFilterBy(value: 'status' | 'accountManager' | 'customerGroup' | 'nationalAccount') {
  filterBy.value = value
  if (value === 'accountManager') ensureAccountManagersLoaded()
  if (value === 'customerGroup') ensureBusinessPartnerGroupsLoaded()
}
```

`handleFilterRowClick` is extended to clear on badge-click for the new dimensions:

```ts
function handleFilterRowClick(
  event: MouseEvent,
  dimension: 'status' | 'accountManager' | 'customerGroup' | 'nationalAccount',
) {
  if (isBadgeClick(event)) {
    event.stopPropagation()
    if (dimension === 'status') filterStore.setStatuses([])
    else if (dimension === 'accountManager') filterStore.setAccountManagerIds([])
    else if (dimension === 'customerGroup') filterStore.setBusinessPartnerGroupIds([])
    else filterStore.setNationalAccountOnly(false)
    return
  }
  selectFilterBy(dimension)
}
```

**Template additions — root view** (after the existing `accountManager` row, lines 214-229):

```vue
<div
  role="button"
  tabindex="0"
  class="customer-toolbar__row"
  @click="(e) => handleFilterRowClick(e, 'customerGroup')"
  @keydown.enter="selectFilterBy('customerGroup')"
  @keydown.space.prevent="selectFilterBy('customerGroup')"
>
  <OverlayBadge
    :value="selectedBusinessPartnerGroupIds.length"
    severity="danger"
    :class="['customer-toolbar__row-badge', { 'customer-toolbar__row-badge--hidden': selectedBusinessPartnerGroupIds.length === 0 }]"
  >
    <span class="customer-toolbar__row-label">Customer Group</span>
  </OverlayBadge>
</div>

<div
  role="button"
  tabindex="0"
  class="customer-toolbar__row"
  @click="(e) => handleFilterRowClick(e, 'nationalAccount')"
  @keydown.enter="selectFilterBy('nationalAccount')"
  @keydown.space.prevent="selectFilterBy('nationalAccount')"
>
  <OverlayBadge
    :value="isNationalAccountOnly ? 1 : 0"
    severity="danger"
    :class="['customer-toolbar__row-badge', { 'customer-toolbar__row-badge--hidden': !isNationalAccountOnly }]"
  >
    <span class="customer-toolbar__row-label">National Account</span>
  </OverlayBadge>
</div>
```

**Template additions — detail views** (the existing `else` branch becomes an `else-if filterBy === 'accountManager'` branch; add two new `else-if` branches before it or after — order doesn't affect logic):

```vue
<template v-else-if="filterBy === 'customerGroup'">
  <div
    role="button"
    tabindex="0"
    class="customer-toolbar__back"
    @click="filterBy = 'root'"
    @keydown.enter="filterBy = 'root'"
    @keydown.space.prevent="filterBy = 'root'"
  >
    <i class="pi pi-chevron-left customer-toolbar__back-icon" />
    <span>Filter by Customer Group</span>
  </div>
  <MultiSelect
    v-model="selectedBusinessPartnerGroupIds"
    :options="businessPartnerGroups"
    option-label="name"
    option-value="id"
    :loading="isBusinessPartnerGroupsLoading"
    placeholder="Select Customer Group"
    display="comma"
    fluid
    filter
    show-clear
    :show-toggle-all="false"
    empty-message="No customer groups found"
    :pt="{ pcFilter: { root: { style: 'height: 39px' } } }"
  />
</template>

<template v-else-if="filterBy === 'nationalAccount'">
  <div
    role="button"
    tabindex="0"
    class="customer-toolbar__back"
    @click="filterBy = 'root'"
    @keydown.enter="filterBy = 'root'"
    @keydown.space.prevent="filterBy = 'root'"
  >
    <i class="pi pi-chevron-left customer-toolbar__back-icon" />
    <span>Filter by National Account</span>
  </div>
  <div class="checkbox-field">
    <Checkbox
      v-model="isNationalAccountOnly"
      input-id="customer-toolbar-national-account"
      binary
    />
    <label
      for="customer-toolbar-national-account"
      class="checkbox-field__label"
    >
      National customer account
    </label>
  </div>
</template>
```

The `.checkbox-field` / `.checkbox-field__label` classes already exist in `app/assets/css/main.css` (per `CLAUDE.md` shared CSS table) and are used in `Customers/Create.vue:712-725` — no new CSS required.

The `showNavigation` watcher (lines 124-144) extends to invalidate the prev/next sequence when the new dimensions change:

```ts
watch(
  [
    () => filterStore.selectedStatuses,
    () => filterStore.selectedAccountManagerIds,
    () => filterStore.selectedBusinessPartnerGroupIds,
    () => filterStore.isNationalAccountOnly,
    () => filterStore.sortField,
    () => filterStore.sortOrder,
  ],
  () => {
    filterStore.invalidateSequence()
    filterStore.ensureSequenceLoaded()
  },
  { deep: true },
)
```

### `Customers/Index.vue` changes

In `loadCustomers` (around lines 95-118), extend the call sites:

```ts
const groupIds = filterStore.selectedBusinessPartnerGroupIds.length
  ? [...filterStore.selectedBusinessPartnerGroupIds]
  : null
const nationalOnly = filterStore.isNationalAccountOnly

const [listResult, countResult] = await Promise.all([
  fetchBusinessPartners({
    relationshipType: 'customer',
    fields: CUSTOMER_LIST_FIELDS,
    deep: { contacts: { _limit: -1 } },
    limit: rowsPerPage,
    page,
    search: searchTerm,
    sort: buildSortParam(),
    statusValues,
    userCreatedIds,
    businessPartnerGroupIds: groupIds,
    isNationalAccountOnly: nationalOnly,
  }),
  page === 1
    ? fetchBusinessPartnerCount({
      relationshipType: 'customer',
      search: searchTerm,
      statusValues,
      userCreatedIds,
      businessPartnerGroupIds: groupIds,
      isNationalAccountOnly: nationalOnly,
    })
    : Promise.resolve(null),
])
```

Extend the watch on filter state (lines 242-255):

```ts
watch(
  [
    () => filterStore.selectedStatuses,
    () => filterStore.selectedAccountManagerIds,
    () => filterStore.selectedBusinessPartnerGroupIds,
    () => filterStore.isNationalAccountOnly,
  ],
  () => {
    tableStateStore.clearTableState('/customers')
    filterStore.invalidateSequence()
    currentPage.value = 1
    hasMore.value = true
    loadCustomers(1, searchStore.searchQuery)
  },
  { deep: true },
)
```

### Persistence and reset semantics

The `customerFilter` store persists `selectedStatuses`, `selectedAccountManagerIds`, sort field/order. The hydration block at `Customers/Index.vue:14-17` calls `filterStore.resetToDefaults()` on hydration to avoid stale persisted state — the new fields must be reset by `resetToDefaults` too (covered above). Persistence keys are extended via `persist.pick`.

### Auto-imports

`MultiSelect`, `Checkbox`, and `OverlayBadge` are PrimeVue components — auto-imported by the `@primevue/nuxt-module`, no explicit import. `useBusinessPartnerGroups` is auto-imported as a composable from `app/composables/`.

## Specific Actions

1. Edit `app/stores/customerFilter.ts`:
   - Add `selectedBusinessPartnerGroupIds: number[]` and `isNationalAccountOnly: boolean` to the `CustomerFilterState` interface.
   - Initialize both in `state()` to `[]` and `false` respectively.
   - Extend `buildSequenceKey` to include `g` (sorted ids array) and `n` (boolean) keys.
   - Update `totalFilterCount` getter to add `selectedBusinessPartnerGroupIds.length + (isNationalAccountOnly ? 1 : 0)`.
   - Add `setBusinessPartnerGroupIds(values: number[])` action (clones values, calls `invalidateSequence()`, clears `tableState('/customers')`).
   - Add `setNationalAccountOnly(value: boolean)` action (assigns, calls `invalidateSequence()`, clears `tableState('/customers')`).
   - In `clearAll`, reset both new fields.
   - In `resetToDefaults`, reset both new fields.
   - In `ensureSequenceLoaded`, pass `businessPartnerGroupIds` and `isNationalAccountOnly` to `fetchBusinessPartners`.
   - Append `'selectedBusinessPartnerGroupIds'` and `'isNationalAccountOnly'` to `persist.pick`.

2. Edit `app/composables/useBusinessPartners.ts`:
   - Add `businessPartnerGroupIds?: number[] \| null` and `isNationalAccountOnly?: boolean` to `BuildPartnerFilterOptions` and `FetchBusinessPartnersOptions`.
   - In `buildPartnerFilter`, destructure both new options with defaults `null` / `false`.
   - Append two `conditions.push(...)` calls for the new clauses (only when truthy / non-empty).

3. Edit `app/components/CustomerToolbar.vue`:
   - Extend `FilterBy` type union with `'customerGroup'` and `'nationalAccount'`.
   - Add `useBusinessPartnerGroups()` destructure (`fetchBusinessPartnerGroups`) at the top of `<script setup>`.
   - Add `businessPartnerGroups` ref (array), `isBusinessPartnerGroupsLoading` ref, and `businessPartnerGroupsLoaded` flag (mirroring account-manager pattern).
   - Add `ensureBusinessPartnerGroupsLoaded()` function calling `fetchBusinessPartnerGroups({ relationshipType: 'customer' })`.
   - Add `selectedBusinessPartnerGroupIds` and `isNationalAccountOnly` computed v-models bound to the store.
   - Update `selectFilterBy` signature/body to accept the two new values and trigger lazy-load only for `'customerGroup'`.
   - Update `handleFilterRowClick` to handle clearing the new dimensions on badge-click.
   - Add two new root-list rows in the popover template (Customer Group, National Account) with `OverlayBadge` + `customer-toolbar__row` styling.
   - Convert the trailing `<template v-else>` (account manager detail view) into `<template v-else-if="filterBy === 'accountManager'">` and add two new `<template v-else-if>` branches: `customerGroup` (MultiSelect) and `nationalAccount` (Checkbox + label "National customer account"). Each detail view begins with the standard `customer-toolbar__back` row.
   - In the `showNavigation` watcher, add `() => filterStore.selectedBusinessPartnerGroupIds` and `() => filterStore.isNationalAccountOnly` to the watched sources array.

4. Edit `app/pages/Customers/Index.vue`:
   - In `loadCustomers`, capture `groupIds = filterStore.selectedBusinessPartnerGroupIds.length ? [...filterStore.selectedBusinessPartnerGroupIds] : null` and `nationalOnly = filterStore.isNationalAccountOnly`.
   - Pass both as `businessPartnerGroupIds` and `isNationalAccountOnly` into both `fetchBusinessPartners(...)` and `fetchBusinessPartnerCount(...)`.
   - Extend the post-search filter-state watcher (lines 242-255) to include the two new state slices in its source array.

5. Manual verification (no test runner per `CLAUDE.md`):
   - Run `npm run dev`, open `/customers`.
   - Open filter popover → confirm "Customer Group" and "National Account" rows render below "Account Manager".
   - Click "Customer Group" → confirm `MultiSelect` populates from Directus, scoped to `relationship_type: 'customer'`. Select 2 groups → popover badge increments by 2 → DataTable refetches showing only matching rows.
   - Back to root → click "National Account" → confirm checkbox renders with label "National customer account". Toggle on → root badge increments by 1, list filters to `is_national_account = true` rows.
   - Click row-level badge to clear each dimension; confirm refetch + badge zeroing.
   - Hard-refresh page → confirm the persisted selections re-apply (because `persist.pick` includes the new keys), but `Index.vue:14-17` resets them on hydration — verify the spec-correct behavior matches the existing Status/Account Manager defaults (i.e. they reset to empty/false). If the user wants the new filters persisted across reloads, drop them from the hydration reset; otherwise they should reset like the current pattern.
   - Browse to a customer detail page — verify prev/next sequence respects all four filter dimensions (sequence key includes `g` and `n`).

## Possible Blockers

- **`business_partner_groups` collection access permissions.** The composable already exists (`useBusinessPartnerGroups`), but Customers list-page users may not have read permissions on `business_partner_groups`. If `fetchBusinessPartnerGroups` returns `[]` or errors silently for a non-admin role, the `MultiSelect` will appear empty. Confirm with the Directus admin that the `customer` role (or whatever role the front-end user has) has `read` on the collection. Mitigation: log the error path explicitly so empty results are distinguishable from a permissions failure.
- **Persistence vs. hydration reset.** The current `Index.vue` hydration block (`useNuxtApp().isHydrating` → `filterStore.resetToDefaults()`) wipes filters on every cold load even though `persist.pick` retains them. The user's spec doesn't say whether the new filters should persist across reloads. Default plan keeps the same reset-on-hydrate behavior for consistency — confirm this matches user intent before merging.
- **Customer Group ID type.** `BusinessPartnerGroup.id` is `number` (per `collections.ts:72`). The store stores `number[]`. PrimeVue `MultiSelect` v-model handles primitive arrays, but Directus filter values must be numbers (not strings) for `_in` against an integer PK — confirm the Directus SDK doesn't coerce. If it does, the current `selectedAccountManagerIds: string[]` precedent (uuid) demonstrates the SDK round-trips primitives unchanged. No expected issue.
- **No new tests.** Per `CLAUDE.md`, the project has no test runner configured; verification is manual via `npm run dev`. The plan does not add tests; if the user wants test coverage, scaffold a temporary `vitest.config.js` per `.claude/rules/12-testing.md` (delete after).
- **`pages:extend` route registration.** No new route added — `/customers` already exists, and `CustomerToolbar` is consumed in-place. No `nuxt.config.js` change required. Confirm there are no other consumers of `CustomerToolbar` (`grep -rn "CustomerToolbar"` returns only `Customers/Index.vue` + `Customers/[id].vue` per the codebase scan); both will pick up the new filters automatically.
- **Detail page (`Customers/[id].vue`) showNavigation flow.** The toolbar is reused with `:show-navigation="true"` on detail pages. Since the prev/next sequence now keys off the new filters, switching the toggle on a detail page (uncommon flow but possible) will invalidate and refetch the sequence. Verify the watcher addition does not introduce a redundant refetch loop with the existing cache key — covered by the existing `sequenceKey === key` short-circuit at the top of `ensureSequenceLoaded`.
