# Plan: Customers Landing Page — Status & Account Manager Filter

**Created:** 2026-04-29
**Status:** Draft — Pending Review
**Task:** Add a server-side filter button to `app/pages/Customers/Index.vue` that opens a PrimeVue `Popover` with two filterable dimensions — **Status** (active/inactive multi-select) and **Account Manager** (`directus_users` multi-select keyed by `business_partners.user_created`) — with an `OverlayBadge` showing total selection count, and a default "Active" status filter applied on first paint.

---

## High Level Plan

The customers landing page (`app/pages/Customers/Index.vue`) currently fetches `business_partners` server-side via `useBusinessPartners().fetchBusinessPartners({ relationshipType: 'customer', ... })` with text search, sort, and infinite-scroll pagination wired through `loadCustomers()`. Filter state must compose into the **server-side** Directus query alongside the existing search/sort/page parameters so paginated results stay accurate (client-side filtering would break pagination + the row count badge in `BaseDataTableFooterLoader`). The plan therefore extends `useBusinessPartners` to accept `statusValues: string[]` and `userCreatedIds: string[]`, builds them into the `_in` filter clauses, and re-runs `loadCustomers(1, ...)` whenever the filter selection changes.

The trigger sits in the page header next to the existing "New" button. Per the user's spec the filter button is placed **to the left** of "New" — square, outlined, sky-blue per Figma node `3567:45917` (filter funnel icon = `pi pi-filter`). It is wrapped in `OverlayBadge` whose `:value` is the running total of selected items across both dimensions; the badge is hidden via a CSS modifier (mirroring the `SectionContacts` pattern at `app/components/SectionContacts.vue:341`) when count is `0`. On click, `popoverRef.toggle($event)` opens a `Popover` whose body switches between three views driven by a `selectedFilterBy` ref: **(1)** initial "Filter by" list with `Status` and `Account Manager` rows; **(2)** Status view — `Filter by Status` header row + a "Select Status" `MultiSelect` with custom `option` slot rendering checkbox + colored Tag (Figma `3721:37796`); **(3)** Account Manager view — `Filter by Account Manager` header row + a "Account Manager" `MultiSelect` with `option` slot rendering checkbox + 28px circular avatar + name (Figma `3721:37835`). A small "back" affordance on the secondary views returns to the root list. Selection commits live (no Apply/Cancel button), matching both Figma intent and the established `SectionContacts` convention.

By default, on initial page load the page seeds `selectedStatuses.value = ['active']` so customers are filtered to Active out of the gate, which makes the `OverlayBadge` display **1** immediately and the DataTable show only active customers — explicitly required by the user. Account Manager options are pulled lazily (first time the popover opens) from `/users` via a new `useDirectusUsers` composable, requesting only `id`, `first_name`, `last_name`, `avatar`, `status`, filtered to `status: 'active'` so suspended/archived accounts don't pollute the list. Avatar URLs are built through the existing `useAssetUrl().getAssetUrl(avatarFileId, { width: 56, height: 56, fit: 'cover', format: 'auto' })` helper and resolved up-front so the popover renders synchronously after the user opens it.

This is a **Phase 3 (functionality wiring + UI)** change in the same PR — UI and Directus wiring land together because the filter has no useful behavior without server params, and the user's spec ties the two together (default Active filter on load). The new filter popover content stays inline in `Index.vue` for v1; if Suppliers needs the same UI later, extract to a `BusinessPartnerFilterPopover` component (deferred per `11-ui-first-workflow.md`'s 2+-consumer rule).

## Low Level Description

### Files touched

| File | Change |
| --- | --- |
| `app/pages/Customers/Index.vue` | Add filter button + popover + state + reactive load wiring. |
| `app/composables/useBusinessPartners.ts` | Extend `FetchBusinessPartnersOptions`, `BuildPartnerFilterOptions`, and `buildPartnerFilter()` to support `statusValues: string[] \| null` and `userCreatedIds: string[] \| null` via `_in` operators. |
| `app/composables/useDirectusUsers.ts` (NEW) | Thin composable wrapping `useDirectusCrud('directus_users')` exposing `fetchAccountManagers()` returning `{ id, first_name, last_name, avatar, status }`. |

No new components in v1. Suppliers page (`app/pages/Suppliers/Index.vue`) is not changed — out of scope per the user's brief, but the composable changes are written generically so Suppliers can opt-in later.

### Directus schema confirmation (via MCP)

`business_partners.user_created` exists as `uuid` (m2o → `directus_users`), `readonly`. `directus_users` exposes `id` (uuid PK), `first_name`, `last_name`, `avatar` (uuid → `directus_files`), `status` (`draft|invited|unverified|active|suspended|archived`). The Customers list query (`CUSTOMER_LIST_FIELDS` in `app/pages/Customers/Index.vue:53`) does **not** currently fetch `user_created`; we don't need it on the row to *filter* by it (filtering happens server-side), but we do need it on the row only if a follow-up surfaces an Account Manager column. Out of scope for this plan — confirm.

### State additions in `Index.vue`

```ts
const filterPopoverRef = ref<any>(null)
type FilterBy = 'root' | 'status' | 'accountManager'
const filterBy = ref<FilterBy>('root')

const selectedStatuses = ref<string[]>(['active'])           // default: Active
const selectedAccountManagerIds = ref<string[]>([])

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

const accountManagers = ref<Array<{ id: string, name: string, avatarUrl: string | null }>>([])
const isAccountManagersLoading = ref(false)
let accountManagersLoaded = false

const totalFilterCount = computed(
  () => selectedStatuses.value.length + selectedAccountManagerIds.value.length,
)
```

### `useBusinessPartners` changes

Existing `buildPartnerFilter` (lines 218–236) only handles single `status` and `relationshipType`. Replace `status` handling with a multi-value `statusValues` clause and add `userCreatedIds` clause:

```ts
interface BuildPartnerFilterOptions {
  relationshipType?: string | null
  statusValues?: string[] | null
  userCreatedIds?: string[] | null
}

function buildPartnerFilter(options: BuildPartnerFilterOptions = {}) {
  const { relationshipType = null, statusValues = null, userCreatedIds = null } = options
  const conditions: Record<string, unknown>[] = []

  if (relationshipType) {
    conditions.push({ relationship_type: { _eq: relationshipType } })
  }
  if (statusValues && statusValues.length) {
    conditions.push({ status: { _in: statusValues } })
  }
  if (userCreatedIds && userCreatedIds.length) {
    conditions.push({ user_created: { _in: userCreatedIds } })
  }

  if (conditions.length === 0) return null
  if (conditions.length === 1) return conditions[0]
  return { _and: conditions }
}
```

`FetchBusinessPartnersOptions` and `fetchBusinessPartnerCount` must forward the new params. Consumers that pass the legacy `status: string` keep working only if we delete the old `status` field — to avoid silent behavior changes elsewhere, **keep both**: accept legacy `status` and translate `status` → `[status]` inside `buildPartnerFilter` when `statusValues` is null. Suppliers (`app/pages/Suppliers/Index.vue:79`) currently passes neither, so it is unaffected.

### `useDirectusUsers` (new)

```ts
// app/composables/useDirectusUsers.ts
import type { TryCatchResult } from '~/types/api'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

interface DirectusUserSummary {
  id: string
  first_name: string | null
  last_name: string | null
  avatar: string | null
  status: string
}

export function useDirectusUsers() {
  const usersCrud = useDirectusCrud('directus_users')

  async function fetchAccountManagers(): Promise<TryCatchResult<DirectusUserSummary[]>> {
    return await usersCrud.fetchMany({
      fields: ['id', 'first_name', 'last_name', 'avatar', 'status'],
      filter: { status: { _eq: 'active' } },
      sort: ['first_name', 'last_name'],
      limit: -1,
    })
  }

  return { fetchAccountManagers }
}
```

`useDirectusCrud('directus_users')` works because `useDirectusCrud` already accepts dynamic collection names via `_readItems(collection, query)` — but `directus_users` is a system collection. **Possible blocker**: the SDK's generic `readItems` may not target `/users`. If so, swap to `@directus/sdk`'s `readUsers` import directly inside this composable. Verify before merging (see Possible Blockers).

### Avatar URL resolution

After `fetchAccountManagers()` returns, map each user with `useAssetUrl().getAssetUrl(user.avatar, { width: 56, height: 56, fit: 'cover', quality: 80, format: 'auto' })`. Store the resolved URL on the `accountManagers.value` items. Run resolutions in parallel via `Promise.all`. If `avatar` is null, the rendered avatar falls back to a deepblue circle with the user's initials (consistent with `ProfileCard`'s placeholder pattern — confirm style; if not present, render initials in a `<span class="account-manager__avatar-fallback">`).

### Reactivity and loading

Inside `Index.vue`:

```ts
function buildFetchOptions(page = 1, search: string | null = null) {
  return {
    relationshipType: 'customer',
    fields: CUSTOMER_LIST_FIELDS,
    deep: { contacts: { _limit: -1 } },
    limit: rowsPerPage,
    page,
    search,
    sort: buildSortParam(),
    statusValues: selectedStatuses.value.length ? selectedStatuses.value : null,
    userCreatedIds: selectedAccountManagerIds.value.length ? selectedAccountManagerIds.value : null,
  }
}
```

`loadCustomers` uses these. Add a watcher:

```ts
watch(
  [selectedStatuses, selectedAccountManagerIds],
  () => {
    tableStateStore.clearTableState('/customers')
    currentPage.value = 1
    hasMore.value = true
    loadCustomers(1, searchStore.searchQuery)
  },
  { deep: true },
)
```

The existing `searchStore.searchQuery` watcher is preserved; both watchers reset pagination identically.

`useTableStateRestore` currently caches `searchQuery` only (`app/composables/useTableStateRestore.ts:36`). For v1 it does NOT need to know about filters — when the user navigates away and back, we always re-apply current `selectedStatuses`/`selectedAccountManagerIds` and refetch. This is acceptable because the default is always Active and the user can re-select within the popover. Flagged as **Possible Blocker** — extending the cache key to include filter values is a follow-up if requested.

### Lazy account-manager fetch

```ts
async function ensureAccountManagersLoaded() {
  if (accountManagersLoaded || isAccountManagersLoading.value) return
  isAccountManagersLoading.value = true
  const { data, error } = await fetchAccountManagers()
  if (error || !data) {
    isAccountManagersLoading.value = false
    return
  }
  const { getAssetUrl } = useAssetUrl()
  const urls = await Promise.all(
    data.map((user) => getAssetUrl(user.avatar, { width: 56, height: 56, fit: 'cover', quality: 80, format: 'auto' })),
  )
  accountManagers.value = data.map((user, index) => ({
    id: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'Unnamed',
    avatarUrl: urls[index],
  }))
  accountManagersLoaded = true
  isAccountManagersLoading.value = false
}

function handleFilterButtonClick(event: Event) {
  filterBy.value = 'root'                 // always reopen on root view
  filterPopoverRef.value?.toggle(event)
}

function selectFilterBy(value: 'status' | 'accountManager') {
  filterBy.value = value
  if (value === 'accountManager') ensureAccountManagersLoaded()
}
```

### Template additions in `Index.vue`

In the page header, replace the current "New" wrapper:

```vue
<div class="customers-page__header-actions">
  <OverlayBadge
    :value="totalFilterCount"
    severity="danger"
    :class="['customers-page__filter-badge', { 'customers-page__filter-badge--hidden': totalFilterCount === 0 }]"
  >
    <Button
      outlined
      size="small"
      icon="pi pi-filter"
      class="customers-page__filter-btn"
      aria-label="Filter customers"
      @click="handleFilterButtonClick"
    />
  </OverlayBadge>
  <NuxtLink to="/customers/create">
    <Button label="New" icon="pi pi-plus" size="small" />
  </NuxtLink>
</div>
```

Then at the end of the template (sibling to `<DrawerViewContactInfo>`):

```vue
<Popover ref="filterPopoverRef" class="customers-page__filter-popover">
  <div class="customers-page__filter-popover-body">
    <!-- Root view -->
    <div v-if="filterBy === 'root'" class="customers-filter">
      <div class="customers-filter__label">Filter By</div>
      <button
        type="button"
        class="customers-filter__option"
        @click="selectFilterBy('status')"
      >Status</button>
      <button
        type="button"
        class="customers-filter__option"
        @click="selectFilterBy('accountManager')"
      >Account Manager</button>
    </div>

    <!-- Status view -->
    <div v-else-if="filterBy === 'status'" class="customers-filter">
      <button
        type="button"
        class="customers-filter__back"
        @click="filterBy = 'root'"
      >
        <i class="pi pi-chevron-left" /> Filter by Status
      </button>
      <MultiSelect
        v-model="selectedStatuses"
        :options="STATUS_OPTIONS"
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
    </div>

    <!-- Account Manager view -->
    <div v-else class="customers-filter">
      <button
        type="button"
        class="customers-filter__back"
        @click="filterBy = 'root'"
      >
        <i class="pi pi-chevron-left" /> Filter by Account Manager
      </button>
      <MultiSelect
        v-model="selectedAccountManagerIds"
        :options="accountManagers"
        option-label="name"
        option-value="id"
        :loading="isAccountManagersLoading"
        :placeholder="isAccountManagersLoading ? 'Loading…' : 'Account Manager'"
        display="comma"
        fluid
        empty-message="No active users found"
      >
        <template #option="{ option }">
          <div class="account-manager">
            <img
              v-if="option.avatarUrl"
              :src="option.avatarUrl"
              alt=""
              class="account-manager__avatar"
            />
            <span v-else class="account-manager__avatar account-manager__avatar--fallback">
              {{ option.name.charAt(0) }}
            </span>
            <span class="account-manager__name">{{ option.name }}</span>
          </div>
        </template>
      </MultiSelect>
    </div>
  </div>
</Popover>
```

The `option` slot for `MultiSelect` is *not* documented by the PrimeVue MCP (returned empty slot list) but is supported by PrimeVue 4 docs and used the same way in `app/components/SectionContacts.vue` (status filter via `Tag`s). If runtime confirms the slot does not work, fallback is custom `pt` overrides on the option row.

### Styling (per `03-css-tokens.md`, `13-mobile-first.md`)

All new styles in `<style scoped>`:

- `.customers-page__header-actions` — `display: flex; gap: var(--p-spacing-2); align-items: center;` so the filter button sits to the left of "New".
- `.customers-page__filter-btn :deep(.p-button)` — width 36px, height 36px (mirroring `SectionContacts.vue:570`), background `var(--p-surface-0)`, color/border `var(--p-skyblue-600)`. No raw values; use existing tokens only.
- `.customers-page__filter-badge--hidden :deep(.p-badge)` — `display: none` (mirrors `section-contacts__column-filter-badge--hidden` at `SectionContacts.vue:583`).
- `.customers-page__filter-popover :deep(.p-popover-content)` — padding `var(--p-spacing-3)`.
- `.customers-page__filter-popover-body` — `display: flex; flex-direction: column; gap: var(--p-spacing-3); min-width: 222px;` (Figma popover width).
- `.customers-filter`, `.customers-filter__label`, `.customers-filter__option`, `.customers-filter__back` — use `--p-font-size-sm`, `--p-deepblue-900`, `--p-spacing-*`. Buttons in the root list are `<button type="button">` styled to look like menu rows (PrimeVue does not have a native menu-row primitive that fits this layout; PrimeVue `Listbox` would be heavier than needed and lacks the chevron affordance). **Justification per `02-primevue-usage.md`**: this is a flat list of two click-to-navigate options and PrimeVue's interactive primitives (`Button`, `MenuItem`) introduce styling fight; raw `<button>` with project tokens is acceptable here for the secondary-view affordance — but if the rule is strict, use `<Button text severity="secondary">` for each option. Confirm preference with user (see Possible Blockers).
- `.account-manager` — `display: flex; align-items: center; gap: var(--p-spacing-2);`
- `.account-manager__avatar` — 28px × 28px (`var(--p-spacing-7)`), `border-radius: 50%`, `object-fit: cover`. **Add `--p-spacing-7 = 28px` to `app/presets/extend.js` if not present.**
- `.account-manager__avatar--fallback` — background `var(--p-deepblue-100)`, color `var(--p-deepblue-900)`, `display: inline-flex; align-items: center; justify-content: center;` initials uppercase.
- `.account-manager__name` — `var(--p-font-size-sm)`, `var(--p-gray-800)`.
- All breakpoints use `min-width` only, nested inside class blocks — follows `13-mobile-first.md`. No `@media (max-width: …)` for width.

### Init order & default filter

In the existing `onMounted` (line 230), the call `loadCustomers(1, searchStore.searchQuery)` already runs after the refs are initialized. Because `selectedStatuses.value = ['active']` is set as the initial ref value (above `loadCustomers` is called), the first request goes out with `statusValues: ['active']` and `OverlayBadge.value === 1` from frame zero — meets the user's requirement. No special "double-fetch" needed.

### `BaseDataTableFooterLoader` count

`totalRecords` already comes from `fetchBusinessPartnerCount`; with the new filter clauses it returns the **filtered** count, so the footer "X of Y customers" reflects the active filter automatically. No template change needed.

## Specific Actions

1. **Open `app/composables/useBusinessPartners.ts`.** Modify `BuildPartnerFilterOptions`, `FetchBusinessPartnersOptions`, and `buildPartnerFilter` to add `statusValues: string[] | null` and `userCreatedIds: string[] | null`. Translate legacy `status: string` to `statusValues: [status]` for backward compatibility. Forward both new options through `fetchBusinessPartners` and `fetchBusinessPartnerCount`.
2. **Create `app/composables/useDirectusUsers.ts`** exporting `useDirectusUsers` with `fetchAccountManagers()` that returns `{ id, first_name, last_name, avatar, status }[]`, filtered to `status: 'active'`, sorted by name, `limit: -1`. Confirm `useDirectusCrud('directus_users')` actually hits `/users` — if not, refactor to use `@directus/sdk`'s `readUsers` directly.
3. **Open `app/pages/Customers/Index.vue`.** Add the new state refs: `filterPopoverRef`, `filterBy`, `selectedStatuses` (default `['active']`), `selectedAccountManagerIds`, `accountManagers`, `isAccountManagersLoading`, `accountManagersLoaded` flag, `totalFilterCount` computed, `STATUS_OPTIONS` constant.
4. **Replace `loadCustomers` argument shape:** introduce `buildFetchOptions(page, search)` that includes `statusValues` and `userCreatedIds` (only when non-empty) and pass it to both `fetchBusinessPartners` and `fetchBusinessPartnerCount`.
5. **Add the watcher** on `[selectedStatuses, selectedAccountManagerIds]` that resets pagination and re-fetches (mirrors the existing `searchStore.searchQuery` watcher).
6. **Add `ensureAccountManagersLoaded()`** that lazy-loads + builds avatar URLs via `useAssetUrl().getAssetUrl(...)` in parallel.
7. **Add `handleFilterButtonClick(event)`** that resets `filterBy` to `'root'` and toggles the popover.
8. **Add `selectFilterBy(value)`** that switches the popover view and triggers lazy load when `value === 'accountManager'`.
9. **Wrap header actions** in a `customers-page__header-actions` container; place the new `OverlayBadge`-wrapped filter `Button` to the left of the existing `NuxtLink → Button` ("New").
10. **Add `<Popover ref="filterPopoverRef">`** at the bottom of the template with three branches: root list, Status view, Account Manager view. Each non-root view has a back affordance returning to root.
11. **Render Status `MultiSelect`** with `option` slot rendering a `Tag` styled `.status-active` / `.status-inactive`. v-model is `selectedStatuses`.
12. **Render Account Manager `MultiSelect`** with `option` slot rendering avatar (28px circle) + name. v-model is `selectedAccountManagerIds`. Use `loading`/`empty-message` props from `MultiSelect`.
13. **Add scoped CSS** for `.customers-page__header-actions`, `.customers-page__filter-btn` (36×36, sky-blue), `.customers-page__filter-badge--hidden` (hide badge when count is zero), `.customers-page__filter-popover` (`:deep(.p-popover-content)` padding token), `.customers-filter` (column flex), `.customers-filter__label/__option/__back`, `.account-manager` (avatar + name row). All values via `var(--p-*)`.
14. **Add `--p-spacing-7 = 28px` to `app/presets/extend.js`** if not already defined (used for avatar diameter), or use existing token if present (verify before authoring CSS).
15. **Pre-commit checks:**
    - `grep -rnE "@media[^{]*max-width" app/pages/Customers/Index.vue app/composables/useDirectusUsers.ts` → 0 hits.
    - `grep -rnE "^@media" app/pages/Customers/Index.vue app/composables/useDirectusUsers.ts` → 0 hits (every `@media` nested).
    - No raw color/spacing values introduced.
16. **Smoke-verify in browser** at 360 / 768 / 1024 / 1440:
    - Initial load: badge shows `1`, table shows only Active customers.
    - Open popover → root list shows Status + Account Manager rows.
    - Click Status → see "Filter by Status" header + Select Status MultiSelect with Active checked.
    - Toggle Inactive on → badge becomes `2`, table shows both statuses (server reflects `_in: ['active','inactive']`).
    - Toggle Active off → badge becomes `1`, table shows only Inactive.
    - Back → click Account Manager → spinner briefly → list of users with avatars and names.
    - Pick 2 managers → badge becomes `1 + 2 = 3`, table filters by `user_created _in [...]`.
    - Search interacts: combine search + status + manager → all narrow together.
    - Sort header click resets to page 1 with filters preserved.
17. **Verify infinite scroll** still loads page 2/3 with the active filter intact.
18. **Verify existing tests / lint** pass: `npm run dev` boots without TS errors, `npm run build` succeeds.

## Possible Blockers

- **`useDirectusCrud('directus_users')` may not target the `/users` endpoint.** `useDirectusCrud` uses `readItems('directus_users', ...)` which the Directus SDK treats as a regular collection lookup and may not work for the *system* users collection (which is exposed at `/users`, not `/items/directus_users`). If the request 404s, swap inside `useDirectusUsers` to `@directus/sdk`'s `readUsers(query)` import. Verify before merging — quick to test against the running Directus instance.
- **`MultiSelect` `option` slot.** PrimeVue MCP returned an empty slots list for `MultiSelect`, but PrimeVue 4 docs and `SectionContacts` precedent show the slot does work. If runtime renders default labels instead, fallback is to render checkbox + Tag/avatar via `pt.option` passthrough props.
- **Sticky-default filter UX.** Default `['active']` means a user clicking the filter button always sees Active pre-selected. If the user explicitly clears all statuses we honor that — but a navigation away and back resets to `['active']` on next mount because the page-level state is not persisted (`useTableStateRestore` only caches table rows, not filters). Confirm: should filter selection persist in the table-state cache like `searchQuery` does? If yes, extend `useTableStateRestore` and `tableState` store to include `selectedStatuses` and `selectedAccountManagerIds`.
- **Account-manager `user_created` users that are now suspended/archived.** The current customer rows may have a `user_created` UUID pointing at a non-active user. The filter list only shows `status: active` users, so those customers cannot be re-selected by manager. Decide: include all users regardless of status, or accept that legacy assignments are not surfaceable. Recommend showing only active for the filter list and noting this limitation in product docs.
- **Suppliers parity.** The same UI is likely wanted on `app/pages/Suppliers/Index.vue` based on parallel structure. Out of scope for this task per the user's explicit framing ("customer's landing page"), but flag as obvious follow-up; the composable changes already support it.
- **Non-PrimeVue `<button>` inside the root popover view.** `02-primevue-usage.md` bans raw `<button>`. If strictly enforced, use `<Button text severity="secondary" :label="..." class="customers-filter__option" />` instead. Confirm preference — text-Button is fine but visually heavier than a plain row.
- **`useTableStateRestore` cache invalidation.** When filter selection changes, we already call `tableStateStore.clearTableState('/customers')` before reloading — confirm this matches the existing search behavior (line 222–227 of `Index.vue`). Without it, the cached snapshot would re-apply old filtered rows on re-mount.
- **OverlayBadge default severity.** Spec says "use OverlayBadge to display counts" but does not specify color. Plan uses `severity="danger"` to match `SectionContacts` precedent (red dot). Confirm — Figma may indicate a different palette.
- **Account manager column not currently shown.** The user's filter selects by `user_created`, but the Customers DataTable does not currently expose an "Account Manager" column. The user can filter but cannot *see* which manager is assigned to a row. Decide: add an `Account Manager` column showing avatar + name (requires extending `CUSTOMER_LIST_FIELDS` to include `user_created.first_name`, `user_created.last_name`, `user_created.avatar`) or leave as filter-only. The user did not request a column, but flag for clarification.
- **`limit: -1` on directus_users.** Pulls every active user; for an HVAC ERP this is typically tens, but if the org grows past a few hundred users the popover needs virtualization (`MultiSelect.virtualScrollerOptions`). Acceptable for v1.
- **`--p-spacing-7` token (28px).** Avatar size 28px in Figma. Verify `app/presets/extend.js` exposes a 28px spacing token; if not, either add `var(--p-spacing-7) = 28px` or use a closer existing token (`--p-spacing-6` if 24px, `--p-spacing-8` if 32px) and update Figma alignment expectation. Project policy bars raw `28px`.
