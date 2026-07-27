<script setup lang="ts">
import { useNavigationStore } from '~/stores/navigation'
import { useAuthStore } from '~/stores/auth'
import { useSearchStore } from '~/stores/search'
import { useLocationStore } from '~/stores/location'
import { resolveSearchModule } from '~/config/searchModules'

const navStore = useNavigationStore()
const authStore = useAuthStore()
const searchStore = useSearchStore()
const locationStore = useLocationStore()
const route = useRoute()
const router = useRouter()

// Blocked → point the user to browser settings (a denied permission can't be
// re-prompted from JS); otherwise explain why we ask for location at all.
const locationTooltip = computed(() =>
  locationStore.isPermissionBlocked
    ? 'Location access is blocked. Enable it in your browser settings to share.'
    : 'Location sharing provides a better user experience by improving the accuracy of address suggestions.',
)

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

function commitSearch(query = searchInput.value) {
  clearTimeout(debounceTimer)

  if (!searchStore.hasActiveModule) {
    return
  }

  // Trim before committing so leading/trailing whitespace can't break
  // matching or land in the URL.
  const trimmedQuery = query.trim()
  const listRoute = searchStore.activeModule.listRoute
  const needsNavigation = route.path !== listRoute

  // When navigating to the list route, suppress the store→URL watcher so
  // it doesn't replace() the detail URL while navigateTo() is pushing to
  // the list. The query travels with navigateTo instead.
  if (needsNavigation) { isUrlDriven = true }
  searchStore.setSearchQuery(trimmedQuery)
  if (needsNavigation) {
    nextTick(() => { isUrlDriven = false })
    navigateTo({
      path: listRoute,
      query: trimmedQuery ? { q: trimmedQuery } : {},
    })
  }
}

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
    <svg
      v-if="navStore.isMobile"
      class="app-top-nav__pattern"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 285 60"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      fill="none"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        fill="white"
        fill-opacity="0.1"
        d="M180.076 55.7782C179.808 49.4594 176.621 44.3579 170.517 40.4735C167.349 48.6718 170.553 53.7734 180.076 55.7782ZM189.098 65.3011C169.891 61.8822 161.066 54.8116 164.073 39.847C160.117 38.0391 153.799 36.0164 145.117 33.7609C164.825 31.8993 188.292 36.2312 215.536 46.7207C205.799 49.9785 196.992 56.172 189.116 65.3011H189.098ZM114.221 232.955C118.124 224.022 122.992 218.294 128.81 215.752C130.636 221.874 132.623 227.62 134.807 232.955H114.221ZM79.3874 232.955C88.0154 212.602 96.6075 197.709 105.182 188.258C105.056 209.183 107.079 224.076 111.268 232.955H79.3874ZM22.5364 30.6821L15.2152 41.8876H0.912911L11.0623 51.0704L2.07642 62.5982L15.3763 53.7376L23.6999 62.5982L23.3598 50.2291L36.4985 43.5524L23.5209 42.89L22.5185 30.7L22.5364 30.6821ZM14.3918 -10.6137L24.5054 -1.44878L15.5195 10.079L28.8193 1.21835L37.1429 10.079L36.8207 -2.29009L49.9595 -8.96687L36.9818 -9.64708L35.9794 -21.8371L28.6582 -10.6316H14.4097C14.4097 -10.6316 14.4097 -10.6137 14.3918 -10.5958V-10.6137ZM0.0179002 105.809V-45H101.279L98.4691 -40.7039H85.1155L94.5847 -32.1118L86.1895 -21.3359L98.6302 -29.6058L106.399 -21.3359L106.077 -32.8995L118.356 -39.1466L106.238 -39.7731L105.808 -45H159.992L152.098 -34.8685L164.539 -43.1384L172.325 -34.8685L172.039 -45H202.541C194.128 -34.0272 187.433 -21.2822 182.421 -6.74724C177.087 -7.08735 171.753 -7.19475 166.4 -7.08735L159.742 -6.83674C158.578 -6.76514 157.414 -6.69354 156.233 -6.60404L155.535 -15.3393L149.395 -5.95963C145.35 -5.49423 141.322 -4.88562 137.348 -4.15171H133.894L134.502 -3.59681C126.966 -2.05739 119.556 -0.0346603 112.288 2.48927L112.199 2.52507L112.002 2.59667L111.483 2.77567C109.352 3.50958 107.24 4.29719 105.128 5.1385L103.499 5.81871L103.41 5.85451L103.32 5.89031L103.248 5.92611L103.159 5.97981L103.069 6.01561L102.98 6.05141L102.926 6.08721L102.371 6.31992L102.282 6.35572C100.904 6.92852 99.4894 7.55503 98.0574 8.19944H98.0216L97.0192 -3.99061L89.698 7.19703H75.3957L84.1489 15.1268C70.4552 22.7881 57.6387 31.9351 45.9319 42.4246L45.6097 42.7111C40.0786 47.6515 34.7443 52.8247 29.6428 58.2126L27.8169 60.1459L27.7453 60.2354L27.5663 60.4144C24.1474 64.0839 20.8358 67.8429 17.6138 71.6736C22.608 69.6509 27.0651 68.8812 30.9853 69.3466C22.429 75.1283 12.1005 87.3005 0 105.845L0.0179002 105.809ZM249.797 60.7008C243.747 63.8691 240.507 69.2034 240.078 76.7036C243.21 70.707 246.45 65.3727 249.797 60.7008ZM0.0179002 232.955V123.871C18.8131 93.2612 38.8435 69.991 60.1089 54.0777C56.1709 53.9882 51.2841 54.3641 45.5023 55.1875C112.897 -13.6209 229.284 -19.1342 258.479 55.4918C288.569 76.3098 294.548 99.0072 268.682 126.001C270.204 114.437 268.181 107.009 263.688 102.229C258.694 96.9308 256.6 97.8795 250.424 96.8413C249.762 96.7339 249.099 96.6086 248.419 96.4654C241.08 94.8365 235.674 92.9211 217.398 83.7383C234.547 96.895 240.257 99.5084 245.698 99.9738C250.746 101.048 254.863 100.69 258.676 104.646C262.381 108.494 266.785 115.816 265.8 118.053C263.921 114.276 242.906 113.292 233.401 113.56C221.837 113.864 200.124 140.947 193.788 150.184C178.59 172.327 186.914 204.547 199.874 232.972H173.364C164.915 218.527 159.742 207.268 157.88 199.213C151.454 201.88 149.843 209.326 153.065 221.534C144.329 211.635 140.964 196.259 142.969 175.387C133.446 181.062 127.593 189.385 125.391 200.376C124.12 185.447 129.204 167.655 140.624 146.962C130.654 148.537 121.686 153.961 113.72 163.197C117.175 155.232 124.174 146.658 134.735 137.457L134.824 137.385C138.046 134.539 144.168 129.652 153.208 122.707C140.051 125.929 129.544 129.634 121.65 133.823C135.093 118.859 150.97 109.139 169.3 104.717C167.671 100.457 163.411 97.6468 156.555 96.2864C166.042 95.3914 186.323 95.9821 217.416 98.0048L217.327 87.5332C205.351 86.6919 191.371 82.7001 175.368 75.5579H175.422C192.606 81.4829 216.235 81.0533 233.813 76.6857L233.347 46.5417L246.021 46.667C207.589 -0.571671 114.508 3.49168 72.2095 43.8567C74.9661 43.3018 77.7943 43.087 80.6047 43.2302C44.2672 73.0519 17.7928 107.385 1.18141 146.246C10.0778 135.595 20.4062 128.596 32.1309 125.249C21.4087 139.515 16.3429 153.907 16.9336 168.388H17.2737C22.8765 156.914 45.377 147.821 84.7575 141.109C72.8002 150.059 64.1544 162.428 58.8022 178.269C67.448 174.51 76.4697 171.682 85.7062 169.838C83.3434 179.827 81.5892 189.94 80.4257 200.126C79.2084 210.651 78.5282 221.588 78.3671 232.955H0.0179002Z"
      />
    </svg>

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

      <div class="app-top-nav__search">
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
        <Button
          label="SEARCH"
          icon="pi pi-search"
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
      <div class="app-top-nav__location">
        <i
          v-tooltip.bottom="locationTooltip"
          class="pi pi-map-marker"
        />
        <span
          v-tooltip.bottom="locationTooltip"
          class="app-top-nav__location-text"
        >{{ locationStore.displayLocation || 'Location Sharing' }}</span>
        <!-- Wrapper carries the tooltip: a disabled InputSwitch swallows hover
             events, so the tooltip must live on an always-interactive element. -->
        <span
          v-tooltip.bottom="locationTooltip"
          class="app-top-nav__location-toggle-wrap"
        >
          <InputSwitch
            :model-value="locationStore.isLocationSharing"
            :disabled="locationStore.isPermissionBlocked"
            aria-label="Toggle location sharing"
            class="app-top-nav__location-toggle"
            @update:model-value="locationStore.setLocationSharing($event)"
          />
        </span>
      </div>

      <Avatar
        :label="authStore.userInitial"
        shape="circle"
        class="app-top-nav__avatar"
        :aria-haspopup="navStore.isMobile ? 'true' : undefined"
        :aria-label="navStore.isMobile ? 'Open profile menu' : undefined"
        @click="navStore.isMobile ? toggleAvatarMenu($event) : undefined"
      />

      <Button
        v-if="!navStore.isMobile"
        text
        plain
        rounded
        icon="pi pi-sign-out"
        class="icon-color app-top-sign-out"
        aria-label="Sign out"
        @click="authStore.logout()"
      />

      <Menu
        v-if="navStore.isMobile"
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

</template>

<style scoped>
/* Top Nav — mobile-first base */
.app-top-nav {
  display: flex;
  justify-content: space-between;
  height: auto;
  background: var(--p-deepblue-900);
  border-bottom: 1px solid var(--p-deepblue-900);
  padding: var(--p-spacing-3) !important;
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
    padding: 0 var(--p-spacing-1);
    gap: 0;
    align-items: stretch;
    position: sticky;
    left: auto;
    right: auto;
    background: var(--p-surface-0);
    border-bottom-color: var(--p-surface-100);
    overflow: visible;
  }
}

.app-top-nav__pattern {
  position: absolute;
  top: 0;
  left: 0;
  width: 75%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
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
  height: 36px;
  border: 1px solid color-mix(in srgb, var(--p-surface-0) 30%, transparent);
  background: color-mix(in srgb, var(--p-surface-0) 80%, transparent);
  color: var(--p-surface-0);
  transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
              border-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
              color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);

  &::placeholder {
    color: var(--p-gray-800);
  }

  &:not(:placeholder-shown) {
    background: var(--p-surface-0);
    border-color: var(--p-surface-200);
    color: var(--p-gray-900);
  }

  &:focus {
    background: var(--p-surface-0);
    border-color: var(--p-skyblue-200);
    color: var(--p-gray-900);
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
    background: var(--p-surface-0);
    border: 1px solid var(--p-inputtext-border-color);
    color: var(--p-inputtext-color);
    padding-right: var(--p-inputtext-padding-x, 0.75rem);
    transition: none;

    &::placeholder {
      color: var(--p-inputtext-placeholder-color);
    }

    &:not(:placeholder-shown) {
      background: var(--p-surface-0);
      border-color: var(--p-inputtext-border-color);
      color: var(--p-inputtext-color);
    }

    &:focus {
      background: var(--p-surface-0);
      border-color: var(--p-skyblue-200);
      color: var(--p-inputtext-color);
    }
  }
}

.app-top-nav__search-btn {
 font-size: var(--p-font-size-sm);
  font-weight: var(--p-font-weight-bold);
  width: 42px;
  min-width: 42px;
  height: 36px;
  padding: 0;
  background: var(--p-skyblue-600);
  color: var(--p-surface-0);
  flex: 0 0 auto;

  @media (min-width: 768px) {
    width: auto;
    min-width: auto;
    height: auto;
    padding: var(--p-button-padding-y) var(--p-spacing-4);
    background: var(--p-button-primary-background);
    color: var(--p-button-primary-color);
    align-self: stretch;
    flex: 0 1 auto;
  }
}

.app-top-nav__search-btn :deep(.p-button-label) {
  display: none;

  @media (min-width: 768px) {
    display: inline;
  }
}

.app-top-nav__search-btn :deep(.p-button-icon) {
  display: inline-flex;
  margin-right: 0;

  @media (min-width: 768px) {
    display: none;
  }
}

/* Top-nav filter slot (teleport target) */
.app-top-nav__filter-slot {
  display: flex;
  align-items: stretch;
  flex: 0 0 auto;
  grid-column: 3 / 4;
  height: 36px;

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
  height: 36px;
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
  height: 36px;
  position: relative;
  z-index: 1;

  @media (min-width: 768px) {
    margin-left: var(--p-spacing-2);
    align-self: center;
    gap: var(--p-spacing-2);
    height: auto;
  }
}

.app-top-nav__location {
  display: none;
  align-items: center;
  gap: var(--p-spacing-xs, 8px);

  @media (min-width: 768px) {
    display: flex;
    height: 100%;
  }
}

.app-top-nav__location i {
  color: var(--p-deepblue-900);
  font-size: var(--p-font-size-sm);
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
}

.app-top-nav__location-text {
  font-size: var(--p-font-size-sm);
  font-weight: 600;
  color: var(--p-deepblue-900);
  white-space: nowrap;
  margin-top: 2px;
  cursor: pointer;
}

.app-top-nav__location-toggle-wrap {
  display: inline-flex;
  flex-shrink: 0;
}

.app-top-nav__location-toggle {
  flex-shrink: 0;
}

.app-top-sign-out {
  background-color: transparent !important;
  padding: 0 !important;
  width: var(--p-spacing-8);
  height: var(--p-spacing-8);
  border-radius: var(--p-border-radius-xs);
  display: inline-flex !important;
  align-items: center;
  justify-content: center;
}

.app-top-sign-out :deep(.p-button-icon) {
  margin: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.app-top-sign-out :deep(.p-button-icon)::before {
    transform: translateX(1px);

}

.app-top-nav__avatar {
  background: var(--p-primary-500);
  color: var(--p-surface-0);
  font-size: var(--p-font-size-xs);
  font-weight: var(--p-font-weight-bold);
  width: var(--p-spacing-8);
  height: var(--p-spacing-8);
  cursor: pointer;
  border: 1px solid var(--p-surface-100);
  margin-left: var(--p-spacing-2);
  /* Spacing between the location block, avatar and logout is governed solely by
     the parent's flex `gap`, so both sides stay equal — no extra margin here. */

  @media (min-width: 768px) {
    width: 32px;
    height: 32px;
    font-size: var(--p-font-size-sm);
    border: none;
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
    padding: var(--p-button-padding-y, 7px) 10px;
    justify-content: center;
    align-items: center;
    background: var(--p-surface-50);
    color: var(--p-skyblue-600);
    border: none;
    border-radius: var(--p-border-radius-xs);
    cursor: pointer;
    flex-direction: column;
    gap: 3px; /* Spacing between dots/lines */
    margin: 0;
    outline: none;
    -webkit-tap-highlight-color: transparent; /* Removes blue tap highlight on mobile */

    @media (min-width: 767px) {
      display: block;
      padding: var(--p-spacing-2);
      margin-right: var(--p-spacing-1);
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
/* Remove topnav shadow when detailnav tabs are sticky */
[data-detailnav-sticky] .app-top-nav {
  box-shadow: none !important;
}

/* Avatar dropdown menu — offset from trigger */
.app-top-nav__avatar-menu.p-menu {
  margin-top: var(--p-spacing-3);
  border-radius: var(--p-border-radius-xs);
}
</style>
