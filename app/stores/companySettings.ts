import { readItems } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'

// Cast to bypass generic schema constraints (same pattern as useDirectusCrud).
const _readItems = readItems as any

interface CompanySettingsState {
  genericEmailDomains: string[]
  loaded: boolean
}

/**
 * Company-wide configuration read from the `company_settings` singleton.
 *
 * `genericEmailDomains` lists shared-inbox providers (gmail, yahoo, …) that must
 * be matched by *exact* email address rather than by domain during duplicate
 * detection — otherwise a single generic domain would flag hundreds of
 * unrelated partners for the user to dismiss. Fetched once and cached; the list
 * is admin-managed and changes rarely.
 */
export const useCompanySettingsStore = defineStore('companySettings', {
  state: (): CompanySettingsState => ({
    genericEmailDomains: [],
    loaded: false,
  }),

  getters: {
    /**
     * Lowercased set of generic provider domains for O(1) membership checks.
     */
    genericEmailDomainSet(state): Set<string> {
      return new Set(state.genericEmailDomains.map((domain) => domain.trim().toLowerCase()))
    },
  },

  actions: {
    /**
     * Fetch the singleton once and cache it. Idempotent — safe to await from any
     * duplicate-search entry point as a guard against a missed hydration.
     */
    async fetchCompanySettings(): Promise<void> {
      if (this.loaded) { return }

      const { data: settings, error } = await tryCatch(
        useDirectus().request(
          _readItems('company_settings', {
            fields: ['generic_email_domains'],
            limit: 1,
          }),
        ),
      )

      if (error) {
        console.error('Failed to fetch company settings:', error.message)
        return
      }

      const record = Array.isArray(settings) ? settings[0] : settings
      const domains = record?.generic_email_domains
      this.genericEmailDomains = Array.isArray(domains) ? domains : []
      this.loaded = true
    },

    /**
     * Reset store state — call on logout.
     */
    $resetCompanySettings(): void {
      this.genericEmailDomains = []
      this.loaded = false
    },
  },
})
