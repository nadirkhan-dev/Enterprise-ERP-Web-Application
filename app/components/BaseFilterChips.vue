<script setup lang="ts">
interface FilterChip {
  key: string
  label: string
  remove: () => void
}

interface Props {
  chips: FilterChip[]
}

const props = defineProps<Props>()
</script>

<template>
  <div
    v-if="props.chips.length"
    class="filter-chips"
  >
    <Tag
      v-for="chip in props.chips"
      :key="chip.key"
      class="filter-chips__chip"
    >
      <template #default>
        <span class="filter-chips__label">{{ chip.label }}</span>
        <Button
          text
          rounded
          icon="pi pi-times"
          size="small"
          class="filter-chips__remove"
          aria-label="Remove filter"
          @click="chip.remove"
        />
      </template>
    </Tag>
  </div>
</template>

<style scoped>
.filter-chips {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--p-spacing-2);
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    min-width: 0;

    @media (min-width: 768px) {
      flex-wrap: wrap;
      overflow-x: visible;
    }
}

.filter-chips::-webkit-scrollbar {
    display: none;
}

:deep(.filter-chips__chip.p-tag) {
    flex: 0 0 auto;
}

:deep(.filter-chips__chip.p-tag) {
    display: flex;
    align-items: center;
    box-sizing: border-box;
    height: var(--p-spacing-6-25);
    min-height: var(--p-spacing-6-25);
    gap: var(--p-spacing-1);
    padding: var(--p-spacing-1) var(--p-spacing-2);
    border-radius: var(--p-border-radius-2xl);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    line-height: 1;
    border: 1px solid var(--p-gray-100);
    background: var(--p-skyblue-50);
    color: var(--p-deepblue-900);
}

.filter-chips__label {
    line-height: 1;
}

:deep(.p-tag.filter-chips__chip .filter-chips__remove.p-button) {
    flex: 0 0 auto;
    box-sizing: border-box;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    width: var(--p-spacing-3-5);
    height: var(--p-spacing-3-5);
    min-width: 0;
    min-height: 0;
    padding: 0;
    aspect-ratio: 1;
    color: var(--p-deepblue-900);
    border: 1px solid var(--p-deepblue-900);
    background: transparent;
    border-radius: 50%;
}

:deep(.p-tag.filter-chips__chip .filter-chips__remove.p-button .p-button-icon) {
    font-size: var(--p-font-size-xxs);
    line-height: 1;
    transform: scale(0.85);
}

:deep(.p-tag.filter-chips__chip .filter-chips__remove.p-button::after) {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--p-spacing-2));
}

:deep(.p-tag.filter-chips__chip .filter-chips__remove.p-button:hover) {
    background: color-mix(in srgb, var(--p-deepblue-900) 15%, transparent);
    color: var(--p-deepblue-900);
    border-color: var(--p-deepblue-900);
}
</style>
