<script setup lang="ts">
import { useNavigationStore } from '~/stores/navigation'
import { useSearchStore } from '~/stores/search'
import { useDeployNotification } from '~/composables/useDeployNotification'
import { useSidebarSwipe, SIDEBAR_WIDTH } from '~/composables/useSidebarSwipe'
import { useSidebarBreakpoints } from '~/composables/useSidebarBreakpoints'
import { usePageScrollTop } from '~/composables/usePageScrollTop'
import { topLeafItems, groupItems, leafItems } from '~/config/navigation'

const navStore = useNavigationStore()
const searchStore = useSearchStore()
const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const appVersion = computed(() => {
  const v = String(runtimeConfig.public?.appVersion || '').trim()
  return v || '1.0.0'
})

const { openVersionDetails, updatePending, updateAvailable, deployVersion, refresh } = useDeployNotification()
// Only surface the sidebar orange CTA after the update banner has been dismissed
// (updateAvailable flips to false on "Not Now"). While the banner is open we keep
// the sidebar quiet so the user isn't nagged by both signals at once.
const showUpdateDot = computed(() => Boolean(updatePending.value) && !updateAvailable.value)
const pendingVersion = computed(() => {
  const reported = String(deployVersion.value || '').trim()
  if (reported && /^\d+\.\d+\.\d+/.test(reported)) return reported
  return ''
})

function handleRefreshToUpdate() {
  // sessionStorage may be unavailable (privacy mode, disabled cookies) —
  // swallow the failure and continue refreshing without auto-open.
  tryCatchSync(() =>
    sessionStorage.setItem('connect:show-version-details-after-refresh', '1'),
  )
  refresh()
}

useSidebarSwipe()
useSidebarBreakpoints()
const { showScrollTop, handleScrollTop } = usePageScrollTop()

function handleNavClick(path: string, event: Event) {
  event.preventDefault()
  searchStore.markClearOnNavigate()
  navigateTo(path)
}

watch(
  () => route.path,
  (path) => {
    navStore.setActiveRoute(path)
  },
  { immediate: true },
)

watch(
  () => navStore.isMobile && !navStore.isCollapsed,
  (isOverlayOpen) => {
    document.body.style.overflow = isOverlayOpen ? 'hidden' : ''
  },
)

const panelExpandedKeys = computed({
  get: () =>
    Object.fromEntries(navStore.expandedGroups.map((k) => [k, true])),
  set: (newKeys) => {
    const groups = Object.keys(newKeys).filter((k) => newKeys[k])
    navStore.setExpandedGroups(groups)
  },
})

const isVisuallyCollapsed = computed(() => !navStore.isMobile && navStore.isCollapsed)

const isBackdropVisible = computed(() => navStore.dragOffset === null && !navStore.isCollapsed)

const backdropDragStyle = computed(() => {
  if (!navStore.isMobile || navStore.dragOffset === null) return undefined
  const progress = navStore.dragOffset / SIDEBAR_WIDTH
  return {
    opacity: `${progress}`,
    pointerEvents: progress > 0 ? 'auto' as const : 'none' as const,
    transition: 'none',
  }
})

const sidebarDragStyle = computed(() => {
  if (!navStore.isMobile || navStore.dragOffset === null) {return undefined}
  return {
    width: `${navStore.dragOffset}px`,
    '--inner-slide-x': `${(navStore.dragOffset - SIDEBAR_WIDTH) * 0.5}px`,
    '--inner-opacity': `${navStore.dragOffset / SIDEBAR_WIDTH}`,
    '--inner-transition': 'none',
    transition: 'none',
  }
})

const panelMenuPt = {
  root: { style: { background: 'transparent', border: 'none' } },
  panel: { style: { background: 'transparent', border: 'none' } },
  header: { style: { background: 'transparent', padding: '0' } },
  headerContent: {
    style: { background: 'transparent', borderRadius: '4px', padding: '0' },
  },
  content: {
    style: { background: 'transparent', border: 'none', padding: '4px 16px 0 16px' },
  },
  itemContent: { style: { background: 'transparent', borderRadius: '4px' } },
}
</script>

<template>
  <div
    v-if="navStore.isMobile && navStore.isCollapsed"
    class="app-side-nav__swipe-zone"
  />
  <div
    v-if="navStore.isMobile"
    class="app-side-nav__backdrop app-backdrop-blur"
    :class="{ 'is-visible': isBackdropVisible }"
    :style="backdropDragStyle"
    @click="navStore.toggleSidebar()"
  />
  <nav
    class="app-side-nav"
    :class="{
      'is-collapsed': navStore.isCollapsed,
      'is-mobile': navStore.isMobile,
      'is-open': navStore.isMobile && !navStore.isCollapsed,
    }"
    :style="sidebarDragStyle"
  >
    <div class="app-side-nav__header">
      <Transition
        name="nav-fade"
        mode="out-in"
      >
        <img
          :key="isVisuallyCollapsed ? 'mark' : 'full'"
          :src="`${isVisuallyCollapsed ? '/logo.svg' : '/logo_connect.svg'}`"
          alt="Connect"
          :class="
            isVisuallyCollapsed
              ? 'app-side-nav__logo-mark'
              : 'app-side-nav__logo'
          "
          :width="isVisuallyCollapsed ? 36 : 100"
          :height="isVisuallyCollapsed ? 36 : 24"
        />
      </Transition>
    </div>

    <Transition
      name="nav-fade"
      mode="out-in"
    >
    <div
      v-if="!isVisuallyCollapsed"
      class="app-side-nav__nav"
    >
      <template
        v-for="leaf in topLeafItems"
        :key="leaf.key"
      >
        <NuxtLink
          v-if="!leaf.disabled"
          v-slot="{href}"
          :to="leaf.route"
          custom
        >
          <a
            :href="href"
            class="nav-item"
            :class="{
              'is-active': navStore.isRouteActive(leaf.route)
            }"
            @click="handleNavClick(href, $event)"
          >
            <AppNavIcon
              :icon="leaf.icon"
              class="nav-item__icon"
            />
            <span class="nav-item__label">
              {{ leaf.label }}
            </span>
          </a>
        </NuxtLink>
        <a
          v-else
          class="nav-item nav-item--disabled"
          role="link"
          aria-disabled="true"
        >
          <AppNavIcon
            :icon="leaf.icon"
            class="nav-item__icon"
            aria-hidden="true"
          />
          <span class="nav-item__label">
            {{ leaf.label }}
          </span>
        </a>
      </template>

      <PanelMenu
        v-model:expanded-keys="panelExpandedKeys"
        :model="groupItems"
        multiple
        :pt="panelMenuPt"
      >
        <template #item="{item}">
          <NuxtLink
            v-if="item.route && !item.disabled && !item.items"
            v-slot="{href}"
            :to="item.route"
            custom
          >
            <a
              :href="href"
              class="nav-item nav-item--leaf"
              :class="{
                'is-active': navStore.isRouteActive(item.route)
              }"
              @click="handleNavClick(href, $event)"
            >
              <AppNavIcon
                :icon="item.icon"
                class="nav-item__icon"
              />
              <span class="nav-item__label">
                {{ item.label }}
              </span>
            </a>
          </NuxtLink>
          <a
            v-else-if="item.route && item.disabled && !item.items"
            class="nav-item nav-item--leaf nav-item--disabled"
            role="link"
            aria-disabled="true"
          >
            <AppNavIcon
              :icon="item.icon"
              class="nav-item__icon"
              aria-hidden="true"
            />
            <span class="nav-item__label">{{ item.label }}</span>
          </a>
          <a
            v-else
            class="nav-item nav-item--parent"
          >
            <i
              class="pi pi-chevron-right nav-item__chevron"
              :class="{
                'is-expanded': navStore.isGroupExpanded(
                  item.key
                )
              }"
              aria-hidden="true"
            />
            <span class="nav-item__label">{{ item.label }}</span>
          </a>
        </template>
      </PanelMenu>
    </div>

    <!-- Collapsed: icon-only list -->
    <div
      v-else
      class="app-side-nav__nav app-side-nav__nav--icons"
    >
      <template
        v-for="item in leafItems"
        :key="item.key"
      >
        <NuxtLink
          v-if="!item.disabled"
          v-slot="{href}"
          :to="item.route"
          custom
        >
          <a
            v-tooltip.right="item.label"
            :href="href"
            class="nav-icon-btn"
            :class="{
              'is-active': navStore.isRouteActive(item.route)
            }"
            @click="handleNavClick(href, $event)"
          >
            <AppNavIcon :icon="item.icon" />
          </a>
        </NuxtLink>
        <a
          v-else
          v-tooltip.right="item.label"
          class="nav-icon-btn nav-icon-btn--disabled"
        >
          <AppNavIcon :icon="item.icon" />
        </a>
      </template>
    </div>
    </Transition>

    <Transition name="nav-fade">
      <div
        class="app-side-nav__watermark"
        :class="{ 'app-side-nav__watermark--collapsed': isVisuallyCollapsed }"
        aria-hidden="true"
      >
        <svg
          class="app-side-nav__watermark-svg"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 224 195"
          preserveAspectRatio="xMidYMax meet"
          fill="none"
        >
          <g clip-path="url(#app-side-nav-watermark-clip)">
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              fill="white"
              fill-opacity="0.08"
              d="M70.5 0C164.111 0 240 75.8919 240 169.5C240 263.111 164.111 339 70.5 339C-23.1148 339 -99 263.111 -99 169.5C-99 75.8885 -23.1148 0 70.5 0ZM70.5 7.8648C159.769 7.8648 232.135 80.2345 232.135 169.5C232.135 258.769 159.769 331.135 70.5 331.135C-18.7689 331.135 -91.1352 258.769 -91.1352 169.5C-91.1352 80.2311 -18.7621 7.8648 70.5 7.8648Z"
            />
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              fill="white"
              fill-opacity="0.08"
              d="M110.616 317.131C97.5332 320.648 84.0434 322.424 70.4958 322.413C0.0990372 322.413 -59.2429 275.251 -77.3828 210.922C-59.7989 178.789 -40.7945 155.106 -20.3528 139.878C-23.4987 139.81 -27.3939 140.102 -32.0178 140.753C21.8086 86.0449 114.769 81.6583 138.086 141C162.117 157.557 166.887 175.605 146.235 197.061C147.445 187.874 145.842 181.958 142.242 178.158C138.248 173.951 136.58 174.7 131.651 173.87C131.118 173.78 130.587 173.681 130.058 173.571C124.2 172.283 119.875 170.751 105.277 163.449C118.976 173.914 123.539 175.992 127.875 176.365C131.906 177.222 135.191 176.927 138.242 180.08C141.204 183.145 144.716 188.955 143.937 190.738C142.428 187.731 125.654 186.952 118.058 187.158C108.823 187.396 91.4799 208.936 86.4186 216.275C67.0109 244.422 95.6293 293.069 110.62 317.128L110.616 317.131ZM66.8617 180.141C52.2169 183.657 39.5281 191.376 28.7954 203.278C35.0974 199.956 43.4978 197.006 54 194.44C46.7861 199.962 41.8876 203.851 39.3214 206.102L39.2536 206.166C30.8125 213.475 25.2189 220.302 22.4663 226.635C28.8259 219.279 35.989 214.973 43.9521 213.719C34.8228 230.174 30.7718 244.327 31.782 256.196C33.538 247.443 38.2128 240.826 45.8132 236.32C44.2097 252.914 46.898 265.135 53.8814 273.01C51.3186 263.294 52.6034 257.382 57.7324 255.257C60.3427 266.457 70.9806 285.411 89.6425 312.127C75.5808 305.368 66.0142 297.093 60.9631 287.289C60.8851 292.306 62.2513 302.198 65.0582 316.968C51.5864 307.714 41.4062 291.533 34.5109 268.424C29.3446 270.671 25.1308 276.051 21.8493 284.56C17.5914 277.966 15.5202 265.305 15.6388 246.568C8.49947 254.399 1.34317 266.942 -5.84024 284.187C-5.77244 274.397 -5.21648 265 -4.16898 256.009L-4.16219 255.999C-3.18248 247.629 -1.77901 239.598 0.0617523 231.917C-7.76237 233.52 -14.9221 235.754 -21.4241 238.619C-17.1527 226.025 -10.2371 216.177 -0.687439 209.068C-32.7501 214.509 -50.7984 221.916 -54.8257 231.296C-55.4427 219.601 -51.4154 207.983 -42.7167 196.467C-52.0832 199.132 -60.3209 204.698 -67.4298 213.163C-54.1613 182.27 -33.0179 154.967 -3.97575 131.24C-5.8911 131.098 -8.1251 131.271 -10.6879 131.739C23.0968 99.649 97.4361 96.4183 128.133 133.976L118.007 133.881L118.386 157.849C104.352 161.327 85.4728 161.659 71.7501 156.967L71.7162 156.954C84.4863 162.639 95.6631 165.808 105.22 166.479L105.287 174.795C80.4556 173.185 64.2548 172.727 56.6781 173.429C62.1632 174.521 65.56 176.755 66.8617 180.141ZM131.143 145.146C128.261 149.203 125.667 153.457 123.38 157.876C123.722 151.909 126.312 147.665 131.143 145.146Z"
            />
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              fill="white"
              fill-opacity="0.08"
              d="M146.513 302.398C137.548 307.487 128.093 311.659 118.291 314.853C113.193 307.265 108.549 299.382 104.382 291.245C121.434 293.177 135.479 296.899 146.513 302.398ZM196.014 257.647C190.453 265.474 184.172 272.764 177.254 279.421C139.923 263.705 110.996 256.63 90.4765 258.213C87.439 249.372 86.7474 239.249 88.4255 227.859C103.484 222.679 139.343 232.608 196.014 257.647ZM220.964 200.339C218.948 210.15 215.96 219.737 212.045 228.957C189.549 220.275 167.277 212.956 145.238 206.997C155.754 198.488 162.216 188.741 165.521 180.453C180.4 185.067 199.177 192.592 220.964 200.339ZM221.595 141.936C223.229 150.879 224.09 160.086 224.09 169.503C199.116 162.011 177.023 156.733 161.677 153.669C155.724 146.007 150.832 139.946 143.13 135.478C140.103 127.416 136.045 121.213 130.96 116.857C138.187 112.65 168.399 121.013 221.595 141.936ZM176.45 58.7994C190.288 71.9253 201.555 87.5169 209.676 104.775C169.596 88.0279 130.078 79.3055 91.107 78.6071C96.0903 68.3287 103.453 59.0231 113.206 50.6735C131.224 49.0463 152.31 51.7583 176.45 58.7994Z"
            />
            <path
              fill-rule="evenodd"
              clip-rule="evenodd"
              fill="white"
              fill-opacity="0.08"
              d="M70.4995 16.5942C77.1167 16.5942 83.6391 17.0112 90.0293 17.8214L88.4698 20.1944H77.049L85.151 27.4965L77.9778 36.6698L88.6055 29.6288L95.2498 36.6698L94.9888 26.8388L105.481 21.5233L95.121 20.9877L94.9142 18.5164L97.2669 18.9096L97.233 18.9537C104.881 20.3504 110.898 21.7674 115.292 23.2081H115.308L115.353 23.2217C122.044 25.2557 128.546 27.7338 134.818 30.6119C106.722 41.6192 87.5613 61.9185 77.3235 91.52C73.0644 91.2563 68.7962 91.1658 64.5297 91.2488L59.2175 91.4454C58.2819 91.4997 57.353 91.5675 56.4174 91.6319L55.8547 84.6926L50.9493 92.1506C47.7119 92.5235 44.5083 93.0049 41.3319 93.5913H38.5792L39.0674 94.032C33.0547 95.2503 27.1295 96.8664 21.3309 98.8696L21.2563 98.8967L21.0936 98.9577L20.6766 99.1001C19.0359 99.6628 17.3443 100.293 15.6086 100.985L15.6018 100.992L14.2967 101.517L14.2221 101.548L14.1543 101.578L14.0933 101.599L14.0865 101.605L14.0119 101.639L13.9441 101.66L13.8763 101.69L13.8356 101.71L13.3949 101.89L13.3237 101.917C12.2254 102.378 11.0965 102.866 9.95406 103.382H9.93034L9.13029 93.6795L3.28255 102.578H-8.14175L-1.14819 108.887C-11.6877 114.691 -21.8611 121.918 -31.6717 130.586L-31.926 130.817C-36.3487 134.743 -40.6046 138.853 -44.6826 143.136L-46.1403 144.682L-46.1979 144.75L-46.3369 144.896C-49.0623 147.815 -51.7152 150.801 -54.2932 153.852C-50.3066 152.252 -46.7471 151.628 -43.6147 151.998C-53.0627 158.35 -65.1955 174.382 -80.0165 200.095C-82.0625 190.026 -83.0915 179.778 -83.0879 169.504C-83.0879 124.095 -63.2055 83.3196 -31.6446 55.3114L-31.6277 55.2979L-31.4785 55.1623L-30.4954 54.3046L-25.1053 60.01L-25.3731 50.179L-14.8777 44.8635L-18.2406 44.694C-17.6032 44.2397 -16.9727 43.8024 -16.3489 43.3719L-16.2574 43.321L-15.8506 43.0464L-15.7015 42.9413L-15.6065 42.8735L-15.3591 42.7108L-15.1557 42.5684L-15.115 42.5481C-6.23901 36.5993 3.23439 31.5945 13.1508 27.6151L17.3171 31.3713L10.1473 40.5378L20.7749 33.4934L27.416 40.5378L27.1481 30.7034L37.6504 25.3913L27.2837 24.8557L27.1142 22.7979C30.7351 21.7138 34.3995 20.7807 38.0978 20.0012C48.7478 17.7322 59.6104 16.5902 70.4995 16.5942ZM-50.371 121.281L-49.5676 130.98L-39.2077 131.508L-49.7032 136.821L-49.4353 146.662L-56.0865 139.611L-66.7108 146.662L-59.5375 137.488L-67.6464 130.186H-56.2187L-50.371 121.281ZM68.3875 45.4465L69.1265 54.5182L78.8118 55.0165L69.0011 59.9795L69.2553 69.1664L63.0415 62.5898L53.1122 69.1664L59.8142 60.6032L52.2443 53.7758H62.916L68.3875 45.4465ZM15.7408 56.1928L16.4798 65.2577L26.165 65.756L16.3544 70.719L16.6086 79.9127L10.3948 73.3327L0.465454 79.9127L7.16749 71.3428L-0.40239 64.5153H10.2693L15.7374 56.1962L15.7408 56.1928ZM-39.6383 79.516L-38.845 89.2114L-28.4784 89.7471L-38.9704 95.0626L-38.7128 104.894L-45.3538 97.8526L-55.9814 104.894L-48.8048 95.7304L-56.9171 88.4182H-45.486L-39.6383 79.516ZM82.6594 148.814C88.9546 141.556 95.9889 136.627 103.766 134.037C82.0085 125.688 63.255 122.254 47.522 123.732C54.458 125.518 59.5057 127.129 62.6686 128.569C60.2786 140.472 67.3197 146.096 82.6594 148.814ZM75.4557 141.238C67.8417 139.644 65.2958 135.59 67.818 129.068C72.6996 132.153 75.2455 136.204 75.4557 141.238Z"
            />
          </g>
          <defs>
            <clipPath id="app-side-nav-watermark-clip">
              <rect
                width="339"
                height="339"
                fill="white"
                transform="translate(-99)"
              />
            </clipPath>
          </defs>
        </svg>
      </div>
    </Transition>

    <div
      class="app-side-nav__footer"
      :class="{ 'app-side-nav__footer--has-scroll-top': showScrollTop }"
    >
      <Transition
        name="nav-fade"
        mode="out-in"
      >
        <Button
          v-if="showScrollTop"
          text
          rounded
          icon="pi pi-chevron-up"
          class="app-side-nav__scroll-top"
          aria-label="Scroll to top"
          @click="handleScrollTop"
        />
      </Transition>
      <Transition name="nav-fade">
        <button
          v-if="!navStore.isCollapsed && showUpdateDot"
          key="update-cta"
          type="button"
          class="app-side-nav__update-cta animate__animated animate__pulse animate__infinite"
          aria-label="Refresh to update"
          @click="handleRefreshToUpdate"
          @keydown.enter.prevent="handleRefreshToUpdate"
          @keydown.space.prevent="handleRefreshToUpdate"
        >
          <i
            class="pi pi-refresh"
            aria-hidden="true"
          />
          <span
            v-if="pendingVersion"
            class="app-side-nav__update-cta-text"
          >v{{ pendingVersion }}</span>
        </button>
        <button
          v-else-if="navStore.isCollapsed && showUpdateDot"
          key="update-cta-collapsed"
          v-tooltip.right="pendingVersion ? `Refresh to update — v${pendingVersion}` : 'Refresh to update'"
          type="button"
          class="app-side-nav__update-cta-icon animate__animated animate__pulse animate__infinite"
          aria-label="Refresh to update"
          @click="handleRefreshToUpdate"
          @keydown.enter.prevent="handleRefreshToUpdate"
          @keydown.space.prevent="handleRefreshToUpdate"
        >
          <i
            class="pi pi-refresh"
            aria-hidden="true"
          />
        </button>
        <button
          v-else-if="!navStore.isCollapsed"
          key="version-label"
          type="button"
          class="app-side-nav__version"
          aria-label="Version details"
          @click="openVersionDetails"
          @keydown.enter.prevent="openVersionDetails"
          @keydown.space.prevent="openVersionDetails"
        >
          <span class="app-side-nav__version-text-wrap">
            <span class="app-side-nav__version-text">v{{ appVersion }}</span>
          </span>
        </button>
      </Transition>
    </div>
  </nav>
</template>

<style scoped src="./AppSideNav.css"></style>
