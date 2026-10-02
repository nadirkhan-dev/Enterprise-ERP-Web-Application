<script setup lang="ts">
import { usePageScrollTop } from '~/composables/usePageScrollTop'

const { showScrollTop, handleScrollTop } = usePageScrollTop()
</script>

<template>
  <Teleport to="body">
    <Transition name="page-scroll-fade">
      <button
        v-if="showScrollTop"
        class="page-scroll-top"
        type="button"
        aria-label="Scroll to top"
        @click="handleScrollTop"
      >
        <i class="pi pi-chevron-up" />
      </button>
    </Transition>
  </Teleport>
</template>

<style scoped>
:global(.page-scroll-top) {
    position: fixed;
    left: var(--p-spacing-3);
    bottom: var(--p-spacing-3);
    width: var(--p-spacing-10);
    height: var(--p-spacing-10);
    border-radius: var(--p-border-radius-full);
    border: none;
    background: var(--p-primary-500);
    color: var(--p-surface-0);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--p-shadow-md);
    cursor: pointer;
    z-index: 95;

    @media (min-width: 1440px) {
        display: none;
    }
}

:global(.page-scroll-fade-enter-active),
:global(.page-scroll-fade-leave-active) {
    transition:
        opacity var(--p-transition-duration-normal)
            var(--p-transition-timing-ease-in-out),
        transform var(--p-transition-duration-normal)
            var(--p-transition-timing-ease-in-out);
}

:global(.page-scroll-fade-enter-from),
:global(.page-scroll-fade-leave-to) {
    opacity: 0;
    transform: translateX(-8px);
}
</style>
