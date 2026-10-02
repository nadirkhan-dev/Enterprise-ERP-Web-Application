/**
 * Listens for deploy notifications via Server-Sent Events (SSE).
 *
 * After a successful deploy, GitHub Actions POSTs { version, env } to
 * the Nuxt server at /api/deploy. The server relays it over SSE to
 * all connected browsers, which show an "update available" banner.
 *
 * On SSE reconnection (e.g. after the server restarts during a deploy),
 * the composable fetches /version.json from the (possibly new) server and
 * compares it against the version cached on initial page load. If they
 * differ, the banner is shown - covering the case where the SSE push
 * was missed because the connection dropped during deployment.
 */

// Module-level singleton state - shared across all component instances
const updateAvailable = ref(false)
const updatePending = ref(false)
const deployVersion = ref('')
const versionDetailsOpen = ref(false)

let currentVersion = ''
let eventSource: EventSource | null = null
let isFirstOpen = true
let loadVersionPromise: Promise<void> | null = null

async function loadCurrentVersion(): Promise<void> {
  try {
    const response = await fetch('/version.json')
    const payload = await response.json()
    currentVersion = payload.id || ''
  } catch {
    // version.json not available (dev mode) - skip version comparison
  }
}

function ensureCurrentVersionLoaded(): Promise<void> {
  if (currentVersion) return Promise.resolve()

  if (!loadVersionPromise) {
    loadVersionPromise = loadCurrentVersion().finally(() => {
      if (!currentVersion) loadVersionPromise = null
    })
  }

  return loadVersionPromise
}

async function checkVersionOnReconnect(): Promise<void> {
  if (!currentVersion) return

  try {
    const response = await fetch('/version.json', { cache: 'no-store' })
    const payload = await response.json()
    const serverId = payload.id || ''

    if (serverId && serverId !== currentVersion) {
      updateAvailable.value = true
      updatePending.value = true
      deployVersion.value = payload.version || ''
    }
  } catch {
    // Network issue - ignore, SSE will reconnect
  }
}

export function useDeployNotification() {
  function startListening(): void {
    if (eventSource) return

    // Load version early so an immediate SSE message can be compared correctly.
    void ensureCurrentVersionLoaded()

    eventSource = new EventSource('/api/deploy/events')
    isFirstOpen = true

    eventSource.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data)
        const incomingVersion = data.version || ''

        // Prevent showing the prompt again right after a refresh when the server
        // broadcasts the currently-running version on connect.
        await ensureCurrentVersionLoaded()

        // Suppress if already on the latest version
        if (currentVersion && incomingVersion === currentVersion) return
        // Suppress duplicate notifications for the same pending version
        if (updatePending.value && incomingVersion && incomingVersion === deployVersion.value) return

        updateAvailable.value = true
        updatePending.value = true
        deployVersion.value = incomingVersion
      } catch {
      }
    }

    // On reconnect after a server restart (deploy), check if version changed
    eventSource.addEventListener('open', () => {
      if (isFirstOpen) {
        isFirstOpen = false
        return
      }
      void ensureCurrentVersionLoaded().then(() => checkVersionOnReconnect())
    })
  }

  function stopListening(): void {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
  }

  function refresh(): void {
    window.location.reload()
  }

  function dismiss(): void {
    updateAvailable.value = false
    versionDetailsOpen.value = false
  }

  function openVersionDetails(): void {
    versionDetailsOpen.value = true
  }

  function closeVersionDetails(): void {
    versionDetailsOpen.value = false
  }

  return {
    updateAvailable: readonly(updateAvailable),
    updatePending: readonly(updatePending),
    deployVersion: readonly(deployVersion),
    versionDetailsOpen: readonly(versionDetailsOpen),
    startListening,
    stopListening,
    refresh,
    dismiss,
    openVersionDetails,
    closeVersionDetails,
  }
}
