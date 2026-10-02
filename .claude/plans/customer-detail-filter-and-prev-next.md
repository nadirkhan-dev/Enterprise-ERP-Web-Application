# Plan: Customer Detail Page — Filter Button + Previous / Next Navigation

**Created:** 2026-04-30
**Status:** Draft — Pending Review
**Task:** Add the same Status / Account-Manager filter (already shipped on `Customers/Index.vue`) to `Customers/[id].vue`, plus a previous/next button pair that walks the user through the filtered + sorted customer sequence; keep both pages' state in sync via a shared Pinia store, and display a `loadError` message when the active customer falls outside the filter.

---

## High Level Plan

The customer landing page (`app/pages/Customers/Index.vue`) already owns a working filter UX (`selectedStatuses`, `selectedAccountManagerIds`) wired into a server-side `business_partners` query. Today that filter state is **local** to the landing page (lines 30–41) and is only echoed into the `tableState` cache for scroll-restore on return navigation (`app/stores/tableState.ts:14–15`, `app/composables/useTableStateRestore.ts:13–63`). The detail page (`Customers/[id].vue`) does not see it. To make the filter changeable from the detail page **and** to keep the landing table coherent, the canonical filter+sort state has to be hoisted to a Pinia store that both pages read from and write to. The landing page already needs sort state (`sortField`/`sortOrder` — lines 53–54) and filter state, so the same store carries all four fields.

The detail page also needs the **complete** sorted, filtered list of customer `sap_id`s in order to know what "previous" and "next" mean. The landing page only holds whatever has been infinite-scrolled into memory (≤46 rows by default per `Customers/Index.vue:21`), so the detail page must lazily fetch its own sap-id-only list. This is one extra Directus call returning just `sap_id` and `name`, sorted by the landing page's current sort, filtered the same way — cheap and idempotent. The store caches the result keyed by `(statuses, managers, sortField, sortOrder)` so revisits inside a session don't refetch.

The filter button + popover currently lives inline in `Customers/Index.vue` (lines 367–391, 606–726). The 2+-pages-extraction trigger from `.claude/rules/11-ui-first-workflow.md` is now met, so the popover (badge wrapper, button trigger, root/status/manager views, MultiSelect rendering, lazy account-manager loading, badge clear-on-hover) moves into a single domain component `CustomerFilterButton.vue` that both pages embed. The component reads/writes the new store directly (no v-model) so there is no prop drilling.

The previous / next CTA group on the detail page mirrors Figma node `3294:33261`: an outlined sky-blue filter button (with badge), then a 4px gap, then two outlined gray 35px square buttons with `pi pi-chevron-left` / `pi pi-chevron-right` icons. Clicking next/previous calls `navigateTo('/customers/${neighborSapId}')`; the existing `route.params.id` watcher (`Customers/[id].vue:469–474`) then drives `loadCustomer()` for the new record. When the active customer is missing from the filtered sequence (because the user just changed the filter and excluded it), the existing `loadError` ref is populated with `Customer <account id> isn't available from filtered data` so the existing `<Message severity="error">` block (lines 515–521) renders the error and the `<template v-if="!isLoading && !hasLoadError && !loadError">` block (line 523) hides the rest of the page — no new template scaffolding needed for the error path.

This is a single Phase-3 (functionality wiring + UI) change: filter elevation + reusable component extraction + new buttons + new store all land together because the detail-page filter has no useful behavior without the shared store, and the navigation buttons depend on the shared sap-id sequence.

## Low Level Description

### Files touched

| File | Change |
| --- | --- |
| `app/stores/customerFilter.ts` (NEW) | Canonical filter, sort, and sap-id-sequence state shared between landing and detail pages. |
| `app/components/CustomerFilterButton.vue` (NEW) | Domain component — Button + OverlayBadge + Popover with Status / Account Manager views, badge clear-on-hover, lazy AM load. Reads/writes `useCustomerFilterStore`. |
| `app/pages/Customers/Index.vue` | Replace inline filter popover + state with `<CustomerFilterButton />`; bind `selectedStatuses`, `selectedAccountManagerIds`, `sortField`, `sortOrder` to the new store; keep existing fetch/watch/cache pipeline. |
| `app/pages/Customers/[id].vue` | Add `<CustomerFilterButton />` and previous/next buttons in a header CTA bar; load + watch the filtered sap-id sequence; populate `loadError` when current customer falls outside the filter. |
| `app/composables/useBusinessPartners.ts` | No interface changes — already supports `statusValues` and `userCreatedIds` (lines 144–162, 222–246). The detail-page sap-id fetch reuses `fetchBusinessPartners({ fields: ['sap_id', 'name'], limit: -1, statusValues, userCreatedIds, sort })`. |
| `app/composables/useTableStateRestore.ts` | Stop accepting `selectedStatuses` / `selectedAccountManagerIds` refs — those now live in the new store. The cache key it builds against `searchQuery` stays. Update its `tableState` write to read filter values from the store. |
| `app/stores/tableState.ts` | Drop `selectedStatuses` / `selectedAccountManagerIds` from `TableStateEntry` (or leave as compatibility no-ops for one cycle — see Possible Blockers). |

### New Pinia store: `app/stores/customerFilter.ts`

```ts
import { defineStore } from 'pinia'

const DEFAULT_SORT_FIELD = 'sap_id'
const DEFAULT_SORT_ORDER = 1

interface CustomerFilterState {
  selectedStatuses: string[]
  selectedAccountManagerIds: string[]
  sortField: string
  sortOrder: number
  // Cached sap-id sequence for prev/next navigation.
  sequence: { sapId: string, name: string }[]
  // Key snapshot used when sequence was loaded — so we can decide whether to refetch.
  sequenceKey: string | null
  isSequenceLoading: boolean
}

function buildSequenceKey(state: CustomerFilterState): string {
  return JSON.stringify({
    s: [...state.selectedStatuses].sort(),
    m: [...state.selectedAccountManagerIds].sort(),
    f: state.sortField,
    o: state.sortOrder,
  })
}

export const useCustomerFilterStore = defineStore('customerFilter', {
  state: (): CustomerFilterState => ({
    selectedStatuses: ['active'],          // mirrors current default in Index.vue
    selectedAccountManagerIds: [],
    sortField: DEFAULT_SORT_FIELD,
    sortOrder: DEFAULT_SORT_ORDER,
    sequence: [],
    sequenceKey: null,
    isSequenceLoading: false,
  }),

  getters: {
    totalFilterCount: (state) =>
      state.selectedStatuses.length + state.selectedAccountManagerIds.length,
  },

  actions: {
    setStatuses(values: string[]) { this.selectedStatuses = [...values] },
    setAccountManagerIds(values: string[]) { this.selectedAccountManagerIds = [...values] },
    setSort(field: string, order: number) {
      this.sortField = field || DEFAULT_SORT_FIELD
      this.sortOrder = field ? order : DEFAULT_SORT_ORDER
    },
    clearAll() {
      this.selectedStatuses = []
      this.selectedAccountManagerIds = []
    },
    invalidateSequence() {
      this.sequence = []
      this.sequenceKey = null
    },
    /**
     * Fetch the full sap-id sequence for the current filter+sort,
     * skipping if the cached key still matches.
     */
    async ensureSequenceLoaded() {
      const key = buildSequenceKey(this)
      if (this.sequenceKey === key && this.sequence.length) return
      if (this.isSequenceLoading) return
      this.isSequenceLoading = true
      const { fetchBusinessPartners } = useBusinessPartners()
      const { data, error } = await fetchBusinessPartners({
        relationshipType: 'customer',
        fields: ['sap_id', 'name'],
        sort: this.sortOrder === -1 ? [`-${this.sortField}`] : [this.sortField],
        statusValues: this.selectedStatuses.length ? this.selectedStatuses : null,
        userCreatedIds: this.selectedAccountManagerIds.length ? this.selectedAccountManagerIds : null,
        limit: -1,
        page: 1,
      })
      if (error || !data) {
        this.sequence = []
        this.sequenceKey = null
      } else {
        this.sequence = data.map((row) => ({ sapId: row.sap_id, name: row.name }))
        this.sequenceKey = key
      }
      this.isSequenceLoading = false
    },
  },
})
```

The store deliberately does **not** own `searchQuery` — that already lives in `useSearchStore` and only applies to the landing page's row list, not the navigation sequence. The user's spec explicitly excludes search from prev/next ("based on the sorting of customer's datatable from landing page" — sort only).

### Reusable component: `app/components/CustomerFilterButton.vue`

Lifts everything in `Index.vue` lines 23–303 + 367–391 + 606–726 + 814–960 that is filter-popover-specific. Public API:

```ts
// No props, no emits — internally binds to useCustomerFilterStore.
// Renders <OverlayBadge> + <Button outlined icon="pi pi-filter"> + <Popover>.
```

Internal pieces unchanged from `Index.vue`:

- `STATUS_OPTIONS` constant.
- `filterBy` local ref (`'root' | 'status' | 'accountManager'`).
- `accountManagers`, `isAccountManagersLoading`, `accountManagersLoaded` refs (lazy load on first popover open).
- `ensureAccountManagersLoaded()` — same as current `Index.vue:273–291`, using `useDirectusUsers().fetchAccountManagers()` and `useAssetUrl().getAssetUrl()`.
- `handleFilterButtonClick`, `selectFilterBy`, `handleFilterRowClick`, `handleHeaderBadgeClick`, `isBadgeClick` helpers — same as current `Index.vue:293–327`.
- v-model targets on the two `MultiSelect`s become two-way computed wrappers around the store: `const selectedStatuses = computed({ get: () => store.selectedStatuses, set: (v) => store.setStatuses(v) })` (and same for manager IDs).

Styles: copy the current scoped block in `Index.vue:814–960` verbatim, renamed under a `customer-filter-button__*` BEM root rather than `customers-page__filter-*`. The badge clear-on-hover styles (`Index.vue:888–913`) stay identical.

### Landing page changes (`Customers/Index.vue`)

1. Delete the inline filter UI (template lines 367–391 header actions block keeps the wrapper but the `OverlayBadge` + `Button` + `handleFilterButtonClick` get replaced with `<CustomerFilterButton />`; and lines 606–726 popover block deleted entirely).
2. Delete the now-component-local refs and helpers from script: `filterPopoverRef`, `filterBy`, `accountManagers`, `isAccountManagersLoading`, `accountManagersLoaded`, `ensureAccountManagersLoaded`, `handleFilterButtonClick`, `selectFilterBy`, `handleHeaderBadgeClick`, `handleFilterRowClick`, `isBadgeClick`, `totalFilterCount`, `STATUS_OPTIONS`, `useDirectusUsers`/`useAssetUrl` imports.
3. Replace `selectedStatuses`/`selectedAccountManagerIds` local refs with computed-mirrors of the store; the existing watcher (lines 262–271) becomes:

   ```ts
   watch(
     [() => filterStore.selectedStatuses, () => filterStore.selectedAccountManagerIds],
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

4. Replace `sortField`/`sortOrder` local refs with computed-mirrors of the store (same approach). `handleSort` (lines 64–70) calls `filterStore.setSort(event.sortField, event.sortOrder)` then re-runs `loadCustomers(1, ...)`. Add `filterStore.invalidateSequence()` to the same handler — sort changes invalidate the cached sequence.
5. `loadCustomers` reads `filterStore.selectedStatuses`, `filterStore.selectedAccountManagerIds`, `filterStore.sortField`, `filterStore.sortOrder` instead of local refs (lines 116–117, `buildSortParam` line 56–62).
6. `useTableStateRestore` call (lines 239–250) drops the `selectedStatuses` / `selectedAccountManagerIds` refs — the cache no longer carries those (see Possible Blockers for the alternative).

### Detail page changes (`Customers/[id].vue`)

#### Imports & store binding

```ts
const filterStore = useCustomerFilterStore()
```

#### Sequence loading + neighbor computation

```ts
const isInitialFilterLoad = ref(true)

const sequenceIndex = computed(() =>
  filterStore.sequence.findIndex((entry) => entry.sapId === String(route.params.id)),
)
const previousSapId = computed(() =>
  sequenceIndex.value > 0 ? filterStore.sequence[sequenceIndex.value - 1].sapId : null,
)
const nextSapId = computed(() =>
  sequenceIndex.value >= 0 && sequenceIndex.value < filterStore.sequence.length - 1
    ? filterStore.sequence[sequenceIndex.value + 1].sapId
    : null,
)

async function refreshSequence({ checkInclusion = false } = {}) {
  await filterStore.ensureSequenceLoaded()
  if (!checkInclusion) return
  if (sequenceIndex.value === -1) {
    loadError.value = `Customer ${route.params.id} isn't available from filtered data`
  } else {
    // Clear only the not-in-filter error; keep other loadErrors as-is.
    if (loadError.value?.startsWith(`Customer ${route.params.id} isn't available`)) {
      loadError.value = null
    }
  }
}

watch(
  [
    () => filterStore.selectedStatuses,
    () => filterStore.selectedAccountManagerIds,
    () => filterStore.sortField,
    () => filterStore.sortOrder,
  ],
  () => {
    filterStore.invalidateSequence()
    refreshSequence({ checkInclusion: !isInitialFilterLoad.value })
    isInitialFilterLoad.value = false
  },
  { deep: true },
)

watch(
  () => route.params.id,
  () => {
    // After navigating to the new customer, recompute neighbors but
    // don't fire the not-in-filter error on initial load.
    isInitialFilterLoad.value = true
    refreshSequence()
  },
)
```

#### Initial mount

Add `refreshSequence()` to the existing `onMounted` (line 476–484). The first run uses `checkInclusion = false` so direct-navigating to a customer that happens to fall outside the filter does **not** auto-fire the error message — the spec only triggers the error when the user actively updates the filter on the detail page. The `isInitialFilterLoad` flag does this gating.

#### Buttons in the template

Insert a CTA wrapper at the top of `<div class="customer-page">`, right of the back link, mirroring the Figma layout:

```vue
<div class="customer-page__top">
  <BaseBackButton
    v-if="!hasLoadError"
    to="/customers"
    label="Back to Customers"
    class="customer-back"
  />
  <div
    v-if="!hasLoadError"
    class="customer-page__cta"
  >
    <CustomerFilterButton />
    <div class="customer-page__nav">
      <Button
        outlined
        severity="secondary"
        size="small"
        icon="pi pi-chevron-left"
        class="customer-page__nav-btn"
        aria-label="Previous customer"
        :disabled="!previousSapId"
        @click="goToPrevious"
      />
      <Button
        outlined
        severity="secondary"
        size="small"
        icon="pi pi-chevron-right"
        class="customer-page__nav-btn"
        aria-label="Next customer"
        :disabled="!nextSapId"
        @click="goToNext"
      />
    </div>
  </div>
</div>
```

```ts
function goToPrevious() {
  if (previousSapId.value) navigateTo(`/customers/${previousSapId.value}`)
}
function goToNext() {
  if (nextSapId.value) navigateTo(`/customers/${nextSapId.value}`)
}
```

The existing `Error500` and `<Message v-if="loadError">` blocks (lines 513–521) stay where they are — the `loadError` Message will surface our new "isn't available from filtered data" string automatically.

### Styles for the detail-page CTA bar (scoped, mobile-first)

```css
.customer-page__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-3);
}

.customer-page__cta {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

.customer-page__nav {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
}

:deep(.customer-page__nav-btn.p-button) {
    aspect-ratio: 1;
    width: var(--p-button-sm-height, auto);
    padding-inline: 0;
    background: var(--p-surface-0);
    color: var(--p-gray-500);
    border-color: var(--p-surface-300);
}

:deep(.customer-page__nav-btn.p-button:disabled) {
    opacity: var(--p-disabled-opacity);
}
```

All values via tokens. Per `13-mobile-first.md` the layout has no width-specific override at the base; mobile and desktop both use the same flex row. If the CTA wraps awkwardly on narrow viewports the rule is added inside the same class block via `@media (min-width: 768px)`. No `@media (max-width: …)`.

### Directus call shape for the sequence

`useBusinessPartners().fetchBusinessPartners` (lines 248–271) accepts the existing options. The sequence call passes:

```ts
{
  relationshipType: 'customer',
  fields: ['sap_id', 'name'],
  sort: ['sap_id'],          // or '-sap_id', or whatever sortField/order build to
  statusValues: filterStore.selectedStatuses.length ? filterStore.selectedStatuses : null,
  userCreatedIds: filterStore.selectedAccountManagerIds.length ? filterStore.selectedAccountManagerIds : null,
  limit: -1,
  page: 1,
}
```

`limit: -1` returns all matching rows. With ~thousands of customer rows and only two string fields each, the response is small (estimate <500 KB even for 10k rows). No new endpoint needed. Verified `business_partners.user_created` is filterable via `_in` (already used by landing page).

### Behavioral matrix

| Scenario | Expected outcome |
| --- | --- |
| Land directly on detail page, filter has Active default, customer is Active | Sequence fetched, neighbors computed; if customer is first in list → prev disabled; if last → next disabled. |
| Land directly on detail page, customer is *not* in current filter | Sequence fetched; sequenceIndex = -1; both prev/next disabled. **No `loadError`** (initial load). |
| User changes filter on detail page; customer still in filter | Sequence refetched; neighbors update. No error. |
| User changes filter on detail page; customer no longer in filter | Sequence refetched; sequenceIndex = -1; `loadError = "Customer <sap_id> isn't available from filtered data"`. Page body hides; back button stays visible. |
| User clicks Next/Previous | `navigateTo('/customers/<neighborSapId>')`; route watcher in `[id].vue` (lines 469–474) fires `loadCustomer()`; sequenceIndex updates because `route.params.id` is reactive. |
| User clicks Next then immediately Previous | Two route changes; the second arrives back at the original customer; sequence is unchanged so the trip is O(1). |
| User changes sort on landing page, returns, navigates into a customer | Detail page sees new `sortField`/`sortOrder` from the store; `ensureSequenceLoaded` keys differently and refetches; neighbors reflect new sort. |
| User clears filter (badge × hover) on detail page | Same as filter change — refetch sequence; if the customer was excluded by old filter it now appears (no error). |

## Specific Actions

1. **Create `app/stores/customerFilter.ts`** with the state, getters, and actions described above (`selectedStatuses`, `selectedAccountManagerIds`, `sortField`, `sortOrder`, `sequence`, `sequenceKey`, `isSequenceLoading`, `setStatuses`, `setAccountManagerIds`, `setSort`, `clearAll`, `invalidateSequence`, `ensureSequenceLoaded`, `totalFilterCount` getter). Default `selectedStatuses: ['active']` to preserve the current landing-page default.
2. **Create `app/components/CustomerFilterButton.vue`** by extracting the inline filter UI from `Customers/Index.vue` (template ~lines 367–391 + 606–726 + scoped styles ~lines 814–960). Replace local `selectedStatuses` / `selectedAccountManagerIds` v-models with computed-property mirrors of `useCustomerFilterStore`. Keep `STATUS_OPTIONS`, `filterBy`, account-manager lazy load, badge clear-on-hover, root/status/manager view branching exactly as today. Re-namespace BEM class roots from `customers-page__filter-*` / `customers-filter__*` to `customer-filter-button__*` and re-namespace the popover content classes likewise.
3. **Update `app/pages/Customers/Index.vue`:**
   - Replace the inline filter trigger + `<Popover>` block with `<CustomerFilterButton />`.
   - Remove now-unused refs/imports (`filterPopoverRef`, `filterBy`, account-manager state, lazy loader, badge handlers, `STATUS_OPTIONS`, `useDirectusUsers`, `useAssetUrl`, `totalFilterCount`).
   - Bind the filter and sort consumers (`loadCustomers`, watcher, `buildSortParam`, `handleSort`) to `useCustomerFilterStore` instead of local refs. The watcher additionally calls `filterStore.invalidateSequence()` so the next detail-page visit refetches.
   - Drop `selectedStatuses` / `selectedAccountManagerIds` from the `useTableStateRestore` parameter object.
4. **Update `app/composables/useTableStateRestore.ts`** to remove the optional `selectedStatuses` / `selectedAccountManagerIds` refs from `TableRefs` and stop reading/writing them in the cache compare. Read filter values directly from `useCustomerFilterStore` if cache validation needs them; otherwise the existing `searchQuery` parity check is enough — the cache is invalidated by the landing page's filter watcher anyway.
5. **Update `app/stores/tableState.ts`** to drop `selectedStatuses` and `selectedAccountManagerIds` from `TableStateEntry` (and update the `saveTableState` payload type accordingly). No migration concerns — Pinia is in-memory only.
6. **Update `app/pages/Customers/[id].vue`:**
   - Add `const filterStore = useCustomerFilterStore()` to script setup.
   - Add `sequenceIndex`, `previousSapId`, `nextSapId` computeds.
   - Add `refreshSequence({ checkInclusion })` async helper that calls `filterStore.ensureSequenceLoaded()` and toggles the not-in-filter `loadError` per the spec.
   - Add `goToPrevious()` / `goToNext()` handlers that `navigateTo` the neighbor sap-id.
   - Add a watcher on `[selectedStatuses, selectedAccountManagerIds, sortField, sortOrder]` that invalidates the sequence, refetches it, and (after the initial load) sets `loadError` if the current customer falls outside the result.
   - Add `isInitialFilterLoad` ref so the very first invocation of the watcher (which fires once when refs are first observed) doesn't false-positive into an error.
   - Add `refreshSequence()` to `onMounted` (with `checkInclusion = false`).
   - Augment the existing `route.params.id` watcher to reset `isInitialFilterLoad = true` and call `refreshSequence()` so neighbors update across customer-to-customer navigation.
7. **Add the CTA bar in the detail-page template:** wrap the existing `<BaseBackButton>` plus a new `.customer-page__cta` containing `<CustomerFilterButton />` and the prev/next `<Button>` pair inside a `.customer-page__top` flex row. Apply `:disabled="!previousSapId"` / `:disabled="!nextSapId"`. Use `pi pi-chevron-left` / `pi pi-chevron-right` icons. `aria-label="Previous customer"` / `"Next customer"`.
8. **Add scoped styles in `[id].vue`:** `.customer-page__top`, `.customer-page__cta`, `.customer-page__nav`, `:deep(.customer-page__nav-btn.p-button)`. All values via `var(--p-*)` tokens. Mobile-first; no `max-width`. The existing `.customer-back` mobile-hide rule (lines 1234–1240) stays — but consider whether the back button should now be visible on mobile too because the CTA bar implies the user is always at the top. Confirm with user (Possible Blockers).
9. **Verify `loadError` rendering:** Ensure the existing `<Message v-if="loadError" severity="error" :closable="false">` block at lines 515–521 is the only display surface. The new error string must not be cleared by `loadCustomer({ silent: true })`-style reloads (silent path is fine — `loadError` is only reset when `!silent`). When the user navigates to a different customer that *is* in the filter, `route.params.id` watcher already fires `loadCustomer()` which clears `loadError`. Add a manual `loadError.value = null` reset inside `refreshSequence` whenever the new customer is in the filter (handled in the helper above).
10. **Pre-commit checks:**
    - `grep -rnE "@media[^{]*max-width" app/pages/Customers/\[id\].vue app/components/CustomerFilterButton.vue app/stores/customerFilter.ts` → 0 hits.
    - `grep -rnE "^@media" app/pages/Customers/\[id\].vue app/components/CustomerFilterButton.vue` → 0 hits (every `@media` nested inside a class block).
    - No raw color/spacing values introduced.
11. **Smoke-verify in browser** at 360 / 768 / 1024 / 1440:
    - Land on `/customers` with default Active filter → table shows Active customers, badge shows `1`.
    - Open a customer → detail page shows back button + filter button (badge `1`) + chevron buttons.
    - Click Next repeatedly → walks customers in `sap_id` ascending order until last (Next becomes disabled).
    - Click Previous from middle → walks back; first customer disables Previous.
    - On detail page, change filter to Inactive only → customer (Active) is filtered out → `Message` renders `Customer ABC isn't available from filtered data`; both nav buttons disabled.
    - Click Back to Customers → landing page shows Inactive customers (filter persisted via store), badge `1`.
    - Sort by Company Name on landing page → click a customer → on detail, click Next → walks alphabetically. Confirm sort survives via store.
    - Direct-navigate to `/customers/<active-sap-id>` from URL → no error even if filter store has Inactive (initial-load suppression).
    - Direct-navigate to `/customers/<inactive-sap-id>` while filter has only Active → no error on initial load, but Next/Prev are both disabled (sequence index = -1).
    - Verify infinite scroll on landing page still works after filter changes from detail page.
12. **Confirm `npm run dev` boots clean and `npm run build` passes.**

## Possible Blockers

- **`useTableStateRestore` cache compatibility.** The current cache entry includes `selectedStatuses` / `selectedAccountManagerIds`. Removing them changes the entry shape; in-memory caches reset on full reload but not on HMR — confirm there is no on-disk persistence layer in `tableState` (`tableState.ts:1–50` shows pure in-memory; safe). One alternative: keep the fields as `string[]` no-ops in the entry for one cycle to avoid breaking any in-flight branches' caches mid-deploy. Recommend the clean removal.
- **Sequence size at scale.** `limit: -1` returns every matching customer's `sap_id` + `name`. With ~10k customers per filter slice this is ~600 KB of JSON. Acceptable v1 (HVAC/manufacturing customer counts are typically lower). If we ever hit 50k+, the sequence call should switch to `aggregate: { count: ['*'] }` plus a paginated index lookup, or to a fields=['sap_id'] only call (drop `name`). Today `name` is included in case we want to render "Next: <name>" tooltips later — drop if memory matters.
- **Initial-load false positive.** The plan uses `isInitialFilterLoad` to suppress the not-in-filter error on first mount, including direct-navigation cases. This matches the user spec ("when user is on details page and **updates** the filter") but is fragile if the watcher fires more than once at startup (Pinia reactivity edge cases). Mitigation: gate via a "mountTime done" flag set inside `onMounted` after `await refreshSequence()`. Confirm preferred mechanism.
- **Filter button placement on mobile.** The detail page currently hides the back button below 768px (`[id].vue:1234–1240`). The new CTA bar surfaces the filter + prev/next buttons; if the back button is the only thing in `.customer-page__top` left half on desktop and is hidden on mobile, the CTA bar will right-align awkwardly. Either (a) keep back hidden on mobile and let `.customer-page__top` use `justify-content: flex-end` on mobile, or (b) make the back button visible on mobile too now that the page has a clear toolbar. Confirm with user.
- **Outlined-secondary chevron styling.** Figma spec uses 35px square outlined buttons with gray border `#d4d6d8` and `pi pi-chevron-left/right` 14px icon. The plan's `:deep(.customer-page__nav-btn.p-button)` styling targets `--p-surface-300` for border (which maps to gray-300 via `semantic.js`). Verify the resulting hue against Figma at review; if off, swap to `--p-gray-200` or expose a new component token.
- **`pi pi-chevron-left`/`right` icon only.** PrimeVue's `Button` `icon` prop renders the icon centered with no label — verify a square aspect ratio actually renders 35×35 (PrimeVue 4 sometimes adds horizontal padding even icon-only). If padding leaks, override via `padding-inline: 0` (already in plan) and explicit `width`/`height` tokens.
- **`route.params.id` watcher infinite-loop risk.** When `goToNext` triggers a route change, the existing watcher (lines 469–474) calls `loadCustomer()`. Our new code adds `refreshSequence()` to the same path. If `refreshSequence` mutates the store and the filter watcher re-fires `refreshSequence` again, infinite loops are possible. Mitigation: `refreshSequence` is idempotent given the same `sequenceKey`; the filter watcher only invalidates+refetches when filter or sort actually changed; `route.params.id` change does NOT invalidate the sequence. Confirmed safe.
- **Sequence freshness vs. row-level edits.** If the user edits a customer (changes name, deactivates) the sequence may go stale. The store invalidates on filter/sort change but not on row mutation. Acceptable for v1 (the user can always click back to landing to refresh). If staleness becomes an issue, expose a `filterStore.invalidateSequence()` call from edit-completion handlers.
- **Suppliers parity.** Suppliers landing page (`app/pages/Suppliers/Index.vue`) does not yet use the filter UX, and has no detail page in scope. Out of scope here — but the new `customerFilter` store name is intentionally customer-specific; if the same pattern is later wanted for Suppliers, factor a `useBusinessPartnerFilterStore(routeKey)` factory. Out of scope for this plan.
- **`useCustomerFilterStore` auto-import.** Pinia stores under `app/stores/` are auto-imported by Nuxt. Confirm by reading any existing store usage (`useSearchStore`, `useTableStateStore`) — yes, both already used without explicit import. Safe.
- **Default `['active']` in store creates a perceived global default.** Today's landing page resets that default each mount. With the store, the default sticks across the session. The user's explicit requirement is filter-syncing, so this is desired. Flag in case product wants per-route reset behavior.
- **Existing `loadError` reset.** `loadCustomer()` resets `loadError = null` at the start of a non-silent load (`[id].vue:228–230`). When a navigation fires after the user clicks Next while error is showing, the new customer's load will clear the message — confirmed correct. The only path that needs explicit reset is the filter-changed-back-into-the-set case, handled in `refreshSequence`'s success branch.
