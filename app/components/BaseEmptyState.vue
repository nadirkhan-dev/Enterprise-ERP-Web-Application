<script setup lang="ts">
/**
 * Centred empty-state hero: an entity icon, a heading, a body message and an
 * optional call to action.
 * Shared across the "Add Existing …" association pickers (competitors, suppliers,
 * manufacturers) and available to any surface that needs a friendly "nothing here"
 * state. The body is a slot so callers can bold the entity name / button label
 * inline (see DrawerAddManufacturerAssociation); `#actions` takes a button when
 * the empty state is the place to act from (see the Tools landing page).
 */
interface Props {
  /** Icon config string — PrimeIcon ('pi pi-*') or Material Symbol ('ms:*'). */
  icon: string
  /** Heading, e.g. "All Existing Competitors Have Been Added". */
  title: string
}

defineProps<Props>()
</script>

<template>
  <div class="empty-state">
    <AppNavIcon
      :icon="icon"
      class="empty-state__icon"
      aria-hidden="true"
    />
    <div class="empty-state__caption">
      <h2 class="empty-state__title">
        {{ title }}
      </h2>
      <p class="empty-state__message">
        <slot />
      </p>
    </div>
    <!-- Sits on the hero's own 20px rhythm, matching the design's button inset. -->
    <div
      v-if="$slots.actions"
      class="empty-state__actions"
    >
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-5);
    padding: var(--p-spacing-6);
    max-width: 380px;
    margin-inline: auto;
    /* Self-contained font so the hero reads correctly even inside a container
       that sets a different family (e.g. the picker's mono empty-state band). */
    font-family: var(--p-font-family);
    text-align: center;
}

/* Sized for both icon systems: font-size drives PrimeIcon glyphs, width/height
   drive the Material Symbol <svg>. currentColor tints both. */
.empty-state__icon {
    width: var(--p-spacing-12);
    height: var(--p-spacing-12);
    font-size: var(--p-spacing-12);
    color: var(--p-primary-color);
    flex-shrink: 0;
}

.empty-state__caption {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-3);
}

.empty-state__title {
    margin: 0;
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    line-height: var(--p-spacing-8);
    color: var(--p-deepblue-900);
    text-wrap: balance;
}

.empty-state__message {
    margin: 0;
    max-width: 272px;
    font-size: var(--p-font-size-sm);
    line-height: var(--p-spacing-5);
    color: var(--p-gray-800);
}

.empty-state__message :deep(strong) {
    font-weight: var(--p-font-weight-bold);
}

.empty-state__actions {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-3);
}
</style>
