<script setup lang="ts">
import EnterpriseInquiryCard from '~/components/EnterpriseInquiryCard.vue'
import { useCardSwapTransition } from '~/composables/useCardSwapTransition'

const isEnterpriseInquiryOpen = ref(false)
// Shared with Login.vue (and any other auth page) — pages can set this to
// true when their content takes over the full card stage on mobile (e.g.
// TFA setup/complete), so the brand panel hides instead of stacking.
const isAuthBrandHidden = useState('authBrandHidden', () => false)

const isMobileBrandHidden = computed(
  () => isEnterpriseInquiryOpen.value || isAuthBrandHidden.value,
)

function openEnterpriseInquiry() {
  isEnterpriseInquiryOpen.value = true
}

const swap = useCardSwapTransition()
</script>

<template>
  <div class="auth-shell">
    <aside
      class="auth-shell__brand"
      :class="{ 'auth-shell__brand--hidden-mobile': isMobileBrandHidden }"
    >
      <div class="auth-shell__brand-inner">
        <span
          class="auth-shell__wordmark"
          aria-label="Connect"
          role="img"
        />
        <p class="auth-shell__enterprise">
          Are you an Enterprise User?
          <Button
            label="Let's Talk"
            icon="pi pi-arrow-right"
            icon-pos="right"
            size="small"
            severity="secondary"
            class="auth-shell__enterprise-cta"
            @click="openEnterpriseInquiry"
          />
        </p>
      </div>
    </aside>

    <section class="auth-shell__stage">
      <img
        class="auth-shell__stage-bg"
        src="/loginbg2-small.webp"
        srcset="/loginbg2-small.webp 900w, /loginbg2-large.webp 1600w"
        sizes="50vw"
        alt=""
        aria-hidden="true"
        decoding="async"
        fetchpriority="low"
        loading="lazy"
      >
      <Transition
        name="card-swap"
        mode="out-in"
        @before-enter="swap.onBeforeEnter"
        @enter="swap.onEnter"
        @leave="swap.onLeave"
      >
        <EnterpriseInquiryCard
          v-if="isEnterpriseInquiryOpen"
          key="inquiry"
          @close="isEnterpriseInquiryOpen = false"
        />
        <div
          v-else
          key="slot"
          class="auth-shell__slot"
        >
          <slot />
        </div>
      </Transition>
    </section>

    <Toast />
  </div>
</template>

<style scoped>
/* Mobile base: navy fills viewport, card overlays, enterprise at bottom */
.auth-shell {
    position: relative;
    isolation: isolate;
    min-height: 100vh;
    min-height: 100dvh;
    display: flex;
    flex-direction: column-reverse;
    justify-content: center;
    gap: var(--p-spacing-6);
    padding: clamp(var(--p-spacing-3), 3vh, var(--p-spacing-8)) 0;
    background: var(--p-deepblue-900);
}

.auth-shell::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: url('/login-mark.svg');
    background-repeat: no-repeat;
    background-position: left top;
    background-size: auto 115%;
    opacity: var(--p-opacity-30);
    pointer-events: none;
    z-index: 0;
}

.auth-shell__brand {
    color: var(--p-surface-0);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 0 clamp(var(--p-spacing-6), 5vw, var(--p-spacing-12));
    z-index: 1;
}

.auth-shell__brand--hidden-mobile {
    display: none;
}

.auth-shell__brand::before {
    display: none;
}

.auth-shell__brand-inner {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: min(100%, 438px);
    gap: 0;
    text-align: center;
}

.auth-shell__wordmark {
    display: none;
    width: clamp(320px, 38vw, 600px);
    max-width: 100%;
    aspect-ratio: 132 / 16;
    background-color: var(--p-surface-0);
    -webkit-mask-image: url('/CONNECT.svg');
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: center;
    -webkit-mask-size: contain;
    mask-image: url('/CONNECT.svg');
    mask-repeat: no-repeat;
    mask-position: center;
    mask-size: contain;
    opacity: var(--p-opacity-50);
}

.auth-shell__enterprise {
    margin: 0;
    width: 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-4);
    color: var(--p-surface-0);
    text-align: center;
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-base);
    font-style: normal;
    font-weight: var(--p-font-weight-normal);
    line-height: normal;
}

/* "Let's Talk" CTA — small raised secondary button (gray.50 fill, deepblue
   label) per Figma. Colours/padding/radius come from the secondary button
   theme; here we add the raised shadow and the semibold small label. */
.auth-shell__enterprise-cta {
    box-shadow: var(--p-shadow-raised);
}

/* Keep the resting secondary colours on interaction — no background shift on
   hover/focus/active (only the label + arrow animate). */
.auth-shell__enterprise-cta.p-button:hover,
.auth-shell__enterprise-cta.p-button:focus-visible,
.auth-shell__enterprise-cta.p-button:active {
    background: var(--p-gray-50);
    border-color: var(--p-gray-50);
    color: var(--p-deepblue-900);
}

.auth-shell__enterprise-cta.p-button {
    position: relative;
    overflow: hidden;
    padding-inline: var(--p-spacing-4);
    gap: 0;
}

.auth-shell__enterprise-cta :deep(.p-button-label) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: calc(var(--p-spacing-3-5) + var(--p-spacing-px));
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-semibold);
    line-height: var(--p-font-line-height-none);
    transition: transform var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.auth-shell__enterprise-cta :deep(.p-button-icon) {
    position: absolute;
    top: 50%;
    right: var(--p-spacing-2);
    margin: 0;
    font-size: var(--p-font-size-xs);
    opacity: var(--p-opacity-0);
    transform: translateY(-50%) translateX(calc(-1 * var(--p-spacing-2)));
    transition:
        opacity var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        transform var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);
}

.auth-shell__enterprise-cta.p-button:hover :deep(.p-button-label),
.auth-shell__enterprise-cta.p-button:focus-visible :deep(.p-button-label) {
    transform: translateX(calc(-1 * var(--p-spacing-2)));
}

.auth-shell__enterprise-cta.p-button:hover :deep(.p-button-icon),
.auth-shell__enterprise-cta.p-button:focus-visible :deep(.p-button-icon) {
    opacity: var(--p-opacity-100);
    transform: translateY(-50%) translateX(0);
}

@media (prefers-reduced-motion: reduce) {
    .auth-shell__enterprise-cta :deep(.p-button-label),
    .auth-shell__enterprise-cta :deep(.p-button-icon) {
        transition: none;
    }
}

.auth-shell__stage {
    position: relative;
    isolation: isolate;
    flex: 0 0 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
}

.auth-shell__stage-bg {
    position: absolute;
    inset: 0;
    z-index: -1;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50%;
    opacity: var(--p-opacity-20);
    pointer-events: none;
    display: none;
}

.auth-shell__slot {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    width: 100%;
    min-height: 0;
}

.auth-shell__slot :deep(.login-page) {
    min-height: 0;
}

@media (width >= 1024px) {
    .auth-shell {
        flex-direction: row;
        gap: 0;
        padding: 0;
    }

    .auth-shell::before {
        display: none;
    }

    .auth-shell__brand,
    .auth-shell__brand--hidden-mobile {
        position: static;
        left: auto;
        right: auto;
        bottom: auto;
        overflow: hidden;
        display: flex;
        flex: 1 1 50%;
        min-width: 0;
        align-items: center;
        justify-content: center;
        padding: clamp(var(--p-spacing-6), 5vw, var(--p-spacing-12));
        z-index: 0;
        background: var(--p-deepblue-900);
    }

    .auth-shell__brand::before {
        content: '';
        position: absolute;
        inset: 0;
        display: block;
        background-image: url('/login-mark.svg');
        background-repeat: no-repeat;
        background-position: left center;
        background-size: auto 100%;
        opacity: var(--p-opacity-50);
        pointer-events: none;
    }

    .auth-shell__brand-inner {
        width: auto;
        gap: var(--p-spacing-9);
    }

    .auth-shell__wordmark {
        display: block;
    }

    .auth-shell__enterprise {
        width: auto;
    }

    .auth-shell__stage {
        flex: 1 1 50%;
        padding: clamp(var(--p-spacing-6), 3vw, var(--p-spacing-10));
        background-color: var(--p-gray-50);
    }

    .auth-shell__stage-bg {
        display: block;
    }
}
</style>
