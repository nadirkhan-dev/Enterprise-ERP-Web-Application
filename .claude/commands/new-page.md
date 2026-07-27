# New Page Scaffold

Create a new page following Liberty Connect conventions.

## Steps

1. **Create page file**: `app/pages/PageName.vue` (PascalCase, flat — no subdirectories)

2. **Add route**: In `nuxt.config.js` `pages:extend` hook, add the route mapping from PascalCase filename to kebab-case path.

3. **Add navigation**: If the page should appear in the sidebar, add it to `NAV_ITEMS` in `app/components/AppSideNav.vue`.

4. **Scaffold template**:
```vue
<script setup>
definePageMeta({
  name: 'page-name',
})

// Mock data matching expected Directus field shapes
const mockItems = ref([])
</script>

<template>
  <div class="page-name">
    <!-- Page content using PrimeVue components -->
  </div>
</template>

<style scoped>
.page-name {
  /* Page-specific styles using design tokens */
}
</style>
```

5. **Check existing components**: Review `app/components/` for reusable components before building new patterns.

## Conventions
- Use default layout (sidebar + topnav) unless the page needs `definePageMeta({ layout: false })`
- All interactive elements via PrimeVue
- Design tokens for all CSS values
- Mock data in `<script setup>`, never inside components
