<script setup lang="ts">
import { useNavigationStore } from '~/stores/navigation'
import { useAuthStore } from '~/stores/auth'
import { useSearchStore } from '~/stores/search'
import { resolveSearchModule } from '~/config/searchModules'

const navStore = useNavigationStore()
const authStore = useAuthStore()
const searchStore = useSearchStore()
const route = useRoute()
const router = useRouter()
const { redirectIfAnyExactMatch } = useCrossScopeExactMatch()

// Location moved into the avatar menu (CONNECT-832), so the store and the
// permission-blocked tooltip now live in LocationDisplay rather than here.

const searchInput = ref('')
const filterInput = ref('')
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let filterDebounceTimer: ReturnType<typeof setTimeout> | null = null
// isNavigationClear: suppress input-watcher side-effects while we set inputs
// from navigation. Reset by nextTick so both watchers see the flag before it clears.
// isUrlDriven: suppress store→URL push when the store change came from the URL.
let isNavigationClear = false
let isUrlDriven = false

// On a module DETAIL route (e.g. /items/SKU) the visible search box is blanked —
// you're no longer on the results list — while the store keeps the active query
// alive so the detail page's Prev/Next still steps through the search results.
// List routes mirror the store query. Back-restore still works because the query
// lives in the list URL (?q=…).
function isModuleDetailPath(path: string): boolean {
  const module = resolveSearchModule(path)
  return module != null && path !== module.listRoute
}
function displaySearchValue(path: string): string {
  return isModuleDetailPath(path) ? '' : searchStore.searchQuery
}
function displayFilterValue(path: string): string {
  return isModuleDetailPath(path) ? '' : searchStore.filterText
}

// URL → store: initialize on first load
isUrlDriven = true
searchStore.initFromUrl(route.query as Record<string, string>)
nextTick(() => { isUrlDriven = false })

// Sync module + reset inputs on route path change
watch(
  () => route.path,
  (routePath) => {
    searchStore.syncModule(routePath)
    isNavigationClear = true
    searchInput.value = displaySearchValue(routePath)
    filterInput.value = displayFilterValue(routePath)
    nextTick(() => { isNavigationClear = false })
  },
  { immediate: true },
)

// URL → store: back/forward navigation
watch(
  () => route.query,
  (query) => {
    const urlSearch = (query.q as string) ?? ''
    const urlFilter = (query.filter as string) ?? ''
    if (urlSearch === searchStore.searchQuery && urlFilter === searchStore.filterText) {
      return
    }
    // A module's detail/sub routes (e.g. /items/SKU) don't carry the `q` param,
    // so an absent `q` there must NOT clear the search — the store, not the URL,
    // owns the active search off the list page. Clearing it here would strand the
    // detail page's Prev/Next navigation, rebuilding it over the unfiltered list
    // instead of the search results the user came from. Only the list route lets
    // the URL drive a clear.
    if (!urlSearch && isModuleDetailPath(route.path)) {
      return
    }
    isUrlDriven = true
    isNavigationClear = true
    searchStore.initFromUrl(query as Record<string, string>)
    searchInput.value = displaySearchValue(route.path)
    filterInput.value = displayFilterValue(route.path)
    nextTick(() => { isUrlDriven = false; isNavigationClear = false })
  },
)

function pushUrlParams(searchQuery: string, filterText: string) {
  if (!searchStore.hasActiveModule) { return }
  // Preserve other params (e.g. list-page filter state owned by
  // useUrlSyncedListState) and only update the keys we own here.
  const query = { ...route.query }
  if (searchQuery) { query.q = searchQuery } else { delete query.q }
  if (filterText) { query.filter = filterText } else { delete query.filter }
  router.replace({ query })
}

// Debounced watcher on local search input → commit to store
watch(searchInput, (query) => {
  clearTimeout(debounceTimer)
  if (isNavigationClear) { return }
  searchStore.setInputQuery(query)
  debounceTimer = setTimeout(() => { commitSearch(query) }, 400)
})

// When store searchQuery changes from user action: reset filter + push URL
watch(
  () => searchStore.searchQuery,
  (newQuery) => {
    if (isUrlDriven) { return }
    filterInput.value = ''
    pushUrlParams(newQuery, '')
  },
)

// Debounced watcher on filter input → commit to store and URL
watch(filterInput, (text) => {
  clearTimeout(filterDebounceTimer)
  if (isNavigationClear) { return }
  filterDebounceTimer = setTimeout(() => {
    searchStore.setFilterText(text)
    // Use the store value so the URL reflects the trimmed text.
    pushUrlParams(searchStore.searchQuery, searchStore.filterText)
  }, 200)
})

onBeforeUnmount(() => {
  clearTimeout(debounceTimer)
  clearTimeout(filterDebounceTimer)
})

// Publish nav height so mobile layout can reserve space
const navRef = ref<HTMLElement | null>(null)
let navResizeObserver: ResizeObserver | null = null

onMounted(() => {
  if (!navRef.value || typeof ResizeObserver === 'undefined') {return}
  navResizeObserver = new ResizeObserver(() => {
    const height = navRef.value?.offsetHeight ?? 0
    document.documentElement.style.setProperty('--app-top-nav-height', `${height}px`)
  })
  navResizeObserver.observe(navRef.value)
})

onBeforeUnmount(() => {
  navResizeObserver?.disconnect()
  document.documentElement.style.removeProperty('--app-top-nav-height')
})

async function commitSearch(query = searchInput.value) {
  clearTimeout(debounceTimer)

  if (!searchStore.hasActiveModule) {
    return
  }

  // Trim before committing so leading/trailing whitespace can't break
  // matching or land in the URL.
  const trimmedQuery = query.trim()
  const listRoute = searchStore.activeModule.listRoute
  const needsNavigation = route.path !== listRoute

  if (needsNavigation) { isUrlDriven = true }
  searchStore.setSearchQuery(trimmedQuery)
  if (!needsNavigation) { return }
  nextTick(() => { isUrlDriven = false })

  if (trimmedQuery && await redirectIfAnyExactMatch(trimmedQuery)) {
    return
  }

  navigateTo({
    path: listRoute,
    query: trimmedQuery ? { q: trimmedQuery } : {},
  })
}

const searchFieldRef = ref<HTMLElement | null>(null)
const isSearchFieldFocused = ref(false)

function handleSearchFocusIn() {
  isSearchFieldFocused.value = true
}

function handleSearchFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget as Node | null
  if (!nextTarget || !searchFieldRef.value?.contains(nextTarget)) {
    isSearchFieldFocused.value = false
  }
}

const isSearchIconVisible = computed(
  () => !(searchInput.value && isSearchFieldFocused.value),
)

function handleFilterIconClick() {
  if (filterInput.value) {
    filterInput.value = ''
  }
}

const avatarMenuRef = ref<{ toggle: (event: Event) => void } | null>(null)
const avatarMenuItems = computed(() => [
  {
    label: 'Profile',
    icon: 'pi pi-user',
    command: () => { navigateTo('/profile') },
  },
  {
    label: 'Logout',
    icon: 'pi pi-sign-out',
    command: () => { authStore.logout() },
  },
])

// Feature-request / bug-report drawers (CONNECT-832). Their triggers are desktop
// only — per the ticket, mobile keeps its existing UX untouched.
const requestDrawerVisible = ref(false)
const requestDrawerMode = ref<'feature' | 'bug'>('feature')

function openRequestDrawer(mode: 'feature' | 'bug') {
  requestDrawerMode.value = mode
  requestDrawerVisible.value = true
}

function alignAvatarMenu(trigger: HTMLElement) {
  nextTick(() => {
    const menu = document.querySelector<HTMLElement>('.app-top-nav__avatar-menu.p-menu')
    if (!menu) { return }

    const triggerRect = trigger.getBoundingClientRect()
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth
    const menuWidth = menu.offsetWidth
    const gutter = 8
    const left = Math.max(gutter, Math.min(triggerRect.right - menuWidth, viewportWidth - menuWidth - gutter))

    menu.style.left = `${left}px`
  })
}

function toggleAvatarMenu(event: Event) {
  avatarMenuRef.value?.toggle(event)
  if (event.currentTarget instanceof HTMLElement) {
    alignAvatarMenu(event.currentTarget)
  }
}

</script>

<template>
  <header
    ref="navRef"
    class="app-top-nav"
  >
    <div
      v-if="navStore.isMobile"
      class="app-top-nav__brand"
    >
      <img
        src="/logo.svg"
        alt="Liberty"
        class="app-top-nav__brand-mark"
        width="32"
        height="32"
      >
    </div>

    <div class="app-top-nav__left">
      <Button
        text
        plain

        class="nav-toggle pi"
        :class="{ collapsed: navStore.isCollapsed, 'pi-bars': navStore.isCollapsed, 'pi-ellipsis-v': !navStore.isCollapsed }"
        :aria-expanded="!navStore.isCollapsed"
        aria-label="Toggle sidebar"
        @click="navStore.toggleSidebar()"
      />

      <div
        ref="searchFieldRef"
        class="app-top-nav__search"
        @focusin="handleSearchFocusIn"
        @focusout="handleSearchFocusOut"
      >
        <BaseClearableInput
          id="top-search"
          v-model="searchInput"
          v-search-input
          autocomplete="off"
          :placeholder="searchStore.placeholder"
          :disabled="!searchStore.hasActiveModule"
          class="app-top-nav__search-field"
          @keydown.enter="commitSearch()"
        />
        <span
          v-if="isSearchIconVisible"
          class="app-top-nav__search-trigger"
          @pointerdown.prevent
        >
          <BaseIconButton
            icon="pi pi-search"
            label="Search"
            :disabled="!searchStore.hasActiveModule"
            @click="commitSearch()"
          />
        </span>
        <Button
          label="SEARCH"
          class="app-top-nav__search-btn"
          :disabled="!searchStore.hasActiveModule"
          @click="commitSearch()"
        />
      </div>

      <div
        id="top-nav-filter-slot"
        class="app-top-nav__filter-slot"
      />

      <div
        v-if="searchStore.hasSearchQuery && searchStore.hasResults"
        :class="`app-top-nav__filter app-top-nav__filter--${!navStore.isMobile ? 'desktop' : 'mobile'}`"
      >
        <InputText
          v-model="filterInput"
          v-search-input
          autocomplete="off"
          placeholder="Filter Results"
          class="app-top-nav__filter-input"
        />
        <i
          :class="[
            'pi',
            filterInput ? 'pi-filter-slash' : 'pi-filter',
            'app-top-nav__filter-icon',
            'icon-hit-area',
            'icon-action',
            { 'app-top-nav__filter-icon--active': filterInput }
          ]"
          @click="handleFilterIconClick"
        />
      </div>
    </div>

    <div class="app-top-nav__right">
      <!-- Desktop-only request triggers. Mobile deliberately has neither: the
           ticket keeps the existing mobile UX as-is. -->
      <Button
        v-if="!navStore.isMobile"
        v-tooltip.bottom="'Request a new feature'"
        text
        plain
        rounded
        class="icon-color app-top-nav__request-trigger"
        aria-label="Request a new feature"
        @click="openRequestDrawer('feature')"
      >
        <AppNavIcon
          icon="ms:tips_and_updates"
          aria-hidden="true"
        />
      </Button>

      <Button
        v-if="!navStore.isMobile"
        v-tooltip.bottom="'Report a bug'"
        text
        plain
        rounded
        class="icon-color app-top-nav__request-trigger"
        aria-label="Report a bug"
        @click="openRequestDrawer('bug')"
      >
        <AppNavIcon
          icon="ms:bug_report"
          aria-hidden="true"
        />
      </Button>

      <!-- Profile / Logout / Location all live behind the avatar now, on every
           breakpoint — desktop used to spell Location and Sign out out in the bar
           (CONNECT-832). -->
      <Avatar
        :label="authStore.userInitial"
        shape="circle"
        class="app-top-nav__avatar"
        aria-haspopup="true"
        aria-label="Open profile menu"
        @click="toggleAvatarMenu($event)"
      />

      <Menu
        ref="avatarMenuRef"
        :model="avatarMenuItems"
        :popup="true"
        class="app-top-nav__avatar-menu"
      >
        <template #end>
          <Divider />
          <LocationDisplay variant="menu" />
        </template>
      </Menu>
    </div>
  </header>

  <DrawerSubmitRequest
    v-model:visible="requestDrawerVisible"
    :mode="requestDrawerMode"
  />
</template>

<style scoped>
/* Top Nav — mobile-first base */
.app-top-nav {
  display: flex;
  justify-content: space-between;
  height: auto;
  background: var(--p-surface-0);
  border-bottom: none;
  padding: var(--p-spacing-3) var(--p-spacing-3) var(--p-spacing-3)
    calc(var(--p-layout-top-nav-brand-width) + var(--p-spacing-3)) !important;
  box-shadow: var(--p-shadow-xs);
  width: 100%;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  gap: var(--p-spacing-2);
  align-items: center;
  overflow: hidden;
  transition: box-shadow var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);

  @media (min-width: 768px) {
    height: 64px;
    /* !important mirrors the base declaration: importance outranks source order,
       so a plain value here would lose to the mobile padding above. */
    padding: var(--p-spacing-3) !important;
    gap: 0;
    align-items: stretch;
    position: sticky;
    left: auto;
    right: auto;
    background: var(--p-surface-0);
    border-bottom: 1px solid var(--p-surface-100);
    overflow: visible;
  }
}

/* Navy square carrying the Liberty mark, flush to the bar's top-left corner.
   Pinned rather than laid out so the second row (the mobile "Filter Results"
   field) can grow without stretching it into a stripe. */
.app-top-nav__brand {
  position: absolute;
  top: 0;
  left: 0;
  width: var(--p-layout-top-nav-brand-width);
  height: var(--p-layout-top-nav-mobile-height);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--p-deepblue-900);
  z-index: 1;
}

.app-top-nav__brand-mark {
  width: var(--p-spacing-8);
  height: var(--p-spacing-8);
}

.app-top-nav__left {
  width: 100%;
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  column-gap: var(--p-spacing-2);
  row-gap: var(--p-spacing-3);
  align-items: center;
  position: relative;
  z-index: 1;

  &:has(.app-top-nav__filter-slot:empty) {
    grid-template-columns: auto minmax(0, 1fr);
  }

  @media (min-width: 768px) {
    display: flex;
    place-items: center;
    gap: var(--p-spacing-1);
    flex: 1;
    min-width: 0;
  }
}

.app-top-nav__search {
  display: flex;
  gap: var(--p-spacing-2);
  flex: 1;
  min-width: 0;
  grid-column: 2 / 3;
  position: relative;
  width: 100%;

  @media (min-width: 768px) {
    gap: var(--p-spacing-2);
    flex: 0 1 480px;
    min-width: 200px;
    grid-column: auto;
    position: static;
    width: auto;
  }
}

/* BaseClearableInput wraps the input in its own element — make that wrapper
   grow into the flex row exactly as the bare input did. */
.app-top-nav__search-field {
  flex: 1;
  min-width: 0;
}

/* Keep room for the clear (×) button once the field has a value, overriding the
   tighter desktop padding-right set on .p-inputtext below. */
.app-top-nav__search-field :deep(.clearable-input__field--reserved) {
  padding-right: var(--p-spacing-9);
}

.app-top-nav__search :deep(.p-inputtext) {
  height: var(--p-layout-top-nav-control-size);
  padding-right: var(--p-spacing-9);
  font-size: var(--app-input-font-size) !important;
  background: var(--p-surface-0);
  border: 1px solid var(--p-inputtext-border-color);
  color: var(--p-inputtext-color);

  &::placeholder {
    color: var(--p-inputtext-placeholder-color);
  }

  &:focus {
    border-color: var(--p-skyblue-200);
  }

  /* Disabled on pages without an active search module (e.g. Dashboard) — show
     the standard greyed disabled-field UX rather than a normal-looking input. */
  &:disabled {
    background: var(--p-inputtext-disabled-background);
    border-color: var(--p-surface-200);
    color: var(--p-surface-400);
    cursor: not-allowed;

    &::placeholder {
      color: var(--p-surface-400);
    }
  }

  @media (min-width: 768px) {
    height: auto;
    padding-right: var(--p-inputtext-padding-x, 0.75rem);
  }
}

/* Mobile trigger — the magnifier inside the field's trailing edge. Positioned on
   this wrapper span rather than the control itself, mirroring
   BaseClearableInput's clear (×): the two share this slot, and a bare `.p-button`
   would lose its `position` to PrimeVue's own `position: relative`. */
.app-top-nav__search-trigger {
  position: absolute;
  top: 50%;
  right: var(--p-spacing-3);
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;

  @media (min-width: 768px) {
    display: none;
  }
}

.app-top-nav__search-trigger :deep(.base-icon-button:not(.base-icon-button--disabled)) {
  color: var(--p-gray-400);
}

/* Desktop keeps the standalone primary SEARCH button. */
.app-top-nav__search-btn {
  display: none;

  @media (min-width: 768px) {
    display: inline-flex;
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-bold);
    padding: var(--p-button-padding-y) var(--p-spacing-4);
    align-self: stretch;
    flex: 0 1 auto;
  }
}

/* Top-nav filter slot (teleport target) */
.app-top-nav__filter-slot {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  grid-column: 3 / 4;
  height: var(--p-layout-top-nav-control-size);

  &:empty {
    display: none;
  }

  @media (min-width: 768px) {
    grid-column: auto;
    height: auto;
    align-self: stretch;
    margin-left: var(--p-spacing-1);
  }
}
.app-top-nav__filter-slot :deep(.filter-toolbar__filter-btn.p-button) {
  width: var(--p-spacing-8);
  min-width: var(--p-spacing-8);
  padding-left: 0;
  padding-right: 0;

  @media (min-width: 768px) {
    width: auto;
    min-width: 0;
    padding-left: var(--p-spacing-3);
    padding-right: var(--p-spacing-3);
  }
}

.app-top-nav__filter {
  display: flex;
  align-items: center;
  position: relative;
  margin-left: var(--p-spacing-5);
}

.app-top-nav__filter--desktop {
  display: none;

  @media (min-width: 768px) {
    display: flex;
  }
}

.app-top-nav__filter--mobile {
  display: flex;
  align-items: center;
  gap: var(--p-spacing-2);
  margin-left: 0;
  padding: 0;
  width: 100%;
  max-width: none;
  grid-column: 1 / -1;

  @media (min-width: 768px) {
    display: none;
  }
}

.app-top-nav__filter--mobile .app-top-nav__filter-input {
  width: 100% !important;
  height: var(--p-layout-top-nav-control-size);
  border: 1px solid var(--p-surface-200);
  padding-right: var(--p-spacing-8);
}

.app-top-nav__filter-input {
  width: clamp(120px, 18vw, 220px) !important;
  padding-right: var(--p-spacing-6);
}

/* Resting colour is preserved (skyblue); the hover/focus bg + the rounded
   surface come from the shared `.icon-action` class. */
.app-top-nav__filter-icon {
  position: absolute;
  right: var(--p-spacing-3);
  color: var(--p-skyblue-600);
  font-size: var(--p-font-size-sm);
}

.app-top-nav__filter-icon--active,
.app-top-nav__filter-icon--active:hover,
.app-top-nav__filter-icon--active:focus-visible {
  color: var(--p-red-500);
}

.app-top-nav__right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: var(--p-spacing-1);
  margin-left: 0;
  align-self: flex-start;
  height: var(--p-layout-top-nav-control-size);
  position: relative;
  z-index: 1;

  @media (min-width: 768px) {
    margin-left: var(--p-spacing-2);
    align-self: center;
    gap: var(--p-spacing-2);
    height: auto;
  }
}

/* Feature-request / bug-report triggers — 18px Material Symbols in the same
   32px hit area the sign-out button used to occupy, so the right-hand cluster
   keeps its rhythm. Colour + hover come from the shared `.icon-color`. */
.app-top-nav__request-trigger.p-button {
  padding: 0;
  width: var(--p-spacing-8);
  height: var(--p-spacing-8);
  border-radius: var(--p-border-radius-xs);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--p-font-size-lg);
}

.app-top-nav__avatar {
  background: var(--p-primary-500);
  color: var(--p-surface-0);
  font-size: var(--p-font-size-xs);
  font-weight: var(--p-font-weight-bold);
  width: var(--p-layout-top-nav-control-size);
  height: var(--p-layout-top-nav-control-size);
  cursor: pointer;
  border: 1px solid var(--p-surface-100);
  margin-left: 0;
  /* Spacing between the location block, avatar and logout is governed solely by
     the parent's flex `gap`, so both sides stay equal — no extra margin here. */

  @media (min-width: 768px) {
    width: var(--p-spacing-8);
    height: var(--p-spacing-8);
    font-size: var(--p-font-size-sm);
    border: none;
    margin-left: var(--p-spacing-2);
  }
}

.p-inputtext {
  width: 100%;
  font-weight: var(--p-font-weight-normal);
}

.icon-color {
  color: var(--p-gray-300);
  border: none;
  background-color: transparent;
  transition: background-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
    color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);

  /* Hover / focus / active: light-blue bg + brand-blue icon (gray secondary icon
     behaves like a primary one), consistent with BaseIconButton / .icon-action. */
  &:hover,
  &:focus-visible,
  &:active {
    background-color: var(--p-tideblue-50) !important;
    color: var(--p-skyblue-600) !important;
  }
}

.app-top-nav__toogle {
  display: none;
  border-radius: var(--p-border-radius-xs) !important;
  color: var(--p-skyblue-500);

  @media (min-width: 768px) {
    display: inline-flex;
    border-radius: 4px;
    color: var(--p-gray-300);
  }
}

.app-top-nav__toogle:hover {
  background-color: transparent !important;
}

@keyframes nav-toggle-swap-bars {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes nav-toggle-swap-dots {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}

.app-top-nav__avatar-menu :deep(.p-menu-list) {
  padding: var(--p-spacing-3) var(--p-spacing-3) var(--p-spacing-3) var(--p-spacing-6);
  gap: 0;
}

.app-top-nav__avatar-menu :deep(.p-menuitem) {
  padding: 0;
  margin: 0;
}

.app-top-nav__avatar-menu :deep(.p-menuitem-link) {
  padding: var(--p-spacing-3) var(--p-spacing-3) var(--p-spacing-3) var(--p-spacing-2);
  border-radius: var(--p-border-radius-xs);
}

.app-top-nav__avatar-menu :deep(.p-divider) {
  margin: var(--p-spacing-3) 0 var(--p-spacing-3) 0;
}

.nav-toggle {
    display: flex;
    width: var(--p-layout-top-nav-control-size);
    height: var(--p-layout-top-nav-control-size);
    padding: 0;
    justify-content: center;
    align-items: center;
    background: var(--p-surface-50);
    color: var(--p-skyblue-600);
    font-size: var(--p-font-size-sm);
    border: none;
    border-radius: var(--p-border-radius-xs);
    cursor: pointer;
    margin: 0;
    outline: none;
    -webkit-tap-highlight-color: transparent; /* Removes blue tap highlight on mobile */

    @media (min-width: 768px) {
      display: block;
      width: auto;
      height: auto;
      padding: var(--p-spacing-2);
      margin-right: var(--p-spacing-1);
      font-size: var(--p-font-size-base);
      background: var(--p-surface-50);
      border-radius: var(--p-border-radius-xs);
    }
}

.p-divider-horizontal{
  margin: 0 !important;
}

.nav-toggle::before {
    @media (min-width: 768px) {
        display: inline-block;
        animation-duration: var(--p-transition-duration-normal);
        animation-timing-function: var(--p-transition-timing-ease-in-out);
        animation-fill-mode: both;
    }
}

.nav-toggle.collapsed::before {
    @media (min-width: 768px) {
        animation-name: nav-toggle-swap-bars;
    }
}

.nav-toggle:not(.collapsed)::before {
    @media (min-width: 768px) {
        animation-name: nav-toggle-swap-dots;
    }
}
</style>

<style>
[data-detailnav-sticky] .app-top-nav {
  box-shadow: none !important;
  border-bottom: 1px solid var(--p-surface-100) !important;
}

/* Avatar dropdown menu — offset from trigger */
.app-top-nav__avatar-menu.p-menu {
  margin-top: var(--p-spacing-3);
  border-radius: var(--p-border-radius-xs);
}
</style>
