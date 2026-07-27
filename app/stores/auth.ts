import { readMe as _readMe, passwordRequest, passwordReset, isDirectusError } from '@directus/sdk'
import {
  useDirectus,
  createPublicDirectusClient,
  setAuthPersistence,
  resolveAuthPersistence,
  cleanupStaleAuthStorage,
  clearAuthStorage,
  resetDirectusClient,
} from '~/composables/useDirectus'
import { LOGIN_ROUTE } from '~/config/routes'
import { useSettingsStore } from '~/stores/settings'
import { useReferenceDataStore } from '~/stores/referenceData'
import { useCompanySettingsStore } from '~/stores/companySettings'

interface DirectusUser {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  avatar: string | null
  sap_department_id: number | null
  // Per-user Connect preferences (JSON field on directus_users). When
  // `show_page_scrollbar` is explicitly false, every scrollbar in the app is
  // hidden (see the `showPageScrollbar` getter and .app-hide-scrollbars).
  connect_config: { show_page_scrollbar?: boolean | null } | null
}

interface AuthState {
  user: DirectusUser | null
  isAuthenticated: boolean
  loading: boolean
  authReady: boolean
  rememberMe: boolean
  error: string | null
}

// Cast around the SDK's generated schema, which doesn't include the custom
// sap_* fields on directus_users. Mirrors the readUsers cast in useDirectusUsers.
const readMe = _readMe as any

const AUTH_TIMEOUT_MS: number = 10000

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    isAuthenticated: false,
    loading: false,
    authReady: false,
    rememberMe: false,
    error: null,
  }),
  actions: {
    async login(email: string, password: string, rememberMe: boolean = false, otp: string | null = null): Promise<void> {
      this.loading = true
      this.error = null
      setAuthPersistence(rememberMe)

      try {
        const directus = useDirectus()
        const loginOptions = otp ? { otp } : undefined
        await directus.login({ email, password }, loginOptions)
        cleanupStaleAuthStorage()
        this.isAuthenticated = true
        this.rememberMe = rememberMe
        await this.fetchUser()
        await Promise.all([
          useSettingsStore().fetchSettings(),
          useReferenceDataStore().hydrate(),
          useCompanySettingsStore().fetchCompanySettings(),
        ])

        // Warm the special-SKU reference data in the background so the
        // Items/Dashboard pickers are ready without a per-open sync. Cache-aware
        // and persisted, so it's a no-op once loaded — never awaited, so it can't
        // slow sign-in.
        void useSpecialSkuReferenceDataStore().hydrate()

        if (!this.user) {
          throw new Error(
            'Authenticated but failed to load user profile',
          )
        }
      } catch (loginError: unknown) {
        this.isAuthenticated = false
        this.user = null
        this.rememberMe = false

        // Directus returns INVALID_OTP when TFA is enabled but no OTP was provided
        if (isDirectusError(loginError)) {
          const errorCode = (loginError as any).errors?.[0]?.extensions?.code
          if (errorCode === 'INVALID_OTP') {
            this.loading = false
            throw { otpRequired: true }
          }
        }

        this.error = (loginError as Error).message || 'Login failed'
        throw loginError
      } finally {
        this.loading = false
      }
    },
    async fetchUser(): Promise<void> {
      // Core identity fields, granted by every app policy.
      const { data: userData, error: fetchError } = await tryCatch(
        useDirectus().request(
          readMe({
            fields: [
              'id',
              'email',
              'first_name',
              'last_name',
              'avatar',
              'sap_department_id',
            ],
          }),
        ),
      )

      if (fetchError) {
        this.user = null
        this.isAuthenticated = false
        this.error = fetchError.message
        return
      }

      // connect_config is a per-user preference that not every policy grants read
      // on. Directus 11 rejects the WHOLE /users/me when a requested field is
      // forbidden, so it's fetched separately and best-effort: a permission error
      // just leaves it null, which showPageScrollbar treats as the default
      // (shown). This keeps identity (name, avatar) loading for users — e.g.
      // Operations — whose policy omits the field.
      const { data: preferences } = await tryCatch(
        useDirectus().request(readMe({ fields: ['connect_config'] })),
      )

      this.user = {
        ...(userData as Record<string, unknown>),
        connect_config:
          (preferences as { connect_config?: DirectusUser['connect_config'] } | null)?.connect_config ?? null,
      } as unknown as DirectusUser
    },
    /**
     * @param redirect — pass false when the caller navigates itself (the auth
     *   middleware does, so the two don't race to route).
     */
    async logout(redirect: boolean = true): Promise<void> {
      const directus = useDirectus()
      try {
        await directus.logout()
      } catch {
        // /auth/logout fails when no refresh_token is stored (remember me
        // unchecked). We still need to clear local state below.
      }
      clearAuthStorage()
      setAuthPersistence(false)
      this.user = null
      this.isAuthenticated = false
      this.rememberMe = false
      this.error = null
      this.authReady = false
      useReferenceDataStore().$resetReferenceData()
      useCompanySettingsStore().$resetCompanySettings()
      // Filters live in sessionStorage; logout is an SPA navigation (no reload),
      // so reset them here too — the next login starts from fresh defaults.
      useItemsFilterStore().$reset()
      useSuppliersFilterStore().$reset()
      useCustomerFilterStore().$reset()
      // The next user to sign in gets their own 2FA verdict, not this one's.
      useTfaEnforcement().resetTfaEnforcement()
      // Likewise clear cached create-rights / account-manager capabilities, or the
      // next user inherits this session's permission UI until a manual refresh.
      resetPermissions()
      resetDirectusClient()
      if (redirect) {
        navigateTo(LOGIN_ROUTE)
      }
    },
    async requestPasswordReset(email: string): Promise<void> {
      this.loading = true
      this.error = null
      try {
        // Public flow — use a no-auth client so a stale/expired token in storage
        // isn't attached (Directus would reject it with TOKEN_EXPIRED first).
        const directus = createPublicDirectusClient()
        const config = useRuntimeConfig()
        const resetUrl = config.public.passwordResetUrl as string
        await directus.request(
          resetUrl
            ? passwordRequest(email, resetUrl)
            : passwordRequest(email),
        )
      } catch (resetError: unknown) {
        this.error =
                    (resetError as Error).message || 'Password reset request failed'
        throw resetError
      } finally {
        this.loading = false
      }
    },
    async resetPassword(token: string, newPassword: string): Promise<void> {
      this.loading = true
      this.error = null
      try {
        // Public flow — no-auth client (see requestPasswordReset): the reset
        // token travels in the body, never as a bearer.
        const directus = createPublicDirectusClient()
        await directus.request(passwordReset(token, newPassword))
      } catch (resetError: unknown) {
        this.error = (resetError as Error).message || 'Password reset failed'
        throw resetError
      } finally {
        this.loading = false
      }
    },
    async checkAuth(): Promise<boolean> {
      if (this.authReady) {
        return this.isAuthenticated
      }

      const resolvedPersistence = resolveAuthPersistence()
      setAuthPersistence(resolvedPersistence)

      let timerId: ReturnType<typeof setTimeout> | null = null

      try {
        const directus = useDirectus()

        const timeout = new Promise<never>((_, reject) => {
          timerId = setTimeout(
            () => reject(new Error('Auth check timed out')),
            AUTH_TIMEOUT_MS,
          )
        })

        const token = await Promise.race([
          directus.getToken(),
          timeout,
        ])

        if (!token) {
          this.user = null
          this.isAuthenticated = false
          this.authReady = true
          return false
        }

        // Try fetching user with the current token first.
        // This avoids racing with the SDK's autoRefresh which may
        // already be refreshing the token in the background.
        await Promise.race([this.fetchUser(), timeout])

        // If the token was expired and fetchUser failed, explicitly
        // refresh and retry — autoRefresh won't have triggered because
        // the token is already expired, not "about to expire".
        if (!this.user) {
          this.error = null
          await Promise.race([
            directus.refresh().then(() => this.fetchUser()),
            timeout,
          ])
        }

        if (this.user) {
          this.isAuthenticated = true
          this.rememberMe = resolvedPersistence
          this.authReady = true
          await Promise.all([
            useSettingsStore().fetchSettings(),
            useReferenceDataStore().hydrate(),
            useCompanySettingsStore().fetchCompanySettings(),
          ])

          // Warm the special-SKU reference data in the background (see login)
          // so the pickers are ready without a per-open sync — never awaited.
          void useSpecialSkuReferenceDataStore().hydrate()
          return true
        }

        this.isAuthenticated = false
        this.authReady = true
        return false
      } catch {
        this.user = null
        this.isAuthenticated = false
        this.authReady = true
        return false
      } finally {
        if (timerId) clearTimeout(timerId)
      }
    },
  },
  persist: {
    pick: ['user', 'isAuthenticated', 'rememberMe'],
  },
  getters: {
    fullName: (state): string => {
      if (!state.user) {
        return ''
      }
      return [state.user.first_name, state.user.last_name]
        .filter(Boolean)
        .join(' ')
    },
    userInitial: (state): string => {
      if (!state.user?.first_name) {
        return '?'
      }
      return state.user.first_name.charAt(0).toUpperCase()
    },
    // True when the logged-in user is an Account Manager: an active member of the
    // Sales department (sap_department_id === 1) with a valid SAP Sales Employee
    // ID (an integer). Authenticated users are active by definition. Mirrors the
    // filter in useDirectusUsers.fetchAccountManagers.
    isAccountManager: (state): boolean =>
      state.user?.sap_department_id === 1,
    // Whether scrollbars are shown anywhere in the app. Defaults to true so the
    // scrollbars stay as-is unless connect_config.show_page_scrollbar is
    // explicitly false (absent/null ⇒ shown). Consumed by the layout to gate the
    // page overlay and toggle the global .app-hide-scrollbars class.
    showPageScrollbar: (state): boolean =>
      state.user?.connect_config?.show_page_scrollbar !== false,
  },
})
