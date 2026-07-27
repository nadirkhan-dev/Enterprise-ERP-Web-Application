<script setup lang="ts">
import { useDeployNotification } from '~/composables/useDeployNotification'

type ChangeGroup = {
  title: string
  items: string[]
}

type ReleaseNotesEntry = {
  version: string
  highlights: string
  changes: string[]
  groupedChanges: ChangeGroup[]
}

function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+/.test(value)
}

// Compare two semver-ish strings numerically. Returns a positive number when
// `b` is the newer version, so Array.sort yields newest-first (descending).
function compareVersionsDesc(a: string, b: string): number {
  const partsA = a.split('.').map((part) => parseInt(part, 10) || 0)
  const partsB = b.split('.').map((part) => parseInt(part, 10) || 0)
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsB[i] || 0) - (partsA[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

const { updateAvailable, updatePending, versionDetailsOpen, deployVersion, refresh, dismiss, openVersionDetails } = useDeployNotification()

onMounted(() => {
  // Prefetch release notes the moment the layout boots so the dialog renders
  // synchronously when the user clicks the side-nav version label — no spinner,
  // no layout shift between an empty placeholder and the loaded content.
  loadDialogData()

  try {
    if (sessionStorage.getItem('connect:show-version-details-after-refresh') === '1') {
      sessionStorage.removeItem('connect:show-version-details-after-refresh')
      openVersionDetails()
    }
  } catch {
    // sessionStorage unavailable — silently skip auto-open
  }
})

const runtimeConfig = useRuntimeConfig()
const appVersion = computed(() => String(runtimeConfig.public?.appVersion || '').trim())
const logoSrc = '/logo.svg'

const hasUpdate = computed(() => updatePending.value)
const dialogVisible = computed(() => updateAvailable.value || versionDetailsOpen.value)
const showSimpleUpdatePrompt = computed(() => hasUpdate.value && updateAvailable.value)
const updateTitle = computed(() => (showSimpleUpdatePrompt.value ? 'New version available for Connect' : 'New Version Available'))
const dialogTitle = computed(() => (hasUpdate.value ? updateTitle.value : 'Version Details'))

const dialogStyle = computed(() => {
  if (showSimpleUpdatePrompt.value) {
    return {
      width: '600px',
      maxWidth: 'calc(100vw - 2rem)',
      height: 'auto',
      minHeight: '260px',
      maxHeight: 'calc(100vh - 2rem)',
    }
  }
  return {
    width: '550px',
    maxWidth: 'calc(100vw - 2rem)',
    height: 'auto',
    maxHeight: 'min(80vh, 720px)',
  }
})

const releaseNotes = ref<ReleaseNotesEntry[] | null>(null)
const loading = ref(false)

const effectiveReleaseNotes = computed<ReleaseNotesEntry[]>(() => {
  const list = releaseNotes.value?.length ? [...releaseNotes.value] : []
  // Sort newest-first regardless of the order in release-notes.json, so the
  // navigator pills (rendered oldest→newest) always read in ascending version
  // order — e.g. 1.71.1, 1.71.2, 1.72.0 — and the latest/current logic stays right.
  return list.sort((a, b) => compareVersionsDesc(a.version, b.version))
})

const latestVersion = computed(() => {
  const reported = String(deployVersion.value || '').trim()
  if (reported && isSemver(reported)) return reported
  return effectiveReleaseNotes.value[0]?.version || ''
})

// ── Version navigator (release-notes detail view) ──────────────────────────
// `effectiveReleaseNotes` is newest-first, so index 0 is the latest release.
// The user steps backward/forward through it; the "Current Release" badge only
// shows while the viewed entry is the running app version.
const currentIndex = computed(() => {
  const list = effectiveReleaseNotes.value
  if (!list.length) return -1
  return list.findIndex((entry) => entry.version === appVersion.value)
})

const viewedIndex = ref(0)

// Snap back to the current release whenever the dialog opens or the notes load.
watch(
  () => [versionDetailsOpen.value, currentIndex.value] as const,
  ([isOpen, current]) => {
    if (isOpen) viewedIndex.value = current >= 0 ? current : 0
  },
  { immediate: true },
)

const viewedNotes = computed<ReleaseNotesEntry | null>(() => {
  const list = effectiveReleaseNotes.value
  if (!list.length) return null
  return list[viewedIndex.value] || list[0] || null
})

const isViewingCurrent = computed(() => currentIndex.value >= 0 && viewedIndex.value === currentIndex.value)

// One pill per release, shown oldest → newest so the latest sits on the right
// (matching the design). Clicking a pill swaps the notes shown above.
const versionPills = computed(() =>
  effectiveReleaseNotes.value
    .map((entry, index) => ({ version: entry.version, index, isActive: index === viewedIndex.value }))
    .reverse(),
)

function viewVersion(index: number): void {
  if (index >= 0 && index < effectiveReleaseNotes.value.length) viewedIndex.value = index
}
const versionNavRef = ref<HTMLElement | null>(null)

async function anchorActivePill(): Promise<void> {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  const nav = versionNavRef.value
  const activePill = nav?.querySelector<HTMLElement>('.update-dialog__version-pill-btn--active')
  if (!nav || !activePill) return
  activePill.scrollIntoView({ inline: 'end', block: 'nearest' })
}
watch([versionNavRef, currentIndex], () => {
  anchorActivePill()
})
function handleVersionNavWheel(event: WheelEvent): void {
  const nav = versionNavRef.value
  if (!nav) return
  const maxScrollLeft = nav.scrollWidth - nav.clientWidth
  if (maxScrollLeft <= 0) return

  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (!delta) return

  const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, nav.scrollLeft + delta))
  if (nextScrollLeft === nav.scrollLeft) return

  event.preventDefault()
  nav.scrollLeft = nextScrollLeft
}
const DRAG_THRESHOLD_PX = 4
const isNavDragging = ref(false)

let dragOriginX = 0
let dragOriginScrollLeft = 0
let isPointerDownOnNav = false
let shouldSwallowNextClick = false

function handleVersionNavPointerDown(event: PointerEvent): void {
  const nav = versionNavRef.value
  if (!nav || event.pointerType !== 'mouse' || event.button !== 0) return
  if (nav.scrollWidth <= nav.clientWidth) return

  isPointerDownOnNav = true
  shouldSwallowNextClick = false
  dragOriginX = event.clientX
  dragOriginScrollLeft = nav.scrollLeft
}

function handleVersionNavPointerMove(event: PointerEvent): void {
  const nav = versionNavRef.value
  if (!isPointerDownOnNav || !nav) return

  const travelled = event.clientX - dragOriginX
  if (!isNavDragging.value) {
    if (Math.abs(travelled) < DRAG_THRESHOLD_PX) return
    isNavDragging.value = true
    shouldSwallowNextClick = true
    nav.setPointerCapture(event.pointerId)
  }

  event.preventDefault()
  nav.scrollLeft = dragOriginScrollLeft - travelled
}

function handleVersionNavPointerUp(event: PointerEvent): void {
  const nav = versionNavRef.value
  if (!isPointerDownOnNav) return

  isPointerDownOnNav = false
  if (!isNavDragging.value) return

  isNavDragging.value = false
  if (nav?.hasPointerCapture(event.pointerId)) nav.releasePointerCapture(event.pointerId)
}
function handleVersionNavClickCapture(event: MouseEvent): void {
  if (!shouldSwallowNextClick) return
  shouldSwallowNextClick = false
  event.stopPropagation()
  event.preventDefault()
}

// Animate the dialog's height as release notes of differing lengths swap in:
// track the natural height of the content and let CSS transition between values.
const detailsContentRef = ref<HTMLElement | null>(null)
const detailsHeight = ref('auto')
let detailsResizeObserver: ResizeObserver | null = null

watch(detailsContentRef, (element, _previous, onCleanup) => {
  detailsResizeObserver?.disconnect()
  detailsResizeObserver = null
  if (!element || typeof ResizeObserver === 'undefined') return
  detailsResizeObserver = new ResizeObserver(() => {
    detailsHeight.value = `${element.offsetHeight}px`
  })
  detailsResizeObserver.observe(element)
  onCleanup(() => {
    detailsResizeObserver?.disconnect()
    detailsResizeObserver = null
  })
})

onBeforeUnmount(() => {
  detailsResizeObserver?.disconnect()
})

async function loadDialogData(): Promise<void> {
  if (!import.meta.client) return
  if (loading.value) return

  loading.value = true
  try {
    try {
      const response = await fetch('/release-notes.json', { cache: 'no-store' })
      if (response.ok) {
        const payload = await response.json()
        const versions = Array.isArray(payload) ? payload : payload?.versions

        if (Array.isArray(versions)) {
          releaseNotes.value = versions
            .map((entry: any) => {
              const groups = Array.isArray(entry?.groupedChanges)
                ? entry.groupedChanges
                    .map((group: any) => ({
                      title: String(group?.title || '').trim(),
                      items: Array.isArray(group?.items) ? group.items.map((change: any) => String(change)) : [],
                    }))
                    .filter((group: ChangeGroup) => group.title && group.items.length)
                : []
              return {
                version: String(entry?.version || entry?.name || '').trim(),
                highlights: String(entry?.highlights || '').trim(),
                changes: Array.isArray(entry?.changes) ? entry.changes.map((change: any) => String(change)) : [],
                groupedChanges: groups,
              }
            })
            .filter((entry) => entry.version && (entry.changes.length || entry.groupedChanges.length || entry.highlights))
            .slice(0, 10)
        }
      }
    } catch {
      releaseNotes.value = []
    }
  } finally {
    loading.value = false
  }
}

function handleDismiss(): void {
  dismiss()
}
</script>

<template>
  <Dialog
    :visible="dialogVisible"
    :style="dialogStyle"
    :closable="!hasUpdate"
    :draggable="false"
    dismissableMask
    closeOnEscape
    header=" "
    modal
    :class="['update-dialog', { 'update-dialog--simple': showSimpleUpdatePrompt }]"
    :pt="{ mask: { class: 'app-backdrop-blur' } }"
    @update:visible="handleDismiss"
  >
    <div class="update-dialog__body">
      <template v-if="hasUpdate">
        <template v-if="showSimpleUpdatePrompt">
          <div class="update-dialog__update update-dialog__update--simple">
            <img
              class="update-dialog__logo"
              :src="logoSrc"
              alt="Connect logo"
            >

            <h2 class="update-dialog__heading">
              {{ dialogTitle }}
            </h2>

            <p class="update-dialog__message update-dialog__message--update">
              Hit the Refresh button to upgrade
            </p>
          </div>
        </template>

        <template v-else>
          <div class="update-dialog__update">
            <div class="update-dialog__hero">
              <div class="update-dialog__hero-text">
                <h2 class="update-dialog__heading">
                  {{ dialogTitle }}
                </h2>
              </div>
            </div>

            <div class="update-dialog__cta">
              <Button
                label="Refresh to Update"
                @click="refresh"
              />
              <div class="update-dialog__cta-meta">
                <div>
                  Current: <span class="update-dialog__cta-mono">{{ appVersion ? `v${appVersion}` : '-' }}</span>
                </div>
                <div v-if="latestVersion">
                  Latest: <span class="update-dialog__cta-mono">v{{ latestVersion }}</span>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="effectiveReleaseNotes.length"
            class="update-dialog__release"
          >
            <div class="update-dialog__release-header">
              What's new
            </div>
            <div
              v-for="entry in effectiveReleaseNotes"
              :key="entry.version"
              class="update-dialog__release-section"
            >
              <div class="update-dialog__release-title">
                Version {{ entry.version }}
              </div>
              <ul class="update-dialog__release-list">
                <li
                  v-for="(change, index) in entry.changes"
                  :key="`${entry.version}-${index}`"
                >
                  {{ change }}
                </li>
              </ul>
            </div>
          </div>
        </template>
      </template>

      <template v-else>
        <div class="update-dialog__details">
          <img
            class="update-dialog__logo"
            :src="logoSrc"
            alt="Connect logo"
          >

          <div
            class="update-dialog__details-anim"
            :style="{ height: detailsHeight }"
          >
            <div
              ref="detailsContentRef"
              class="update-dialog__details-content"
            >
              <div class="update-dialog__details-head">
                <h2 class="update-dialog__heading update-dialog__heading--version">
                  Version {{ viewedNotes?.version || appVersion || '—' }}
                </h2>

                <Tag
                  v-if="isViewingCurrent"
                  value="Current Version"
                  severity="success"
                  class="update-dialog__current-tag"
                />
              </div>

              <template v-if="viewedNotes">
                <section
                  v-if="viewedNotes.highlights"
                  class="update-dialog__notes-section"
                >
                  <h3 class="update-dialog__notes-header">
                    Highlights
                  </h3>
                  <p class="update-dialog__notes-text">
                    {{ viewedNotes.highlights }}
                  </p>
                </section>

                <section
                  v-if="viewedNotes.groupedChanges.length || viewedNotes.changes.length"
                  class="update-dialog__notes-section"
                >
                  <h3 class="update-dialog__notes-header">
                    Changes
                  </h3>

                  <template v-if="viewedNotes.groupedChanges.length">
                    <div
                      v-for="group in viewedNotes.groupedChanges"
                      :key="group.title"
                      class="update-dialog__notes-group"
                    >
                      <h4 class="update-dialog__notes-subtitle">
                        {{ group.title }}
                      </h4>
                      <ul class="update-dialog__notes-list">
                        <li
                          v-for="(change, index) in group.items"
                          :key="`${group.title}-${index}`"
                        >
                          {{ change }}
                        </li>
                      </ul>
                    </div>
                  </template>

                  <ul
                    v-else
                    class="update-dialog__notes-list"
                  >
                    <li
                      v-for="(change, index) in viewedNotes.changes"
                      :key="`change-${index}`"
                    >
                      {{ change }}
                    </li>
                  </ul>
                </section>
              </template>
            </div>
          </div>
        </div>
      </template>
    </div>

    <template #footer>
      <div
        v-if="hasUpdate"
        class="update-dialog__actions"
      >
        <template v-if="showSimpleUpdatePrompt">
          <Button
            label="Not Now"
            severity="secondary"
            @click="handleDismiss"
          />
          <Button
            label="Refresh"
            @click="refresh"
          />
        </template>
        <template v-else>
          <Button
            label="Not Now"
            severity="secondary"
            @click="handleDismiss"
          />
        </template>
      </div>
      <nav
        v-else-if="effectiveReleaseNotes.length > 1"
        ref="versionNavRef"
        class="update-dialog__version-nav"
        :class="{ 'update-dialog__version-nav--dragging': isNavDragging }"
        aria-label="Browse versions"
        @wheel="handleVersionNavWheel"
        @pointerdown="handleVersionNavPointerDown"
        @pointermove="handleVersionNavPointerMove"
        @pointerup="handleVersionNavPointerUp"
        @pointercancel="handleVersionNavPointerUp"
        @click.capture="handleVersionNavClickCapture"
      >
        <div class="update-dialog__version-track">
          <Button
            v-for="pill in versionPills"
            :key="pill.index"
            rounded
            outlined
            severity="secondary"
            class="update-dialog__version-pill-btn"
            :class="{ 'update-dialog__version-pill-btn--active': pill.isActive }"
            :aria-current="pill.isActive ? 'true' : undefined"
            :aria-label="`View release notes for version ${pill.version}`"
            @click="viewVersion(pill.index)"
          >
            v{{ pill.version }}
          </Button>
        </div>
      </nav>
      <div
        v-else
        class="update-dialog__footer-spacer"
        aria-hidden="true"
      />
    </template>
  </Dialog>
</template>

<style scoped>
:deep(.update-dialog) {
  overflow: hidden;
  border: 0 !important;
  outline: 1px solid rgba(0, 0, 0, 0.06);
}

.update-dialog__body {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing-3);
  /* Fill the dialog-content height so the loading spinner can grow into
     the remaining space below the version header. */
  min-height: 100%;
}

.update-dialog__heading {
  margin: 0;
  font-size: var(--p-font-size-xl);
  font-weight: var(--p-font-weight-bold);
  color: var(--p-deepblue-900);
  line-height: var(--p-line-height-tight);
}

.update-dialog__message {
  margin: 0;
  font-size: var(--p-font-size-base);
  font-weight: var(--p-font-weight-normal);
  color: var(--p-surface-500);
}

.update-dialog__message--update {
  color: var(--p-gray-800);
  margin-top: calc(var(--p-spacing-4) * -1 + var(--p-spacing-1));
  margin-bottom: clamp(var(--p-spacing-), calc(var(--p-spacing-7) - 2vw), var(--p-spacing-5));
  text-align: center;
}

.update-dialog__update {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing-4);
}

.update-dialog__update--simple {
  align-items: center;
  text-align: center;
  padding: 0 clamp(var(--p-spacing-4), 1.2vw, var(--p-spacing-5)) clamp(var(--p-spacing-3), 0.8vw, var(--p-spacing-4));
}

.update-dialog__logo {
  width: 80px;
  height: auto;
  margin-bottom: calc(var(--p-spacing-4)*0.2);
}

.update-dialog__hero {
  display: flex;
  padding: 0;
  border-radius: 0;
  background: transparent;
  border: 0;
}

.update-dialog__hero-text {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing-1);
  min-width: 0;
}

.update-dialog__cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--p-spacing-3);
}

.update-dialog__cta-meta {
  font-size: var(--p-font-size-sm);
  color: var(--p-surface-600);
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: right;
}

.update-dialog__cta-mono {
  font-family: var(--p-mono-family);
  color: var(--p-surface-900);
}

.update-dialog__actions {
  display: flex;
  justify-content: center;
  gap: var(--p-spacing-2);
  width: 100%;
}

.update-dialog__footer-spacer {
  height: 0;
}

.update-dialog__details {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.update-dialog__heading--version {
  margin-top: var(--p-spacing-3);
}

.update-dialog__current-tag {
  margin-top: var(--p-spacing-2);
  background: var(--p-mildgreen-50);
  color: var(--p-mildgreen-900);
}

/* Wrapper whose height tracks the notes content so the dialog grows/shrinks
   smoothly as the user steps between releases of differing length. */
.update-dialog__details-anim {
  width: 100%;
  overflow: hidden;
  transition: height var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.update-dialog__details-content {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing-3);
}

.update-dialog__details-head {
  display: flex;
  flex-direction: column;
  align-items: center;
}

/* Version navigator pills (release-notes footer). Single row that scrolls
   horizontally — older releases run off the left edge rather than wrapping.
   The scrollbar is hidden by design; the row is reached by swipe or wheel
   (see handleVersionNavWheel). */
.update-dialog__version-nav {
  display: flex;
  width: 100%;
  overflow-x: auto;
  /* Don't let an over-scroll at either end chain to the dialog behind it. */
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.update-dialog__version-nav::-webkit-scrollbar {
  display: none;
}
.update-dialog__version-nav--dragging {
  cursor: grabbing;
  user-select: none;
}

.update-dialog__version-nav--dragging .update-dialog__version-pill-btn.p-button {
  cursor: grabbing;
}
.update-dialog__version-track {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: var(--p-spacing-2);
  margin-inline: auto;
  /* No padding of its own: the footer's inline padding is the gutter. Padding
     here only shows at the extremes of the scroll (the pills clip flush at the
     footer edge in between), so the right-hand gap would grow and shrink as the
     row scrolls while the left stayed put. */
}

/* Version pills — outlined-primary geometry from the Figma spec: small-button
   padding, 7px gap, mono label. PrimeVue supplies the transparent resting state
   plus the skyblue border/hover wash for inactive pills. */
.update-dialog__version-pill-btn.p-button {
  gap: var(--p-spacing-1.75);
  /* Never let the flex row squeeze a pill as the list overflows. */
  flex-shrink: 0;
  padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
  border: 1px solid var(--p-surface-200);
  border-radius: var(--p-button-rounded-border-radius);
  background: var(--p-surface-0);
  color: var(--p-deepblue-900);
  font-family: var(--p-mono-family);
  font-size: var(--p-font-size-xs);
  font-weight: var(--p-font-weight-bold);
  line-height: normal;
  white-space: nowrap;
}

/* Currently-viewed pill stays in the filled "active" state — skyblue wash with
   matching border — even at rest, so it reads as the selected version. */
/* Inactive pills keep the gray outline + navy text in every state — only the
   background changes on hover, to the app-wide light-blue wash (matching the
   icon buttons / close button / Looker link), never PrimeVue's gray. */
.update-dialog__version-pill-btn.p-button:not(.update-dialog__version-pill-btn--active):hover,
.update-dialog__version-pill-btn.p-button:not(.update-dialog__version-pill-btn--active):focus-visible,
.update-dialog__version-pill-btn.p-button:not(.update-dialog__version-pill-btn--active):active {
  border-color: var(--p-surface-200);
  color: var(--p-deepblue-900);
}

.update-dialog__version-pill-btn.p-button:not(.update-dialog__version-pill-btn--active):hover {
  background: var(--p-tideblue-50);
}

.update-dialog__version-pill-btn--active.p-button,
.update-dialog__version-pill-btn--active.p-button:hover,
.update-dialog__version-pill-btn--active.p-button:focus-visible {
  background: var(--p-skyblue-100);
  border: 1px solid var(--p-skyblue-200);
  color: var(--p-skyblue-600);
}

.update-dialog__release {
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing-4);
  padding: var(--p-spacing-4);
  border-radius: var(--p-border-radius-sm);
  background: var(--p-skyblue-50);
  border: 0.5px solid var(--p-skyblue-100);
}

.update-dialog__release-header {
  font-size: var(--p-font-size-sm);
  font-weight: var(--p-font-weight-semibold);
  color: var(--p-surface-900);
  padding-bottom: var(--p-spacing-2);
  border-bottom: 0.5px solid var(--p-skyblue-100);
}

.update-dialog__release-section + .update-dialog__release-section {
  padding-top: var(--p-spacing-4);
  border-top: 0.5px solid var(--p-skyblue-100);
}

.update-dialog__release-title {
  font-size: var(--p-font-size-sm);
  font-weight: var(--p-font-weight-semibold);
  color: var(--p-surface-900);
  margin-bottom: var(--p-spacing-2);
}

.update-dialog__release-list {
  margin: 0;
  padding-left: var(--p-spacing-5);
  color: var(--p-surface-600);
  font-size: var(--p-font-size-sm);
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing-1);
}

.update-dialog__notes-section + .update-dialog__notes-section {
  margin-top: var(--p-spacing-5);
}

.update-dialog__notes-section:last-child {
  padding-bottom: 0;
}

.update-dialog__notes-header {
  display: flex;
  align-items: center;
  gap: var(--p-spacing-3);
  margin: 0 0 var(--p-spacing-3);
  font-size: var(--p-font-size-lg);
  font-weight: var(--p-font-weight-bold);
  color: var(--p-deepblue-900);
}

.update-dialog__notes-header::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--p-surface-200);
}

.update-dialog__notes-text {
  margin: 0;
  font-size: var(--p-font-size-sm);
  color: var(--p-surface-700);
  line-height: var(--p-line-height-normal);
}

.update-dialog__notes-group + .update-dialog__notes-group {
  margin-top: var(--p-spacing-4);
}

.update-dialog__notes-subtitle {
  margin: 0 0 var(--p-spacing-2);
  font-size: var(--p-font-size-base);
  font-weight: var(--p-font-weight-bold);
  color: var(--p-deepblue-900);
}

/* The bullet marker hangs in the dialog's gutter rather than pushing the list in:
   the change text then starts on the same left edge as "Changes", the version
   heading, and the pill row, instead of sitting ~20px further in than all of them. */
.update-dialog__notes-list {
  margin: 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing-2);
  font-size: var(--p-font-size-sm);
  color: var(--p-surface-700);
  line-height: var(--p-line-height-normal);
}

.update-dialog__notes-list > li {
  position: relative;
  /* Room for the marker, which is absolutely positioned at the list's left edge. */
  padding-left: var(--p-spacing-4);
}

.update-dialog__notes-list > li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.5em;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--p-skyblue-100);
}
</style>

<style>
.update-dialog,
.update-dialog .p-dialog-header,
.update-dialog .p-dialog-content,
.update-dialog .p-dialog-footer {
  border-radius: var(--p-border-radius-sm) !important;
}

.update-dialog .p-dialog-footer {
  min-height: var(--p-spacing-12) !important;
  padding: var(--p-spacing-2) var(--p-spacing-4-375) var(--p-spacing-8) !important;
  justify-content: center !important;
  align-items: center !important;
}

/* Gap above the version-pill row ONLY (the release-notes modal). The simple
   "New version available" prompt keeps its buttons close to the message. */
.update-dialog .p-dialog-footer:has(.update-dialog__version-nav) {
  margin-top: var(--p-spacing-6) !important;
}

/* Version Details modal has no footer buttons (just a spacer), so drop the
   min-height — the bottom space is then exactly spacing-8 below the content,
   matching the other two modals. */
.update-dialog .p-dialog-footer:has(.update-dialog__footer-spacer) {
  min-height: 0 !important;
  padding: 0 var(--p-spacing-4-375) var(--p-spacing-8) !important;
}

.update-dialog .p-dialog-header {
  height: var(--p-spacing-8) !important;
  padding-top: 0 !important;
  padding-right: var(--p-spacing-4-375) !important;
  padding-left: var(--p-spacing-4-375) !important;
  padding-bottom: 0 !important;
}

/* The close button is a 32px box around a 16px glyph, so the ✕ itself lands 8px
   inside the header's gutter while the body content and the version pills sit ON
   it. Pull the button out by that 8px: the glyph then aligns with everything else
   down the right edge, and its hover disc still sits inside the dialog. */
.update-dialog .p-dialog-close-button {
  margin-right: calc(var(--p-spacing-2) * -1);
}

/* The "Not Now" action button is borderless — but NOT the version pills, which
   keep their gray outline at all times. */
.update-dialog .p-dialog-footer .p-button-secondary:not(.update-dialog__version-pill-btn) {
  border-color: transparent;
}

/* 32×32 hit area / hover chip around the 16px glyph — PrimeVue's default button
   box is larger, which made both the tap target and the hover wash outsized for
   a header icon. Fixed width + height (border-box) keeps it square. */
.update-dialog .p-dialog-close-button,
.update-dialog .p-dialog-header-icon {
  box-sizing: border-box;
  width: var(--p-spacing-8) !important;
  height: var(--p-spacing-8) !important;
  min-width: var(--p-spacing-8) !important;
  padding: var(--p-spacing-2) !important;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  position: relative;
  top: var(--p-spacing-3);
}

.update-dialog .p-dialog-close-button:focus,
.update-dialog .p-dialog-close-button:focus-visible,
.update-dialog .p-dialog-header-icon:focus,
.update-dialog .p-dialog-header-icon:focus-visible {
  outline: 0 !important;
  box-shadow: none !important;
}

.update-dialog .p-dialog-close-button:focus:not(:focus-visible),
.update-dialog .p-dialog-header-icon:focus:not(:focus-visible) {
  background: transparent !important;
}
.update-dialog .p-dialog-close-button:hover,
.update-dialog .p-dialog-header-icon:hover {
  background: var(--p-tideblue-50) !important;
  border-radius: var(--p-border-radius-xs) !important;
}
/* Lock the dialog as a flex column so the header / footer stay fixed and
   only the content area scrolls. Combined with a fixed height on the
   dialog root, this prevents the modal from resizing when release
   notes finish loading. */
.update-dialog.p-dialog {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.update-dialog .p-dialog-header {
  flex: 0 0 auto;
}

.update-dialog .p-dialog-footer {
  flex: 0 0 auto;
}

.update-dialog .p-dialog-content {
  /* The body scrolls with a visible (thin) scrollbar. `scrollbar-gutter: stable`
     reserves the 6px bar strip INSIDE the padding box, on top of the right
     padding — left read 17.5px, right 23.5px. Deduct the strip from the right
     padding so the content sits on the same 17.5px gutter on BOTH sides as the
     header and footer, with the bar living in the reserved strip beyond it. */
  padding: 0 calc(var(--p-spacing-4-375) - var(--p-spacing-1-5)) 0 var(--p-spacing-4-375) !important;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* Reserved always, so the content doesn't reflow horizontally when the notes
     load and the bar appears. */
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--p-surface-300) transparent;
}

/* 6px bar — matches the strip deducted from the padding above. */
.update-dialog .p-dialog-content::-webkit-scrollbar {
  width: var(--p-spacing-1-5);
}

.update-dialog .p-dialog-content::-webkit-scrollbar-track {
  background: transparent;
}

.update-dialog .p-dialog-content::-webkit-scrollbar-thumb {
  background: var(--p-surface-300);
  border-radius: var(--p-border-radius-sm);
}

.update-dialog .p-dialog-content::-webkit-scrollbar-thumb:hover {
  background: var(--p-surface-400);
}

.update-dialog--simple .p-dialog-content {
  /* Simple update prompt fits within fixed dialog height — no scroll needed, so
     no strip is reserved and the right padding returns to the full gutter. */
  padding-right: var(--p-spacing-4-375) !important;
  overflow-y: hidden !important;
  scrollbar-gutter: auto !important;
  scrollbar-width: none !important;
}

.update-dialog--simple .p-dialog-content::-webkit-scrollbar {
  display: none !important;
}

</style>
