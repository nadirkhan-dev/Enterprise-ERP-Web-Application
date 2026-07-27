<script setup lang="ts">
interface Props {
  visible?: boolean
  title?: string
  width?: 'default' | 'landing'
  hasError?: boolean
  errorMessage?: string
  titleSize?: 'responsive' | 'xl'
  bodyGap?: '4' | '5' | '6'
  /** Block dismissal (Escape / close button) while the form has unsaved changes. */
  dirty?: boolean
  /** Block dismissal while an async operation (e.g. save) is in flight. */
  busy?: boolean
  /** Show the "resume unsaved edits?" yes/no prompt (set by the parent on reopen). */
  showResumePrompt?: boolean
  /** Suppress the footer's top shadow — e.g. when the footer already sits below a
   *  table footer that carries its own scroll shadow (avoids a double shadow). */
  noFooterShadow?: boolean
  /** Drop the drawer content's default bottom padding — for bodies that already
   *  end in their own footer band (e.g. a DataTable counter) where Aura's 20px
   *  bottom inset only adds dead space above the drawer footer buttons. */
  flushContentBottom?: boolean
  /** Vue <Transition> name for animating the header row (title + close icon)
   *  when headerKey changes — e.g. the drawer-slide-* push in drawer.css. */
  headerTransition?: string
  /** Identity of the current header state (e.g. 'list' / 'detail'). Changing it
   *  re-renders the header row through headerTransition. Omit for a static header. */
  headerKey?: string | number
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  title: '',
  width: 'default',
  hasError: false,
  errorMessage: undefined,
  titleSize: 'responsive',
  bodyGap: '4',
  dirty: false,
  busy: false,
  showResumePrompt: false,
  noFooterShadow: false,
  flushContentBottom: false,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
  /** Raised when the user picks "Save changes" in the unsaved-changes dialog. */
  save: []
  /** Raised when the user picks "Close Anyway" — close but preserve the edits. */
  'close-anyway': []
  /** Resume prompt → "Yes": keep the preserved edits. */
  resume: []
  /** Resume prompt → "No": discard the preserved edits and start fresh. */
  'resume-discard': []
}>()

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

// Unsaved-changes guard
// PrimeVue's Drawer hide() is not cancellable and visibility is fully
// prop-controlled — every built-in close path (mask/outside click via
// `dismissable`, Escape via `closeOnEscape`, swipe) ends in an
// `update:visible=false` emit. We bind the Drawer's visibility ONE-WAY
// (`:visible` + `@update:visible`) instead of v-model so that close emit is
// intercepted by onDrawerVisibleChange → requestClose(). Not propagating the
// `false` keeps the prop true, so the drawer stays open.
//
// Every close affordance that dismisses the drawer — clicking the mask
// (outside), pressing Escape, swipe, AND the header X icon — routes through
// requestClose(), which shows the Save/Close-Anyway dialog when the form is
// dirty (so the draft is preserved no matter how the user leaves). Only the
// footer Cancel button is an explicit discard that closes directly via the
// parent's v-model.
const showUnsavedDialog = ref(false)

function requestClose() {
  // A save in flight owns the drawer — ignore close attempts until it settles.
  if (props.busy) return
  if (props.dirty) {
    showUnsavedDialog.value = true
    return
  }
  localVisible.value = false
}

// Intercept every close the PrimeVue Drawer emits (mask click, Escape, swipe).
// Opening is passed straight through; closing is routed through the guard.
function onDrawerVisibleChange(next: boolean) {
  if (next) {
    localVisible.value = true
    return
  }
  requestClose()
}

/** "Close Anyway": close the dialog + drawer.
 *  NOTE: the yes/no draft-resume flow is DISABLED for now — "Close Anyway" just
 *  closes (discards). To re-enable resuming edits on reopen, uncomment the
 *  emit below AND the resume-prompt block in the template. */
function discardChanges() {
  showUnsavedDialog.value = false
  localVisible.value = false
}

/** Hand off to the parent's save flow; it closes the drawer on success. */
function saveChanges() {
  showUnsavedDialog.value = false
  emit('save')
}

const contentRef = ref<HTMLElement | null>(null)
const { isScrollable, showFooterShadow, showHeaderShadow } = useDrawerScroll(contentRef, localVisible)

const drawerPt = computed(() => ({
  header: {
    style: {
      boxShadow: showHeaderShadow.value ? 'var(--p-shadow-md)' : 'none',
      position: 'relative',
      zIndex: 99,
    },
  },
  content: {
    style: {
      position: 'relative',
      zIndex: 0,
      overflowX: 'hidden',
      paddingLeft: 'clamp(var(--p-spacing-4), 2.5vw, var(--p-spacing-6))',
      paddingRight: 'clamp(var(--p-spacing-4), 2.5vw, var(--p-spacing-6))',
      // Only pinned when opted in — inline so it reliably overrides Aura's
      // teleported .p-drawer-content padding (scoped :deep can't reach it).
      ...(props.flushContentBottom ? { paddingBottom: '0' } : {}),
    },
  },
  footer: {
    style: {
      boxShadow: (!props.noFooterShadow && showFooterShadow.value) ? 'var(--p-shadow-top)' : 'none',
    },
  },
  root: {
    style: {
      // Clip BOTH axes. `overflowX: hidden` alone makes the browser promote
      // overflow-y from `visible` to `auto` (CSS spec: the two axes can't mix
      // visible with a clipping value), silently turning the drawer root into a
      // vertical scroll container — anything poking past its bottom edge (e.g.
      // a button's ripple ink unclipped by the loading-veil rule in main.css)
      // then flashes a scrollbar. The root never scrolls by design; the content
      // area handles its own overflow.
      overflow: 'hidden',
    },
  },
}))
</script>

<template>
  <Drawer
    :visible="localVisible"
    position="right"
    :show-close-icon="false"
    :class="width === 'landing' ? 'drawer-width-landing-page' : 'drawer-width'"
    :pt="drawerPt"
    @update:visible="onDrawerVisibleChange"
  >
    <template #header>
      <div :class="`${isScrollable ? 'drawer-header-wrapper-is-scrollable' : 'drawer-header-wrapper'}`">
        <!-- Keying the whole row on headerKey makes the title AND the close
             icon travel through headerTransition together (e.g. the list ⇄
             detail push). Without headerKey the row never re-renders, so the
             Transition is inert for consumers that don't opt in. -->
        <Transition :name="headerTransition">
          <div
            :key="headerKey"
            class="drawer-header"
          >
            <!-- Default is the plain title; consumers can override (e.g. a
                 master-detail "← Back" button) via the #title slot. -->
            <slot name="title">
              <span :class="['drawer-title', { 'drawer-title--xl': titleSize === 'xl' }]">{{ title }}</span>
            </slot>
            <Button
              icon="pi pi-times"
              text
              rounded
              severity="secondary"
              @click="requestClose"
            />
          </div>
        </Transition>
        <slot name="header" />
      </div>
    </template>

    <Error500
      v-if="hasError"
      mode="inline"
      :message="errorMessage"
    />

    <div
      v-else
      ref="contentRef"
      :class="[
        'drawer-body',
        { 'drawer-body--gap-5': bodyGap === '5' },
        { 'drawer-body--gap-6': bodyGap === '6' },
        { 'is-scrollable': isScrollable },
      ]"
    >
      <slot :is-scrollable="isScrollable" />
    </div>

    <!-- Resume-unsaved-edits prompt (yes/no draft) — DISABLED for now.
         "Close Anyway" just closes; no draft is preserved and no prompt shows.
         To re-enable: uncomment this block AND the emit('close-anyway') in
         discardChanges() above.

    <Teleport to="body">
      <div
        v-if="showResumePrompt"
        class="drawer-resume-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-resume-prompt-message"
      >
        <div class="drawer-resume-prompt__card">
          <Button
            icon="pi pi-times"
            text
            rounded
            severity="secondary"
            aria-label="Discard unsaved changes"
            class="drawer-resume-prompt__close"
            @click="$emit('resume-discard')"
          />
          <p
            id="drawer-resume-prompt-message"
            class="drawer-resume-prompt__message"
          >
            There are unsaved changes. Would you like to continue?
          </p>
          <div class="drawer-resume-prompt__actions">
            <Button
              label="No"
              outlined
              severity="secondary"
              @click="$emit('resume-discard')"
            />
            <Button
              label="Yes"
              @click="$emit('resume')"
            />
          </div>
        </div>
      </div>
    </Teleport>
    -->

    <template
      v-if="!hasError && $slots.footer"
      #footer
    >
      <slot name="footer" />
    </template>
  </Drawer>

  <!-- Unsaved-changes confirmation — shown when a dismissal is attempted while
       the form is dirty. Closing it (X / Escape) means "keep editing". -->
  <DialogUnsavedChanges
    v-model:visible="showUnsavedDialog"
    @save="saveChanges"
    @discard="discardChanges"
  />
</template>

<style scoped>
:deep(.p-drawer-content) {
    padding: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
}

/* position: relative — containing block for the leaving header row when the
   headerTransition push absolutely positions it (drawer-slide-* in drawer.css). */
.drawer-header-wrapper {
    position: relative;
    width: 100%;
    display: grid;
    gap: var(--p-spacing-3);
}

.drawer-header-wrapper-is-scrollable {
    position: relative;
    width: 100%;
    display: grid;
    gap: var(--p-spacing-3);

    @media (min-width: 768px) {
    }
}

.drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
}

:deep(.drawer-header .p-button) {
    border-radius: var(--p-border-radius-sm);
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        color var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

/* Light-blue bg + brand-blue icon on hover/focus/active — consistent with
   BaseIconButton / the top nav. */
:deep(.drawer-header .p-button:hover),
:deep(.drawer-header .p-button:focus-visible),
:deep(.drawer-header .p-button:active) {
    background: var(--p-tideblue-50);
    color: var(--p-skyblue-600);
}

.drawer-title {
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);

    @media (min-width: 768px) {
        font-size: var(--p-font-size-xl);
    }
}

.drawer-title--xl {
    font-size: var(--p-font-size-xl);
}

.drawer-body {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
    padding: 0;
    flex: 1;

    /* @media (min-width: 768px) {
      padding: 0 var(--p-spacing-2) 0 0;
    } */
}

.drawer-body--gap-5 {
    gap: var(--p-spacing-5);
}

.drawer-body--gap-6 {
    gap: var(--p-spacing-6);
}

/* Pinned to the drawer's footprint (right side, full height) rather than the
   scrolling content, so the card stays vertically centred in the VISIBLE drawer
   regardless of how far the body is scrolled. */
.drawer-resume-prompt {
    position: fixed;
    top: 0;
    bottom: 0;
    right: 0;
    width: min(var(--p-layout-drawer-width), 100vw);
    /* Above the PrimeVue drawer panel/mask (teleported to <body>). */
    z-index: 1300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--p-spacing-4);
    pointer-events: none;
}

.drawer-resume-prompt__card {
    pointer-events: auto;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 350px;
    background: var(--p-surface-0);
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    box-shadow: var(--p-shadow-md);
    padding: var(--p-spacing-4-375);
    gap: var(--p-spacing-3);
}

.drawer-resume-prompt__close {
    align-self: flex-end;
    margin: 0;
}

.drawer-resume-prompt__message {
    margin: 0;
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
    line-height: var(--p-spacing-5-5);
}

.drawer-resume-prompt__actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--p-spacing-2);
}

.drawer-resume-prompt__actions :deep(.p-button) {
    min-width: var(--p-spacing-12);
    justify-content: center;
}
</style>
