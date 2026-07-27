<script setup lang="ts">
interface Props {
  size?: 'xs' | 'sm' | 'md' | 'lg'
}

withDefaults(defineProps<Props>(), {
  size: 'md',
})
</script>

<template>
  <div :class="['base-spinner', `base-spinner--${size}`]">
    <div class="base-spinner__orbit">
      <div class="base-spinner__scene">
        <div class="base-spinner__dot" />
        <div class="base-spinner__dot" />
        <div class="base-spinner__dot" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.base-spinner {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  perspective: 800px;
  flex-shrink: 0;
}

/* Inline size for compact status rows (e.g. the SAP "Syncing…" indicator). */
.base-spinner--xs {
  width: var(--p-font-size-sm);
  height: var(--p-font-size-sm);
}

.base-spinner--sm {
  width: var(--p-font-size-xl);
  height: var(--p-font-size-xl);
}

.base-spinner--md {
  width: var(--p-spacing-10);
  height: var(--p-spacing-10);
}

.base-spinner--lg {
  width: var(--p-spacing-16);
  height: var(--p-spacing-16);
}

.base-spinner__orbit {
  position: absolute;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  animation: spinner-planetary 3s linear infinite;
}

.base-spinner__scene {
  position: absolute;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
}

.base-spinner__dot {
  position: absolute;
  width: 22%;
  height: 22%;
  margin: -11%;
  border-radius: 50%;
  background: var(--p-text-muted-color);
  top: 50%;
  left: 50%;
  will-change: transform, background;
}

.base-spinner__dot:nth-child(1) {
  animation: spinner-chaos-x 1.5s cubic-bezier(0.7, 0, 0.3, 1) infinite;
}

.base-spinner__dot:nth-child(2) {
  animation: spinner-chaos-y 1.5s cubic-bezier(0.7, 0, 0.3, 1) infinite;
}

.base-spinner__dot:nth-child(3) {
  animation: spinner-chaos-z 1.5s cubic-bezier(0.7, 0, 0.3, 1) infinite;
}

@keyframes spinner-planetary {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes spinner-chaos-x {
  0%, 100% { transform: translate3d(-200%, 0, -50px) scale(0.7); }
  50% { transform: translate3d(200%, 0, 50px) scale(1.4); background: var(--p-primary-500); }
}

@keyframes spinner-chaos-y {
  0%, 100% { transform: translate3d(0, -200%, -50px) scale(0.7); }
  50% { transform: translate3d(0, 200%, 50px) scale(1.4); background: var(--p-primary-500); }
}

@keyframes spinner-chaos-z {
  0%, 100% { transform: translate3d(150%, 150%, -100px) scale(0.7); }
  50% { transform: translate3d(-150%, -150%, 100px) scale(1.4); background: var(--p-primary-500); }
}
</style>
