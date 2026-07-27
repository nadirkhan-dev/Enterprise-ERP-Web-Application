<script setup lang="ts">
import { useSearchStore } from '~/stores/search'

interface ProfileTab {
  label: string
  icon?: string
  sectionId?: string
}

interface ChartBar {
  label: string
  bookedSales: number
  orderCount: number
}

const props = withDefaults(defineProps<{
  tabs: ProfileTab[]
  chartBars?: ChartBar[]
  lookerUrl?: string | null
  isChartLoading?: boolean
  bookedSalesLabel?: string
  orderCountLabel?: string
  primaryMode?: 'bookedSales' | 'orderCount'
  // Reserve the chart's vertical space so the card keeps a stable height even when
  // the chart has no data or its load failed (chartBars empty + not loading).
  // Defaults true because every current ProfileCard shows a chart; a chart-less
  // card can pass :has-chart="false" to stay compact.
  hasChart?: boolean
}>(), {
  chartBars: () => [],
  lookerUrl: null,
  isChartLoading: false,
  bookedSalesLabel: 'Booked Sales',
  orderCountLabel: 'Order Count',
  primaryMode: 'bookedSales',
  hasChart: true,
})

const SCROLL_STEP = 200
const TAB_SWITCH_OFFSET = 20
const DESKTOP_TAB_SWITCH_OFFSET = 32

const searchStore = useSearchStore()

const isSticky = ref(false)
const sentinelRef = ref<HTMLElement | null>(null)
const tabsRef = ref<HTMLElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)

const activeTabIndex = ref<number | null>(null)

const hasOverflowLeft = ref(false)
const hasOverflowRight = ref(false)

const isMobile = ref(false)
const stickyTop = ref(64)

let stickyObserver: IntersectionObserver | null = null
let resizeObserver: ResizeObserver | null = null
let mobileQuery: MediaQueryList | null = null

let handleMobileChange: ((event: MediaQueryListEvent | MediaQueryList) => void) | null = null
let handleResize: (() => void) | null = null

let ticking = false
let lastScrollY = 0
let isProgrammaticScroll = false
let programmaticScrollTimer: ReturnType<typeof setTimeout> | null = null

function updateOverflow() {
  const el = scrollRef.value
  if (!el) return

  hasOverflowLeft.value = el.scrollLeft > 1
  hasOverflowRight.value =
    el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function scrollTabsLeft() {
  scrollRef.value?.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' })
}

function scrollTabsRight() {
  scrollRef.value?.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' })
}

async function updateStickyTop() {
  await nextTick()
  const topNav = document.querySelector('.app-top-nav') as HTMLElement | null
  // Use getBoundingClientRect for fractional precision and overlap by 1px
  // so sub-pixel rounding never leaves a hairline gap under the top nav.
  const navHeight = topNav?.getBoundingClientRect().height ?? 64
  stickyTop.value = Math.max(0, Math.floor(navHeight) - 1)
}

function getSectionAnchor(section: HTMLElement) {
  return (section.querySelector('.base-panel__header') as HTMLElement | null) ?? section
}

function getTabSwitchOffset() {
  return isMobile.value ? TAB_SWITCH_OFFSET : DESKTOP_TAB_SWITCH_OFFSET
}

/* SAFE scroll spy (FIXED) - direction aware - no bottom triggering bug */
function syncActiveTabFromScroll() {
  // During a user-initiated smooth scroll, the click already set the correct
  // active tab — don't let the spy reset it before the scroll settles.
  if (isProgrammaticScroll) return

  const currentScrollY = window.scrollY
  const isScrollingUp = currentScrollY < lastScrollY
  lastScrollY = currentScrollY

  // When the page is above the sticky sentinel (profile card still fully in
  // view), no section is being actively viewed — clear any active tab.
  if (!isSticky.value) {
    if (activeTabIndex.value !== null) {
      activeTabIndex.value = null
    }
    return
  }

  const tabsRect = tabsRef.value?.getBoundingClientRect()
  const activationLineTop =
    (tabsRect?.bottom ?? stickyTop.value + (tabsRef.value?.offsetHeight ?? 0)) +
    getTabSwitchOffset()
  const anchors = props.tabs.flatMap((tab, idx) => {
    if (!tab.sectionId) return []

    const section = document.getElementById(tab.sectionId)
    if (!section) return []

    return [{
      idx,
      top: getSectionAnchor(section).getBoundingClientRect().top,
    }]
  })

  const lastCrossedHeading = [...anchors]
    .reverse()
    .find(({ top }) => top <= activationLineTop)

  let newIndex = activeTabIndex.value

  if (newIndex === null || !isScrollingUp) {
    // Scrolling down (or no active yet): snap to the section currently under
    // the activation line. This advances fully even if the user scrolls past
    // multiple sections in one frame.
    newIndex = lastCrossedHeading?.idx ?? null
  } else if (!lastCrossedHeading) {
    // Scrolled up past the first section — no card is in the active zone.
    newIndex = null
  } else {
    // Scrolling up: only retreat to the previous tab once its section header
    // has actually come into view below the sticky bar. Keeps the active tab
    // on the currently visible card until the prior card is visible.
    const previousAnchor = [...anchors]
      .filter(({ idx }) => idx < newIndex!)
      .pop()

    if (
      previousAnchor &&
      previousAnchor.top >= activationLineTop &&
      previousAnchor.top < window.innerHeight
    ) {
      newIndex = previousAnchor.idx
    }
  }

  if (newIndex !== activeTabIndex.value) {
    activeTabIndex.value = newIndex
  }
}

function handleWindowScroll() {
  if (ticking) return
  ticking = true

  requestAnimationFrame(() => {
    syncActiveTabFromScroll()
    ticking = false
  })
}

function scrollToSection(sectionId: string | undefined, idx: number) {
  if (idx >= 0) activeTabIndex.value = idx
  if (!sectionId) return

  const section = document.getElementById(sectionId)
  if (!section) return

  const topNav = document.querySelector('.app-top-nav') as HTMLElement | null
  const topNavHeight = topNav ? topNav.offsetHeight : 0
  const tabsHeight = tabsRef.value?.offsetHeight ?? 0
  const target = getSectionAnchor(section)

  const targetY =
    target.getBoundingClientRect().top +
    window.scrollY -
    topNavHeight -
    tabsHeight -
    getTabSwitchOffset()

  // Guard the scroll-spy while the user-initiated smooth scroll is in flight
  // so it doesn't wipe activeTabIndex before the page becomes sticky.
  isProgrammaticScroll = true
  if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer)
  programmaticScrollTimer = setTimeout(() => {
    isProgrammaticScroll = false
  }, 800)

  window.scrollTo({ top: targetY, behavior: 'smooth' })
}

function handleTabClick(event: MouseEvent, sectionId: string | undefined, idx: number) {
  // Let modifier-clicks (new tab, etc.) use native browser behavior
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  if (!sectionId) return

  event.preventDefault()
  scrollToSection(sectionId, idx)
  // Keep the URL in sync so the hash is shareable / back-button-friendly
  if (window.location.hash !== `#${sectionId}`) {
    history.replaceState(null, '', `#${sectionId}`)
  }
}

function scrollToHashOnLoad() {
  const hash = window.location.hash.slice(1)
  if (!hash) return

  const idx = props.tabs.findIndex((tab) => tab.sectionId === hash)
  if (idx < 0) return

  nextTick(() => scrollToSection(hash, idx))
}

onMounted(() => {
  if (!sentinelRef.value) return

  stickyObserver = new IntersectionObserver(([entry]) => {
    isSticky.value = !entry.isIntersecting
  }, { rootMargin: '-65px 0px 0px 0px' })

  stickyObserver.observe(sentinelRef.value)

  mobileQuery = window.matchMedia('(max-width: 767px)')

  handleMobileChange = (e) => {
    isMobile.value = e.matches
    updateStickyTop()
    nextTick(syncActiveTabFromScroll)
  }

  handleMobileChange(mobileQuery)
  mobileQuery.addEventListener('change', handleMobileChange)

  nextTick(() => {
    updateOverflow()

    if (scrollRef.value) {
      scrollRef.value.addEventListener('scroll', updateOverflow, { passive: true })
      resizeObserver = new ResizeObserver(updateOverflow)
      resizeObserver.observe(scrollRef.value)
    }
  })

  handleResize = () => {
    updateStickyTop()
    updateOverflow()
    syncActiveTabFromScroll()
  }

  window.addEventListener('resize', handleResize)
  window.addEventListener('scroll', handleWindowScroll, { passive: true })

  nextTick(syncActiveTabFromScroll)
  scrollToHashOnLoad()
})

watch(isSticky, (val) => {
  document.documentElement.toggleAttribute('data-detailnav-sticky', val)
  nextTick(updateOverflow)
})

watch(activeTabIndex, (idx) => {
  if (idx === null) return

  nextTick(() => {
    const el = scrollRef.value?.children?.[idx] as HTMLElement | undefined
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  })
})

watch(
  () => searchStore.hasSearchQuery,
  () => {
    updateStickyTop()
    nextTick(syncActiveTabFromScroll)
  },
)

onBeforeUnmount(() => {
  stickyObserver?.disconnect()
  resizeObserver?.disconnect()
  if (programmaticScrollTimer) clearTimeout(programmaticScrollTimer)

  document.documentElement.removeAttribute('data-detailnav-sticky')

  if (mobileQuery && handleMobileChange) {
    mobileQuery.removeEventListener('change', handleMobileChange)
  }

  if (handleResize) {
    window.removeEventListener('resize', handleResize)
  }

  window.removeEventListener('scroll', handleWindowScroll)

  if (scrollRef.value) {
    scrollRef.value.removeEventListener('scroll', updateOverflow)
  }
})
</script>
<template>
  <div class="profile-card-wrapper">
    <div class="profile-card__avatar-container">
      <slot name="avatar" />
    </div>

    <div
      class="profile-card"
      :class="{ 'has-chart': hasChart || chartBars.length > 0 || isChartLoading }"
    >
      <div class="profile-card__header">
        <div class="profile-card__header-left">
          <slot name="header-left" />
        </div>
        <div class="profile-card__header-right">
          <slot name="header-right" />
        </div>
      </div>

      <ProfileChart
        :chart-bars="chartBars"
        :looker-url="lookerUrl"
        :is-chart-loading="isChartLoading"
        :booked-sales-label="bookedSalesLabel"
        :order-count-label="orderCountLabel"
        :primary-mode="primaryMode"
        :has-chart="hasChart"
      />

      <div class="profile-card__identity">
        <slot name="identity" />
      </div>
    </div>
  </div>

  <div
    ref="sentinelRef"
    class="profile-card__sticky-sentinel"
  />

  <!-- Tabs — unified horizontal scroll strip across all viewports -->
  <nav
    ref="tabsRef"
    class="profile-card__tabs"
    :class="{
      'is-sticky': isSticky,
      'has-overflow-left': hasOverflowLeft,
      'has-overflow-right': hasOverflowRight,
    }"
    :style="{ '--profile-tabs-sticky-top': `${stickyTop}px` }"
  >
    <div
      ref="scrollRef"
      class="profile-card__tabs-scroll"
    >
      <a
        v-for="(tab, idx) in tabs"
        :key="tab.label"
        :href="tab.sectionId ? `#${tab.sectionId}` : undefined"
        class="profile-card__tab-link"
        :class="{ 'is-active': idx === activeTabIndex }"
        :aria-current="idx === activeTabIndex ? 'true' : undefined"
        @click="handleTabClick($event, tab.sectionId, idx)"
      >
        <AppNavIcon
          v-if="tab.icon"
          :icon="tab.icon"
          aria-hidden="true"
        />
        <span>{{ tab.label }}</span>
      </a>
    </div>

    <div
      v-if="hasOverflowLeft || hasOverflowRight"
      class="profile-card__tabs-frozen"
    >
      <div class="scroll-nav">
        <Button
          icon="pi pi-angle-left"
          outlined
          size="small"
          severity="secondary"
          @click="scrollTabsLeft"
        />
        <Button
          icon="pi pi-angle-right"
          outlined
          size="small"
          severity="secondary"
          @click="scrollTabsRight"
        />
      </div>
    </div>
  </nav>
</template>

<style scoped>
/* Wrapper — positions avatar relative to card */
.profile-card-wrapper {
    --profile-avatar-size: 120px;
    --profile-avatar-overlap: calc(var(--profile-avatar-size) / 2);

    position: relative;
    padding-top: calc(var(--profile-avatar-size) - var(--profile-avatar-overlap));
    border-bottom: none;

    @media (min-width: 768px) {
        --profile-avatar-size: 150px;
        --profile-avatar-overlap: calc(var(--profile-avatar-size) / 2);
    }
}

/* Avatar container — centered above card */
.profile-card__avatar-container {
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: var(--profile-avatar-size);
    height: var(--profile-avatar-size);
    z-index: 1;
}

.profile-card {
    position: relative;
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-xs);
    box-shadow: var(--p-shadow-sm);
    padding: var(--profile-avatar-overlap) clamp(var(--p-spacing-4), 2vw, var(--p-spacing-6)) clamp(var(--p-spacing-4), 2vw, var(--p-spacing-6));
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
}

.profile-card.has-chart {
    min-height: 340px;

    @media (min-width: 768px) {
        min-height: 320px;
    }
}

/* Header bar — absolute top row */
.profile-card__header {
    position: absolute;
    top: var(--p-spacing-2);
    left: var(--p-spacing-2);
    right: var(--p-spacing-2);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    container-type: inline-size;

    @media (min-width: 768px) {
        top: var(--p-spacing-3);
        left: var(--p-spacing-3);
        right: var(--p-spacing-3);
        align-items: center;
    }
}

.profile-card__header-left {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--p-spacing-2);
    padding-left: var(--p-spacing-1);
    padding-top: var(--p-spacing-1);
    padding-right: var(--p-spacing-2);
    max-width: calc(50% - var(--profile-avatar-overlap));

    @media (min-width: 768px) {
        gap: var(--p-spacing-4);
        padding-left: 0;
        padding-top: 0;
        padding-right: 0;
        max-width: none;
    }
}

:deep(.profile-card__header-left .base-copy-text__text-right) {
    margin-left: 0;

    @media (min-width: 768px) {
        margin-left: var(--p-spacing-2);
    }
}

.profile-card__header-right {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    justify-content: flex-end;
    padding-top: var(--p-spacing-1);
    max-width: calc(50% - var(--profile-avatar-overlap));
    overflow: hidden;

    @media (min-width: 768px) {
        padding-top: 0;
        max-width: none;
        overflow: visible;
    }
}

/* Identity — centered name + chips area */
.profile-card__identity {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-2);
}

.profile-card.has-chart .profile-card__identity {
    margin-top: calc(var(--p-spacing-12) + var(--p-spacing-5) - var(--p-spacing-2)*1);
    margin-bottom: auto;
    /* Identity sits over the chart backdrop — gaps between rows pass mouse
       events through to the chart bars below, while direct children (name
       pill, chip group, etc.) still catch their own events so the chart
       tooltip doesn't bleed through visible labels. */
    pointer-events: none;

    @media (min-width: 768px) {
        margin-top: calc(var(--p-spacing-12) + var(--p-spacing-3));
    }
}

.profile-card.has-chart .profile-card__identity > * {
    pointer-events: auto;
}

/* Chart backdrop styles live in ProfileChart.vue */

/* Sticky sentinel — invisible marker for IntersectionObserver */
.profile-card__sticky-sentinel {
    height: 0;
    margin-top: calc(-1 * var(--p-spacing-4));
    padding: 0;
}

/* Nav tabs — unified horizontal scroll strip */
.profile-card__tabs {
    margin-top: calc(-1 * var(--p-spacing-4));
    /* Container vertical padding moved into the tab-links themselves so
       each link's full vertical span is clickable instead of just the
       compact 24px text area. Bar height unchanged. */
    padding: 0 clamp(var(--p-spacing-2), 2vw, var(--p-spacing-8));
    background: var(--p-surface-0);
    position: sticky;
    top: var(--profile-tabs-sticky-top, 64px);
    z-index: 90;
    transition:
        box-shadow var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        border-top-color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
    border-top: 1px solid var(--p-surface-100);
    box-shadow: var(--p-shadow-sm);
    overflow: hidden;
  }

/* Scroll container — single row, hidden scrollbar */
.profile-card__tabs-scroll {
    display: flex;
    align-items: stretch;
    flex-wrap: nowrap;
    white-space: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior-x: contain;
}
.profile-card__tabs.has-overflow-left .profile-card__tabs-scroll,
.profile-card__tabs.has-overflow-right .profile-card__tabs-scroll {
    @media (min-width: 1024px) {
        padding-right: calc(var(--p-spacing-8) * 2 + var(--p-spacing-2));
    }
}

.profile-card__tabs-scroll::-webkit-scrollbar {
    display: none;
}

/* Center tabs when they fit; left-aligned naturally when they overflow */
.profile-card__tabs-scroll > :first-child {
    margin-left: auto;
}
.profile-card__tabs-scroll > :last-child {
    margin-right: auto;
}

.profile-card__tabs.is-sticky {
    /* Break the bar's background + shadow out to the full content width
       (edge-to-edge under the top nav) with negative side margins, then add the
       SAME amount back as padding. The border box widens so the surface fills
       edge-to-edge, but the content box — and therefore every tab's position —
       stays byte-for-byte identical to the non-sticky state. Nothing in flow
       moves the instant the bar sticks, so there is no horizontal snap. */
    margin-left: calc(-1 * clamp(var(--p-spacing-2), 2vw, var(--p-spacing-8)));
    margin-right: calc(-1 * clamp(var(--p-spacing-2), 2vw, var(--p-spacing-8)));
    padding-left: calc(clamp(var(--p-spacing-2), 2vw, var(--p-spacing-8)) * 2);
    padding-right: calc(clamp(var(--p-spacing-2), 2vw, var(--p-spacing-8)) * 2);
    box-shadow: var(--p-shadow-md);
    /* Keep the 1px top border in the box but make it invisible rather than
       removing it, so the bar's height never changes → no 1px vertical jump. */
    border-top-color: transparent;
}

.profile-card__tabs-frozen {
    display: none;
    position: absolute;
    top: 50%;
    right: var(--p-spacing-2);
    transform: translateY(-50%);
    align-items: center;
    justify-content: center;
    min-height: 100%;
    padding-left: var(--p-spacing-2);
    background: var(--p-surface-0);

    @media (min-width: 1024px) {
        display: flex;
    }
    box-shadow: -4px 0 8px rgba(0, 0, 0, var(--p-opacity-5));
}

.profile-card__tabs.is-sticky .profile-card__tabs-frozen {
    right: 0;
    padding-right: var(--p-spacing-2);

    @media (min-width: 768px) {
        padding-right: clamp(var(--p-spacing-2), 2vw, var(--p-spacing-8));
    }
}

/* Tab link — semantic anchor with hash navigation */
.profile-card__tab-link {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
    /* Expanded vertical hit area (~40px). Was 24px (spacing-6) which felt
       tight on mobile. Text + icon stay centered, so the visible content
       position is unchanged — only the invisible click box grows. */
    min-height: var(--p-spacing-10);
    padding: 0 clamp(var(--p-spacing-2), 1.5vw, var(--p-spacing-3));
    color: var(--p-primary-500);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-medium);
    text-decoration: none;
    white-space: nowrap;
    flex-shrink: 0;
    border-radius: var(--p-border-radius-xs);
    transition: color var(--p-transition-duration-fast) var(--p-transition-timing-ease-out);
    /* Hover bg lives on ::before so it wraps just the visible content
       height, not the full 40px hit area. */
    position: relative;
    isolation: isolate;
}

.profile-card__tab-link::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    transform: translateY(-50%);
    height: var(--p-spacing-7);
    border-radius: var(--p-border-radius-xs);
    background: transparent;
    transition: background var(--p-transition-duration-fast) var(--p-transition-timing-ease-out);
    z-index: -1;
}

@media (hover: hover) {
    .profile-card__tab-link:hover::before {
        background: var(--p-tideblue-50);
    }
}

.profile-card__tab-link.is-active {
    color: var(--p-deepblue-900);
    font-weight: var(--p-font-weight-medium);
}

.profile-card__tab-link:focus-visible {
    outline: 2px solid var(--p-primary-500);
    outline-offset: var(--p-spacing-1);
}

.profile-card__tab-link .pi {
    font-size: var(--p-font-size-xs);
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

/* Material Symbols tabs (AppNavIcon's inline <svg>) size themselves off the
   inherited font-size; they only need protecting from the flex row squeezing
   them when the tab strip overflows. */
.profile-card__tab-link .app-nav-icon-svg {
    flex-shrink: 0;
}

:deep(.pi) {
    font-size: var(--p-font-size-xs);
}
</style>
