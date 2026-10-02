<template>
  <div
    ref="footerRef"
    :class="['infinite-scroll-footer', { 'infinite-scroll-footer--with-rows': rowsPerPage != null }]"
  >
    <div class="infinite-scroll-footer__status">
      <template v-if="loading">
        <div :class="['loading-div-center', { 'footer-spacing': rowsPerPage == null }]">
          <BaseSpinner size="sm" />
          Loading more...
        </div>
      </template>
      <template v-else>
        <span
          v-if="!filterText && emptyMsg && totalRecords === 0"
          :class="['footer-font-size', { 'footer-spacing': rowsPerPage == null }]"
        >
          {{ emptyMsg }}
        </span>
        <span
          v-else
          :class="['footer-font-size', { 'footer-spacing': rowsPerPage == null }]"
        >
          {{ firstRow.toLocaleString() }}-{{ lastRow.toLocaleString() }} of {{ totalRecords.toLocaleString() }} {{ pageLabel }}
        </span>
      </template>
    </div>
    <div
      v-if="rowsPerPage != null"
      class="infinite-scroll-footer__rows"
    >
      <Select
        :model-value="rowsPerPage"
        :options="rowsPerPageOptions"
        size="small"
        aria-label="Rows per page"
        @update:model-value="onRowsPerPageChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  loading?: boolean
  firstRow: number
  lastRow: number
  totalRecords: number
  pageLabel?: string
  filterText?: string
  emptyMsg?: string
  showShadow?: boolean
  // When null the rows-per-page selector is hidden — datalist pages keep
  // their plain footer; only the preview tables opt in.
  rowsPerPage?: number | null
  rowsPerPageOptions?: number[]
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  pageLabel: 'results',
  filterText: '',
  emptyMsg: '',
  showShadow: false,
  rowsPerPage: null,
  rowsPerPageOptions: () => [3, 6, 9],
})

const emit = defineEmits<{
  'update:rowsPerPage': [value: number]
}>()

function onRowsPerPageChange(value: number) {
  emit('update:rowsPerPage', value)
}

const footerRef = ref<HTMLDivElement | null>(null)
let replacedFooter: HTMLElement | null = null

function applyFooterStyles() {
  if (!replacedFooter) {return}
  replacedFooter.style.position = 'relative'
  replacedFooter.style.zIndex = '1'
  replacedFooter.style.boxShadow = props.showShadow ? 'var(--p-shadow-top)' : 'none'
}

onMounted(() => {
  const wrapper = footerRef.value?.parentElement
  if (wrapper && wrapper.tagName === 'DIV' && wrapper.classList.contains('p-datatable-footer')) {
    const footerElement = document.createElement('footer')
    for (const attr of wrapper.attributes) {
      footerElement.setAttribute(attr.name, attr.value)
    }
    while (wrapper.firstChild) {
      footerElement.appendChild(wrapper.firstChild)
    }
    wrapper.parentElement.replaceChild(footerElement, wrapper)
    replacedFooter = footerElement
    applyFooterStyles()
  }
})

watch(() => props.showShadow, applyFooterStyles)
</script>

<style scoped>
.loading-div-center {
  display: flex;
  align-items: center;
  gap: var(--p-spacing-3);
  font-size: var(--p-font-size-2xs);
}

.footer-font-size {
  font-size: var(--p-font-size-2xs);
}

.footer-spacing {
  padding-top: var(--p-spacing-3);
}

/* Three-column grid keeps the status text centred regardless of the
   optional rows-per-page selector pinned to the right. */
.infinite-scroll-footer {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: var(--p-spacing-2);
  padding: 0 var(--p-spacing-4);
  font-family: var(--p-mono-family);
  font-size: var(--p-font-size-sm);
  color: var(--p-text-muted-color);
}

.infinite-scroll-footer--with-rows {
  /* Spacing lives in padding (not margin) so it can't collapse through the
     zero-padding footer wrapper — that keeps the top shadow flush against the
     last table row instead of detaching with a gap above it. */
  /* Mobile/tablet: vertically centre the count text. Large screens: bottom-
     align it with the rows-per-page selector. (The selector keeps its own
     align-self: end, so only the count text shifts.) */
  align-items: center;
  padding: var(--p-spacing-4) 0 0;

  @media (min-width: 1024px) {
    align-items: end;
  }
}

.infinite-scroll-footer__status {
  grid-column: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--p-spacing-2);
  text-align: center;
}

.infinite-scroll-footer__rows {
  grid-column: 3;
  justify-self: end;
  align-self: end;
}

/* Compact rows-per-page selector — 24px tall, muted grey value + arrow,
   with a tideblue hover matching the app's other controls. */
.infinite-scroll-footer__rows :deep(.p-select) {
  height: var(--p-spacing-7);
}

.infinite-scroll-footer__rows :deep(.p-select-label) {
  display: flex;
  align-items: center;
  padding-block: 0;
  color: var(--p-gray-300);
  font-size: var(--p-font-size-sm);
}

/* Size the chevron segment to exactly its 24px chip so it sits flush to the
   right border (no empty space on its right). The value label is flex:1 and
   absorbs the freed width, so the select's overall width is unchanged. The icon
   stays centred within the chip. */
.infinite-scroll-footer__rows :deep(.p-select-dropdown) {
  width: var(--p-spacing-6);
  min-width: var(--p-spacing-6);
  color: var(--p-gray-400);
}

.infinite-scroll-footer__rows :deep(.p-select-dropdown-icon) {
  width: var(--p-font-size-sm);
  height: var(--p-font-size-sm);
  font-size: var(--p-font-size-sm);
}

.infinite-scroll-footer__rows :deep(.p-select-dropdown:hover) {
  color: var(--p-skyblue-600);
}
</style>
