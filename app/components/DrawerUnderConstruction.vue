<script setup lang="ts">
import constructionImage from '~/assets/images/under-construction.png'

interface Props {
  visible?: boolean
  title?: string
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  title: 'Under Construction',
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const localVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit('update:visible', value),
})
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="title"
  >
    <!-- Placeholder panel until the detail view is fleshed out (e.g. transaction
         line items). Uses the shared under-construction asset, sized for the
         drawer rather than the full-page BaseUnderConstruction (viewport-sized). -->
    <div class="under-construction-drawer">
      <img
        :src="constructionImage"
        alt="This section is under construction"
        class="under-construction-drawer__art"
      />
    </div>
  </BaseDrawer>
</template>

<style scoped>
/* `.p-drawer-content` is `position: relative`, so an absolutely-positioned
   `inset: 0` wrapper fills the drawer body height exactly — independent of the
   flex chain — keeping the graphic centred without triggering the body's
   overflow scroll. */
.under-construction-drawer {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
}

.under-construction-drawer__art {
    /* Natural landscape ratio at the inset width — no crop, no zoom. */
    width: 120%;
    height: auto;
}
</style>
