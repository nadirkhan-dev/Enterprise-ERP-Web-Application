<script setup lang="ts">
interface Props {
  url?: string | null
  label?: string
  // Icon-only variant (no "Looker" text) for inline key-figure triggers.
  iconOnly?: boolean
}

withDefaults(defineProps<Props>(), {
  url: null,
  label: 'Looker',
  iconOnly: false,
})
</script>

<template>
  <NuxtLink
    v-if="url"
    :to="url"
    external
    target="_blank"
    rel="noopener noreferrer"
    class="base-looker-link"
    :class="{ 'base-looker-link--icon-only': iconOnly }"
    :aria-label="iconOnly ? label : undefined"
  >
    <span
      v-if="!iconOnly"
      class="base-looker-link__label"
    >{{ label }}</span>
    <span class="base-looker-link__icon">
      <BaseLookerIcon />
    </span>
  </NuxtLink>
</template>

<style scoped>
/* "Looker" text + external-link icon. Layout follows the Figma: small-button
   padding/gap tokens, with a hover-tinted icon hit area. */
.base-looker-link {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
    padding: var(--p-button-sm-padding-y) 0;
    color: var(--p-primary-500);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-bold);
    line-height: var(--p-spacing-2.5);
    text-decoration: none;
    white-space: nowrap;
}

/* Icon-only key-figure trigger: drop the small-button padding so the icon sits
   snug against the stat value, keeping only the icon's own hover-chip hit area. */
.base-looker-link--icon-only {
    gap: 0;
    padding: 0;
}

.base-looker-link__label {
    color: var(--p-deepblue-900);
}

.base-looker-link__icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 20px hit area matching the copy / globe icon buttons (BaseIconButton). */
    width: var(--p-spacing-5);
    height: var(--p-spacing-5);
    border-radius: var(--p-border-radius-xs);
    transition: background var(--p-transition-duration-fast) var(--p-transition-timing-ease-out);
}

.base-looker-link:hover .base-looker-link__icon {
    background: var(--p-tideblue-50);
}

/* No controls follow the link → drop the dangling connector. */
.base-looker-link__connector:last-child {
    display: none;
}
</style>
