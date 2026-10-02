<script setup lang="ts">
// Renders a Cloudflare Turnstile challenge and emits the resulting token. Loads
// the Turnstile script on demand (client-only) and renders explicitly so the
// host form controls placement. Renders nothing when no site key is configured
// (e.g. local dev without keys), so the form can still submit.
//
// Turnstile's normal widget is a fixed 300x65, which overflows narrow
// containers (and mobile). To fit any width we render at the natural size and
// scale it down to the container, sizing the wrapper to the scaled height.

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

const emit = defineEmits<{
  verified: [token: string]
  expired: []
  error: []
}>()

const config = useRuntimeConfig()
const siteKey = config.public.turnstileSiteKey as string

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
// Turnstile's intrinsic widget size — external constants, not design tokens.
const WIDGET_WIDTH = 300
const WIDGET_HEIGHT = 65

const outer = ref<HTMLElement | null>(null)
const inner = ref<HTMLElement | null>(null)
const scale = ref(1)
// Cloudflare's script loads asynchronously, so the widget appears a beat after
// mount. We reserve its height up front (no layout jump) and show a spinner in
// that space until the widget itself renders.
const isWidgetReady = ref(false)
let widgetId: string | null = null
let resizeObserver: ResizeObserver | null = null

const scaledHeight = computed(() => `${WIDGET_HEIGHT * scale.value}px`)

function getTurnstile(): TurnstileApi | null {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile ?? null
}

// Scale the fixed-width widget down to fit the available container width, and
// reveal it (hiding the spinner) once Cloudflare has rendered its iframe.
function updateScale() {
  if (!outer.value) {
    return
  }
  const available = outer.value.clientWidth
  scale.value = available > 0 && available < WIDGET_WIDTH ? available / WIDGET_WIDTH : 1
  if ((inner.value?.childElementCount ?? 0) > 0) {
    isWidgetReady.value = true
  }
}

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (getTurnstile()) {
      resolve()
      return
    }
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Turnstile failed to load')))
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error('Turnstile failed to load')))
    document.head.appendChild(script)
  })
}

function renderWidget() {
  const turnstile = getTurnstile()
  if (!turnstile || !inner.value) {
    return
  }
  widgetId = turnstile.render(inner.value, {
    'sitekey': siteKey,
    'callback': (token: string) => {
      isWidgetReady.value = true
      emit('verified', token)
    },
    'expired-callback': () => emit('expired'),
    'error-callback': () => {
      // Reveal whatever Cloudflare renders (incl. its error box) so the spinner
      // doesn't spin forever on failure.
      isWidgetReady.value = true
      emit('error')
    },
  })
  updateScale()
}

function reset() {
  const turnstile = getTurnstile()
  if (turnstile && widgetId !== null) {
    turnstile.reset(widgetId)
  }
}

onMounted(async () => {
  if (!siteKey) {
    return
  }
  updateScale()
  resizeObserver = new ResizeObserver(() => updateScale())
  if (outer.value) {
    resizeObserver.observe(outer.value)
  }
  // Watch the inner host too — it gains the Turnstile iframe a beat after render.
  if (inner.value) {
    resizeObserver.observe(inner.value)
  }
  try {
    await loadScript()
    renderWidget()
  } catch (loadError) {
    console.error(loadError)
    emit('error')
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  const turnstile = getTurnstile()
  if (turnstile && widgetId !== null) {
    turnstile.remove(widgetId)
  }
})

defineExpose({ reset })
</script>

<template>
  <div
    v-if="siteKey"
    ref="outer"
    class="turnstile-widget"
    :style="{ height: scaledHeight }"
  >
    <BaseSpinner
      v-if="!isWidgetReady"
      size="sm"
      class="turnstile-widget__spinner"
    />
    <div
      ref="inner"
      class="turnstile-widget__inner"
      :style="{ width: `${WIDGET_WIDTH}px`, transform: `scale(${scale})` }"
    />
  </div>
</template>

<style scoped>
.turnstile-widget {
    position: relative;
    width: 100%;
    overflow: hidden;
    display: flex;
    justify-content: center;
}

.turnstile-widget__spinner {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}

.turnstile-widget__inner {
    transform-origin: top center;
}
</style>
