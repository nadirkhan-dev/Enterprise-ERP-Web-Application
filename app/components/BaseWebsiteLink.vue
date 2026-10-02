<script setup lang="ts">
interface Props {
  // The entity's website URL. Null/empty renders the muted "no website" globe.
  website?: string | null
  // Entity name, woven into the accessible label ("Visit {name} website").
  name?: string | null
  // Tooltip shown on the muted globe when no website is set.
  missingTooltip?: string
}

const props = withDefaults(defineProps<Props>(), {
  website: null,
  name: null,
  missingTooltip: 'No website added',
})

const hasWebsite = computed(() => Boolean(props.website))
const linkLabel = computed(() =>
  props.name ? `Visit ${props.name} website` : 'Visit website',
)
</script>

<template>
  <!-- Both states render through BaseIconButton so the globe is pixel-identical
       (size, alignment, table offsets) whether it's the blue link or the muted
       "no website" placeholder — only the colour and interactivity differ. -->
  <BaseIconButton
    v-if="hasWebsite"
    :to="website ?? undefined"
    external
    target="_blank"
    icon="pi pi-globe"
    :label="linkLabel"
    @click.stop
  />
  <BaseIconButton
    v-else
    icon="pi pi-globe"
    :label="missingTooltip"
    :tooltip="missingTooltip"
    muted
  />
</template>
