import { useAuthStore } from '~/stores/auth'
import { useSessionExpiry } from '~/composables/useSessionExpiry'

export default defineNuxtPlugin(() => {
  const authStore = useAuthStore()
  const { registerAuthFailureHandler, startSessionWatch, stopSessionWatch } = useSessionExpiry()

  registerAuthFailureHandler()

  watch(
    () => authStore.isAuthenticated,
    (isAuthenticated) => {
      if (isAuthenticated) {
        startSessionWatch()
      } else {
        stopSessionWatch()
      }
    },
    { immediate: true },
  )
})
