import { useAuthStore } from '~/stores/auth'
import { PUBLIC_ROUTES, LOGIN_ROUTE, DEFAULT_ROUTE } from '~/config/routes'

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) {
    return
  }

  const authStore = useAuthStore()

  if (!authStore.authReady) {
    await authStore.checkAuth()
  }

  if (!authStore.isAuthenticated && !PUBLIC_ROUTES.includes(to.path)) {
    sessionStorage.setItem('auth:redirect', to.fullPath)
    return navigateTo(LOGIN_ROUTE)
  }

  if (!authStore.isAuthenticated) {
    return
  }

  // Does a policy demand 2FA of this user, and have they actually enrolled?
  // Asked of Directus (see useTfaEnforcement), NOT of a flag the login screen left
  // behind — so it also catches a resumed "remember me" session, a freshly opened
  // tab, and someone added to an enforcing policy while already signed in.
  const { isTfaEnrolmentRequired } = useTfaEnforcement()
  const mustEnrolInTfa = await isTfaEnrolmentRequired()

  if (mustEnrolInTfa) {
    // Enrolment can't be driven from here: Directus wants the account password to
    // mint the TFA secret, and a resumed session doesn't have it. Ending the
    // session sends them through sign-in, which does — and which already knows how
    // to run the setup step.
    //
    // This deliberately covers /login too. The QR step is page state, not a route,
    // so refreshing on it drops back to the sign-in form — and exempting /login
    // here left the half-finished session alive behind that form: signed in as far
    // as Directus is concerned, but with no 2FA and no way to say so.
    await authStore.logout(false)
    return navigateTo(`${LOGIN_ROUTE}?tfa=required`)
  }

  if (
    !mustEnrolInTfa
    && (PUBLIC_ROUTES.includes(to.path) || to.path === '/')
  ) {
    return navigateTo(DEFAULT_ROUTE)
  }
})
