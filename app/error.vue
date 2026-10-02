<script setup>
import { useAuthStore } from '~/stores/auth'
import { LOGIN_ROUTE, PUBLIC_ROUTES } from '~/config/routes'

const props = defineProps({
  error: {
    type: Object,
    default: () => ({}),
  },
})

const is404 = computed(() => Number(props.error?.statusCode) === 404)

const fallbackMessage = computed(() => props.error?.statusMessage || 'Oops! An Error Occured')

const authStore = useAuthStore()
const route = useRoute()
const isReady = ref(false)

onMounted(async () => {
  if (!authStore.authReady) {
    await authStore.checkAuth()
  }

  if (!authStore.isAuthenticated && !PUBLIC_ROUTES.includes(route.path)) {
    await clearError({ redirect: LOGIN_ROUTE })
    return
  }

  isReady.value = true
})
</script>

<template>
  <NuxtLayout>
    <template v-if="isReady">
      <BaseError404 v-if="is404" mode="overlay" />
      <BaseError500
        v-else
        :message="fallbackMessage"
        mode="overlay"
      />
    </template>
  </NuxtLayout>
</template>

<style scoped>
.error-stage {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--p-spacing-3);
    background: var(--p-surface-0);

    @media (min-width: 768px) {
        padding: var(--p-spacing-4);
    }
}

.error-stage__frame {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;

    @media (min-width: 768px) {
        width: min(90%, 75vmin);
        aspect-ratio: 4 / 3;
    }
}
</style>
