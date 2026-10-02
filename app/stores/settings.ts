import { readSettings } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'

interface SettingsState {
  mapboxToken: string | null
  // Directus's own error message when the settings fetch fails outright (e.g.
  // the role can't read `directus_settings`), else null. Distinct from a
  // successful fetch that simply has no `mapbox_key` configured — that stays
  // null so the map/geocoder keep quiet about an unconfigured-but-working
  // backend. Carries the real reason so the eventual toast can show it verbatim.
  settingsErrorMessage: string | null
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    mapboxToken: null,
    settingsErrorMessage: null,
  }),
  actions: {
    async fetchSettings(): Promise<void> {
      if (this.mapboxToken) {
        return
      }

      const { data: settings, error } = await tryCatch(
        useDirectus().request(
          readSettings({ fields: ['mapbox_key'] }),
        ),
      )

      if (error) {
        // Runs at login, before the app shell (and its <Toast />) mounts, so we
        // can't toast here. Stash Directus's own message instead; the
        // map/geocoder surface it the first time the feature is used post-login.
        this.settingsErrorMessage = getDirectusErrorMessage(
          error,
          'Map services are unavailable. Please try again later.',
        )
        console.error('Failed to fetch Directus settings:', error.message)
        return
      }

      this.settingsErrorMessage = null
      this.mapboxToken = settings?.mapbox_key || null
    },
  },
})
