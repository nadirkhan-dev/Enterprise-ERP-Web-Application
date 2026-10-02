<script setup lang="ts">
interface Props {
  to: string
  label: string
}

const props = defineProps<Props>()
const router = useRouter()
const searchStore = useSearchStore()

// A fresh navigation to a bare list route drops the active search: the list reads
// its query from the URL, and AppTopNav clears the store to match. So when this
// button targets the active module's own list, carry the query along — arriving
// at `?q=<term>` restores the search box and its result instead of an empty box
// over the unfiltered table.
//
// Only the fallback path needs this; history-back (below) returns to the list's
// own URL, which already carries whatever query the user left it with. The list
// page's isInitialMount guard means arriving with `?q=` loads the filtered rows
// without re-firing the exact-match redirect, so this cannot bounce forward.
const target = computed<string | { path: string, query: Record<string, string> }>(() => {
  const listRoute = searchStore.activeModule?.listRoute
  if (listRoute === props.to && searchStore.searchQuery) {
    return { path: props.to, query: { q: searchStore.searchQuery } }
  }
  return props.to
})

// When the page we'd go "back" to is exactly the route this button targets (i.e.
// the user arrived here from that list), do a real browser history-back instead of
// a fresh navigation. History-back returns to the list's exact URL (?q=…&filter=…),
// restoring the search term, filters, scroll, and cached rows. When the page was
// deep-linked (no matching history entry), fall through to the normal NuxtLink
// navigation to `to`.
function handleClick(event: MouseEvent) {
  // Let the browser handle modified clicks (open in new tab, etc.).
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
    return
  }
  const previous = (window.history.state?.back ?? null) as string | null
  if (previous && previous.split('?')[0] === props.to.split('?')[0]) {
    event.preventDefault()
    router.back()
  }
}
</script>

<template>
  <NuxtLink
    :to="target"
    class="base-back-button"
    @click="handleClick"
  >
    <i class="pi pi-arrow-left base-back-button__icon" aria-hidden="true" />
    {{ label }}
  </NuxtLink>
</template>

<style scoped>
.base-back-button {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-3);
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-medium);
    text-decoration: none;
    cursor: pointer;
}

.base-back-button:hover {
    color: var(--p-deepblue-700);
}

.base-back-button__icon {
    font-size: var(--p-font-size-lg);
}
</style>
