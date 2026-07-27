<script setup lang="ts">
interface Props {
  hasImage: boolean
}

defineProps<Props>()
const emit = defineEmits<{
  upload: []
  delete: []
}>()

const wrapperRef = ref<HTMLElement | null>(null)
const popupRef = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const anchorTop = ref('0px')
const anchorLeft = ref('0px')

function positionPopup() {
  const wrapper = wrapperRef.value
  if (!wrapper) return
  const rect = wrapper.getBoundingClientRect()
  anchorTop.value = `${rect.bottom}px`
  // Mobile: center menu on viewport; desktop: anchor to trigger.
  anchorLeft.value = window.innerWidth < 768 ? '50vw' : `${rect.left}px`
}

async function openMenu() {
  positionPopup()
  menuOpen.value = true
}

function closeMenu() {
  menuOpen.value = false
}

function toggleMenu() {
  menuOpen.value ? closeMenu() : openMenu()
}

function handleUpload() {
  closeMenu()
  emit('upload')
}

function handleDelete() {
  closeMenu()
  emit('delete')
}

function handleOutsideClick(event: MouseEvent) {
  if (!menuOpen.value) return
  const target = event.target as Node
  if (popupRef.value?.contains(target)) return
  if (wrapperRef.value?.contains(target)) return
  closeMenu()
}

onMounted(() => {
  document.addEventListener('click', handleOutsideClick, true)
  window.addEventListener('resize', positionPopup)
  window.addEventListener('scroll', positionPopup, true)
})

onUnmounted(() => {
  document.removeEventListener('click', handleOutsideClick, true)
  window.removeEventListener('resize', positionPopup)
  window.removeEventListener('scroll', positionPopup, true)
})
</script>

<template>
  <span
    ref="wrapperRef"
    class="base-avatar-edit-menu__trigger-wrap"
  >
    <Button
      v-if="!hasImage"
      icon="pi pi-plus"
      outlined
      rounded
      size="small"
      @click="emit('upload')"
    />
    <Button
      v-else
      :icon="menuOpen ? 'pi pi-times' : 'pi pi-pencil'"
      :severity="menuOpen ? 'secondary' : undefined"
      outlined
      rounded
      size="small"
      aria-label="Edit image"
      @click="toggleMenu"
    />
  </span>
  <Teleport to="body">
    <Transition name="base-avatar-edit-menu-fade">
      <div
        v-if="hasImage && menuOpen"
        ref="popupRef"
        class="base-avatar-edit-menu"
        :style="{ top: anchorTop, left: anchorLeft }"
      >
        <button
          type="button"
          class="base-avatar-edit-menu__item"
          @click="handleUpload"
        >
          <i class="pi pi-upload" />
          <span>Upload Image</span>
        </button>
        <button
          type="button"
          class="base-avatar-edit-menu__item base-avatar-edit-menu__item--danger"
          @click="handleDelete"
        >
          <i class="pi pi-trash" />
          <span>Delete</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.base-avatar-edit-menu__trigger-wrap {
    display: inline-flex;
}
</style>

<style>
.base-avatar-edit-menu {
    position: fixed;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 175px;
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-md);
    padding: var(--p-spacing-1) 0;
    z-index: 1100;
    border:1px solid var(--p-surface-200);
    transform: translate(-50%, var(--p-spacing-1));

    @media (min-width: 768px) {
        min-width: 190px;
        transform: translate(calc(-50% - var(--p-spacing-8)), var(--p-spacing-1));
    }
}

.base-avatar-edit-menu__item {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    padding: var(--p-spacing-2) var(--p-spacing-4);
    width: 100%;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: var(--p-font-size-sm);
    color: var(--p-primary-500);
    text-align: left;
    letter-spacing: 0.02em;
}

.base-avatar-edit-menu__item:hover {
    background: var(--p-tideblue-50);
}

.base-avatar-edit-menu__item--danger {
    color: var(--p-red-500);
}

.base-avatar-edit-menu-fade-enter-active,
.base-avatar-edit-menu-fade-leave-active {
    transition: opacity var(--p-transition-duration-normal) ease;
}

.base-avatar-edit-menu-fade-enter-from,
.base-avatar-edit-menu-fade-leave-to {
    opacity: 0;
}
</style>
