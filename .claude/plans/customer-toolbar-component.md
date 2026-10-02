# Plan: Customer Toolbar — Unify Filter Button + Prev/Next into One Component

**Created:** 2026-04-30
**Status:** Draft — Pending Review
**Task:** Replace `CustomerFilterButton.vue` with a single domain component `CustomerToolbar.vue` that renders the filter button on the landing page and adds the prev/next chevron buttons on the detail page. Pulls the prev/next logic out of `Customers/[id].vue` so the page is leaner.

---

## Context

`app/components/CustomerFilterButton.vue` was just extracted to share the filter UX between the landing and detail pages. The detail page (`Customers/[id].vue`) additionally renders prev/next chevron buttons inline — see `[id].vue` lines 285–294 (`goToPrevious`/`goToNext`), 186–196 (`sequenceIndex`/`previousSapId`/`nextSapId`), 580–605 (CTA template), 1322–1357 (CSS).

That layout is brittle:

- Landing and detail pages each lay out the same filter button next to different siblings, inviting drift.
- The detail page mixes UI (prev/next buttons) with state plumbing (`refreshSequence`, `previousSapId`, `nextSapId`, `goToPrevious`, `goToNext`).
- The Figma CTA group (`3294:33261`) treats filter + prev + next as one cluster — splitting them fights the design intent.

A single `CustomerToolbar.vue` consolidates the filter trigger and the optional navigation pair behind a `showNavigation` prop. `[id].vue` only keeps the `loadError` decision (which depends on page-local `isInitialFilterLoad` gating) — everything else moves into the component.

## High Level Plan

`CustomerToolbar.vue` is a customer-domain component (not a `Base*` — its popover content is HVAC-customer-specific via `useCustomerFilterStore`, `useDirectusUsers`, status semantics). It absorbs the entire body of `CustomerFilterButton.vue` plus the prev/next buttons, click handlers, neighbor computation, and the `ensureSequenceLoaded()` trigger.

The component takes one prop: `showNavigation: boolean` (default `false`). When false (landing page), it renders just the filter button. When true (detail page), it additionally renders the prev/next pair styled per Figma. Internally it reads `useCustomerFilterStore`, `useRoute`, `useDirectusUsers`, `useAssetUrl` — all already auto-imported.

`[id].vue` no longer owns prev/next state. It still owns the filter watcher because that watcher writes to the page-local `loadError` ref (which the toolbar shouldn't know about), but the watcher body shrinks to: invalidate the sequence, await `filterStore.ensureSequenceLoaded()`, then evaluate inclusion and set/clear `loadError`. The toolbar and the page both call `ensureSequenceLoaded()` — that's safe because the store dedupes by key (current request-id pattern in `customerFilter.ts:79–92`).

`Customers/Index.vue` swaps `<CustomerFilterButton />` for `<CustomerToolbar />` (no prop change needed — `showNavigation` defaults to false).

`CustomerFilterButton.vue` is deleted.

## Low Level Description

### Files

| File | Change |
| --- | --- |
| `app/components/CustomerToolbar.vue` | NEW — supersedes `CustomerFilterButton.vue` and absorbs prev/next from `[id].vue`. |
| `app/components/CustomerFilterButton.vue` | DELETE — fully superseded. |
| `app/pages/Customers/Index.vue` | Replace `<CustomerFilterButton />` with `<CustomerToolbar />` (one tag rename). |
| `app/pages/Customers/[id].vue` | Remove prev/next refs, computeds, handlers, template, and CSS; render `<CustomerToolbar :show-navigation="true" />`; keep the filter watcher but simplify its body (no separate `refreshSequence` helper needed). |

### `CustomerToolbar.vue` shape

```vue
<script setup lang="ts">
interface Props {
  showNavigation?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  showNavigation: false,
})

const filterStore = useCustomerFilterStore()
const route = useRoute()
const { fetchAccountManagers } = useDirectusUsers()
const { getAssetUrl } = useAssetUrl()

// ── Filter popover state (lifted verbatim from CustomerFilterButton.vue) ──
type FilterBy = 'root' | 'status' | 'accountManager'
const STATUS_OPTIONS = [...]
const filterPopoverRef = ref<any>(null)
const filterBy = ref<FilterBy>('root')
const accountManagers = ref<...>([])
const isAccountManagersLoading = ref(false)
let accountManagersLoaded = false
const selectedStatuses = computed({...})
const selectedAccountManagerIds = computed({...})
const totalFilterCount = computed(() => filterStore.totalFilterCount)
async function ensureAccountManagersLoaded() { ... }
function handleFilterButtonClick(event) { ... }
function selectFilterBy(value) { ... }
function isBadgeClick(event) { ... }
function handleHeaderBadgeClick(event) { ... }
function handleFilterRowClick(event, dimension) { ... }

// ── Navigation state (only when showNavigation) ───────────────────────────
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

function goToPrevious() {
  if (previousSapId.value) { navigateTo(`/customers/${previousSapId.value}`) }
}
function goToNext() {
  if (nextSapId.value) { navigateTo(`/customers/${nextSapId.value}`) }
}

// Sequence is fetched on demand. Filter/sort changes invalidate + refetch.
if (props.showNavigation) {
  onMounted(() => {
    filterStore.ensureSequenceLoaded()
  })

  watch(
    () => route.params.id,
    () => filterStore.ensureSequenceLoaded(),
  )

  watch(
    [
      () => filterStore.selectedStatuses,
      () => filterStore.selectedAccountManagerIds,
      () => filterStore.sortField,
      () => filterStore.sortOrder,
    ],
    () => {
      filterStore.invalidateSequence()
      filterStore.ensureSequenceLoaded()
    },
    { deep: true },
  )
}
</script>

<template>
  <div class="customer-toolbar">
    <OverlayBadge ...>
      <Button outlined size="small" icon="pi pi-filter" ... />
    </OverlayBadge>

    <div
      v-if="showNavigation"
      class="customer-toolbar__nav"
    >
      <Button
        outlined
        severity="secondary"
        size="small"
        icon="pi pi-chevron-left"
        :disabled="!previousSapId"
        @click="goToPrevious"
      />
      <Button
        outlined
        severity="secondary"
        size="small"
        icon="pi pi-chevron-right"
        :disabled="!nextSapId"
        @click="goToNext"
      />
    </div>

    <Popover ref="filterPopoverRef" ...>
      <!-- root / status / accountManager views, identical to CustomerFilterButton today -->
    </Popover>
  </div>
</template>
```

The `<Popover>` body (root / Status / Account Manager views), the badge clear-on-hover styles, and all `customer-filter-button__*` classes are renamed to `customer-toolbar__*` and pasted verbatim. No behavioral changes to the popover itself.

### Updated `[id].vue`

Removed:
- `isInitialFilterLoad` stays — needed for `loadError` gating.
- `sequenceIndex`, `previousSapId`, `nextSapId` computeds — DELETED (moved into toolbar).
- `goToPrevious`, `goToNext` — DELETED.
- `refreshSequence` helper — replaced inline inside the watcher.
- The CTA template chunk for prev/next buttons — DELETED (the toolbar renders them).
- The CSS for `.customer-page__nav` and `.customer-page__nav-btn` — DELETED (moved into toolbar's scoped style).

Kept and simplified:
```ts
const isInitialFilterLoad = ref(true)

watch(
  [
    () => filterStore.selectedStatuses,
    () => filterStore.selectedAccountManagerIds,
    () => filterStore.sortField,
    () => filterStore.sortOrder,
  ],
  async () => {
    const wasInitial = isInitialFilterLoad.value
    isInitialFilterLoad.value = false
    if (wasInitial) { return }

    filterStore.invalidateSequence()
    await filterStore.ensureSequenceLoaded()
    const currentSapId = String(route.params.id)
    const inFilter = filterStore.sequence.some((entry) => entry.sapId === currentSapId)
    if (!inFilter && filterStore.sequence.length > 0) {
      loadError.value = `Customer ${currentSapId} isn't available from filtered data`
    } else if (loadError.value === `Customer ${currentSapId} isn't available from filtered data`) {
      loadError.value = null
    }
  },
  { deep: true },
)

watch(
  () => route.params.id,
  () => {
    isInitialFilterLoad.value = true
    loadCustomer()
  },
)

onMounted(() => {
  loadCustomer()
  // Toolbar handles ensureSequenceLoaded() on its own mount.
  isInitialFilterLoad.value = false
  // ... existing scroll listener code
})
```

The page no longer needs to call `filterStore.ensureSequenceLoaded()` directly on mount — the toolbar (mounted as a child) does that. Both filters' awaited fetches use the same store and the same key-deduped action, so no extra requests.

The CTA template block becomes:
```vue
<div
  v-if="!hasLoadError"
  class="customer-page__top"
>
  <BaseBackButton
    to="/customers"
    label="Back to Customers"
    class="customer-back"
  />
  <CustomerToolbar :show-navigation="true" />
</div>
```

`.customer-page__cta` wrapper is dropped (toolbar is now a single element). `.customer-page__top` keeps `display: flex; justify-content: space-between` so the toolbar stays right-aligned when the back button is hidden on mobile.

### Updated `Customers/Index.vue`

```vue
<div class="customers-page__header-actions">
  <CustomerToolbar />
  <NuxtLink to="/customers/create">
    <Button label="New" icon="pi pi-plus" size="small" />
  </NuxtLink>
</div>
```

Drop the script-setup `import` (no manual import needed — components in `app/components/` are auto-imported by Nuxt).

### Styles

`CustomerToolbar.vue` scoped styles include:

- `.customer-toolbar` — `display: inline-flex; align-items: center; gap: var(--p-spacing-3);` so filter + nav share one row.
- `.customer-toolbar__nav` — `display: flex; align-items: center; gap: var(--p-spacing-1);`
- `:deep(.customer-toolbar__filter-btn.p-button)` — sky-blue outlined (current `customer-filter-button__btn` styling).
- `:deep(.customer-toolbar__nav-btn.p-button)` — secondary outlined gray (current `.customer-page__nav-btn` styling lifted from `[id].vue:1340–1351`).
- All popover, badge clear-on-hover, account-manager option styles — copied verbatim with the new BEM root.
- All values via `var(--p-*)` tokens. Mobile-first; nested `@media (min-width: ...)` only.

## Specific Actions

1. **Create `app/components/CustomerToolbar.vue`** by copying `app/components/CustomerFilterButton.vue` whole, then:
   - Add `interface Props { showNavigation?: boolean }` with default `false`.
   - Add `useRoute()` binding.
   - Add `sequenceIndex`, `previousSapId`, `nextSapId` computeds.
   - Add `goToPrevious`, `goToNext` handlers.
   - Add the `if (props.showNavigation)` block with `onMounted` + filter/sort watcher + route.params.id watcher (each calling `filterStore.ensureSequenceLoaded()` / `invalidateSequence()`).
   - Add the prev/next `<Button>` markup wrapped in `<div v-if="showNavigation" class="customer-toolbar__nav">` placed between the filter `<OverlayBadge>` and the `<Popover>` so the visual order matches Figma (filter, nav, popover floats anywhere).
   - Rename all `customer-filter-button__*` BEM classes to `customer-toolbar__*` (filter button class becomes `customer-toolbar__filter-btn`, badge becomes `customer-toolbar__filter-badge`, etc.).
   - Append the navigation styles (`.customer-toolbar__nav`, `:deep(.customer-toolbar__nav-btn.p-button)`).
2. **Delete `app/components/CustomerFilterButton.vue`.**
3. **Update `app/pages/Customers/Index.vue`** — single tag rename: `<CustomerFilterButton />` → `<CustomerToolbar />`.
4. **Update `app/pages/Customers/[id].vue`:**
   - Delete `sequenceIndex`, `previousSapId`, `nextSapId` computeds.
   - Delete `goToPrevious`, `goToNext` handlers.
   - Delete `refreshSequence` helper (or replace with the inline body inside the watcher per the snippet above).
   - Delete the previous/next `<Button>` markup from the CTA bar template.
   - Delete the `.customer-page__cta`, `.customer-page__nav`, `.customer-page__nav-btn` CSS rules (the inner toolbar carries its own).
   - Replace the prev/next + filter siblings with a single `<CustomerToolbar :show-navigation="true" />` next to `<BaseBackButton>` inside `.customer-page__top`.
   - Keep `isInitialFilterLoad`, the filter watcher (with the inlined inclusion check), and the route-id watcher resetting `isInitialFilterLoad`.
   - Drop the explicit `refreshSequence()` call in `onMounted` (the toolbar handles it).
5. **Pre-commit checks:**
   - `grep -rnE "@media[^{]*max-width" app/components/CustomerToolbar.vue app/pages/Customers/Index.vue app/pages/Customers/\[id\].vue` → 0 hits.
   - `grep -rnE "^@media" app/components/CustomerToolbar.vue app/pages/Customers/Index.vue app/pages/Customers/\[id\].vue` → 0 hits.
   - `grep -rn "CustomerFilterButton" app/` → 0 hits (component fully removed).
6. **`npm run typecheck`** clean; **`npm run build`** passes; **`npm run dev`** boots clean.
7. **Browser smoke** at 360 / 768 / 1024 / 1440:
   - Landing page: filter button renders alone (no nav buttons).
   - Detail page: toolbar shows filter + prev + next as one cluster.
   - Prev/next walk the filtered, sorted customer sequence; correct disabling at boundaries.
   - Filter change on detail page → if customer excluded, `loadError` Message renders the spec'd string; nav buttons disabled.
   - Filter change on detail page that re-includes the customer → error clears.
   - Direct-navigate to a customer outside current filter → no error on first mount; nav disabled.
   - Filter change on landing page → table refreshes and badge count updates as today.

## Possible Blockers

- **Toolbar unmount on filter change.** The component's filter+sort watcher inside `if (props.showNavigation)` is created at setup time. If the page navigates between detail and landing, the toolbar is destroyed/recreated; watchers tear down cleanly. No leak.
- **Double `ensureSequenceLoaded()` calls.** Both the toolbar (on mount) and the page (in its filter watcher, when filter actually changes) call the action. The store's request-id pattern in `customerFilter.ts:79` already supersedes prior in-flight calls — this is safe and idempotent.
- **`isInitialFilterLoad` semantics.** Today the page sets `isInitialFilterLoad = false` after `refreshSequence()` resolves in `onMounted`. With sequence loading moved to the toolbar, the page can flip the flag synchronously after `loadCustomer()` returns. Risk: if the user's first interaction is a filter change *before* `loadCustomer` resolves (unlikely in practice — happens in <1s), the watcher would skip the inclusion check. Acceptable; matches today's gating intent ("don't false-positive on first mount").
- **`useRoute()` inside the toolbar.** Components in `app/components/` are mounted inside the page; `useRoute()` is auto-imported and works identically. Confirmed by `BaseBackButton.vue:11` which already uses `useRouter()` in the same component layer.
- **Visual order of filter vs prev/next.** Figma CTA group order is filter → prev → next. The toolbar template must place `<OverlayBadge>` (filter) before `<div class="customer-toolbar__nav">` to preserve that order on the detail page. Landing page only renders the filter, so order is moot there.
- **CSS specificity for the secondary chevrons.** The toolbar style targets `:deep(.customer-toolbar__nav-btn.p-button)`. PrimeVue's outlined+secondary combo may add `.p-button-outlined.p-button-secondary` classes; the override should still apply due to specificity from the chained class selector. Verify in browser — if the gray border doesn't match Figma `#d4d6d8`, swap `--p-surface-300` to `--p-gray-200`.
- **`[id].vue` mobile layout when back is hidden.** With back hidden < 768px, `.customer-page__top` becomes a single child (the toolbar). `justify-content: space-between` collapses harmlessly — the toolbar sits left-edge or wraps depending on flex context. If the visual target is "right-aligned toolbar on mobile too", add `margin-left: auto` to `.customer-toolbar` inside `.customer-page__top` — confirm during smoke.
- **Toolbar re-extraction risk.** The toolbar is now customer-specific. If Suppliers later wants the same UX, refactor by introducing a `BaseFilterButton.vue` (slot-based) and a `BaseRecordNavigator.vue` (props/events-based) and recompose. Out of scope here — but flag as predictable follow-up.
- **`CustomerFilterButton.vue` references in any tests.** The project has no Vitest tests in tree right now (`tests/` does not exist). Nothing to update.
