<script setup lang="ts">
import {
  SpecialSkuGenerator,
  DocumentDownloader,
  ShippingEstimatorSection,
} from '#components'

// One page serves every /tools/* route: the tool switcher (header + selectable
// cards) is shared chrome, and the active tool's existing section component is
// swapped in via <component :is>. Bare /tools is the landing state — no tool
// selected — so it shows the empty-state hero instead of redirecting. Unknown
// slugs bounce back to that landing.
definePageMeta({
  middleware: (to) => {
    const slug = String(to.params.tool ?? '')
    const valid = ['special-sku-lookup', 'document-downloader', 'shipping-estimator']
    if (slug && !valid.includes(slug)) {
      return navigateTo('/tools', { replace: true })
    }
  },
})

const TOOLS = [
  {
    key: 'special-sku-lookup',
    label: 'Special SKU Lookup',
    description: 'Generate LSS special order SKUs',
    icon: 'pi pi-search',
    component: SpecialSkuGenerator,
  },
  {
    key: 'document-downloader',
    label: 'Document Downloader',
    description: 'Get PDF transactional documents',
    icon: 'pi pi-file-pdf',
    component: DocumentDownloader,
  },
  {
    key: 'shipping-estimator',
    label: 'Shipping Estimator',
    description: 'Get parcel or LTL cost estimates',
    icon: 'ms:local_shipping',
    component: ShippingEstimatorSection,
  },
]

const route = useRoute()
const activeTool = computed(
  () => TOOLS.find(tool => tool.key === route.params.tool) ?? null,
)

useHead({
  title: computed(() => activeTool.value?.label ?? 'Tools'),
})
</script>

<template>
  <div class="tools-page">
    <div class="tools-page__header">
      <h1 class="tools-page__title">
        Tools
      </h1>
    </div>

    <div class="tools-page__switcher">
      <NuxtLink
        v-for="tool in TOOLS"
        :key="tool.key"
        :to="`/tools/${tool.key}`"
        class="tool-card"
        :class="{ 'tool-card--active': tool.key === activeTool?.key }"
        :aria-current="tool.key === activeTool?.key ? 'page' : undefined"
      >
        <span class="tool-card__icon">
          <AppNavIcon
            :icon="tool.icon"
            aria-hidden="true"
          />
        </span>
        <span class="tool-card__body">
          <span class="tool-card__label">{{ tool.label }}</span>
          <span class="tool-card__description">{{ tool.description }}</span>
        </span>
      </NuxtLink>
    </div>

    <component
      :is="activeTool.component"
      v-if="activeTool"
    />
    <div
      v-else
      class="tools-page__empty"
    >
      <p class="tools-page__empty-text">
        Select a tool to get started
      </p>
    </div>
  </div>
</template>

<style scoped>
.tools-page {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.tools-page__header {
    display: flex;
    align-items: center;
}

.tools-page__title {
    margin: 0;
    font-size: var(--p-font-size-2xl);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

/* Selectable tool cards. Mobile: the three cards share one blue-bordered group,
   stacked with no gaps (the active row is tinted). Tablet up: they split into
   separate bordered cards, three across. */
.tools-page__switcher {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);

    @media (min-width: 768px) {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--p-spacing-4);
        overflow: visible;
        border: none;
        border-radius: 0;
    }

    @media (min-width: 1024px) {
        padding-inline: var(--p-spacing-20);
    }
}

.tool-card {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    padding: var(--p-spacing-4);
    background: var(--p-surface-0);
    color: var(--p-deepblue-900);
    text-decoration: none;
    transition:
        border-color var(--p-transition-duration) var(--p-transition-timing),
        background var(--p-transition-duration) var(--p-transition-timing);

    /* Separate, individually bordered cards from tablet up. */
    @media (min-width: 768px) {
        border: 1px solid var(--p-surface-200);
        border-radius: var(--p-border-radius-xs);
    }
}

.tool-card:not(.tool-card--active):hover,
.tool-card:not(.tool-card--active):focus-visible {
    background: var(--p-skyblue-50);
    outline: none;

    @media (min-width: 768px) {
        border-color: var(--p-skyblue-200);
    }
}

.tool-card--active {
    background: var(--p-skyblue-100);

    @media (min-width: 768px) {
        border-color: var(--p-skyblue-200);
    }
}

.tool-card__icon {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    font-size: var(--p-font-size-xl);
    color: var(--p-skyblue-600);
}

.tool-card__body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: var(--p-spacing-0-5);
    min-width: 0;
    align-self: stretch;
}

.tool-card__label {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 100%;
}

.tool-card__description {
    font-size: var(--p-font-size-xs);
    color: var(--p-gray-600);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    max-width: 100%;
}

.tools-page__empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: var(--p-layout-tools-panel-min-height-mobile, 21rem);
    padding: var(--p-spacing-4);
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-xs);
    box-shadow: var(--p-shadow-sm);

    @media (min-width: 768px) {
        min-height: var(--p-layout-tools-panel-min-height, 13.5rem);
    }
}

.tools-page__empty-text {
    margin: 0;
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-surface-600);
}
</style>
