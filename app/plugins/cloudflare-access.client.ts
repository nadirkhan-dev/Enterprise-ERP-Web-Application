import { useCloudflareAccess } from '~/composables/useCloudflareAccess'

/**
 * Armed for the whole life of the tab rather than tied to the Directus session:
 * Cloudflare Access sits in front of the hostname, so its deadline applies
 * whether or not anyone is signed in to Connect. The watch costs nothing where
 * there is no Access cookie to read (local dev), and stays silent there.
 */
export default defineNuxtPlugin(() => {
  useCloudflareAccess().startAccessWatch()
})
