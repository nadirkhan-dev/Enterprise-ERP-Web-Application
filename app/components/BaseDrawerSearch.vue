<script setup lang="ts">
// Reusable drawer search field — a gray magnifier at rest, swapped for a
// keyboard-focusable × clear once the user types (via SectionFilterIcon), the
// same affordance as the detail-page section filters. NOT the top-nav pattern
// (which shows a × only). `v-model` the query. Pair with `useDrawerListSearch`
// for the filter + overflow-visibility behaviour. One place to change the
// drawer-search look/feel for every drawer that uses it.
const model = defineModel<string>({ default: '' })
defineProps<{ placeholder?: string }>()

// Only actionable while there's something to clear; inert when the field is empty.
function handleIconClick(): void {
  if (model.value) { model.value = '' }
}
</script>

<template>
  <div class="base-drawer-search">
    <InputText
      v-model="model"
      v-search-input
      autocomplete="off"
      :placeholder="placeholder"
      class="base-drawer-search__input"
    />
    <SectionFilterIcon
      :active="Boolean(model)"
      @activate="handleIconClick"
    />
  </div>
</template>

<style scoped>
/* Relative so SectionFilterIcon's `.section-filter__icon` (absolute, right:
   spacing-3) sits inside this field. */
.base-drawer-search {
    position: relative;
    display: flex;
    flex: 1;
    min-width: 0;
}

.base-drawer-search__input {
    width: 100%;
    height: calc(var(--p-spacing-8) + var(--p-spacing-px));
    /* Right pad reserves room for the magnifier / × (same as .section-filter). */
    padding: var(--p-spacing-1-75) var(--p-spacing-8) var(--p-spacing-1-75) var(--p-spacing-2-625);
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-normal);
    line-height: var(--p-spacing-5);
    color: var(--p-gray-800);
    overflow: hidden;
    text-overflow: ellipsis;
}

.base-drawer-search__input::placeholder {
    color: var(--p-gray-800);
}

/* Drawer magnifier is a muted gray hint; table sections keep the blue magnifier.
   Only the resting magnifier is greyed — the clear × keeps its shared styling. */
.base-drawer-search :deep(.section-filter__icon:not(.section-filter__icon--active)) {
    color: var(--p-gray-400);
}
</style>
