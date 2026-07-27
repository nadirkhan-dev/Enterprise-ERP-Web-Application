// Module-scoped flag shared across every caller (Directus CRUD, geocoder,
// etc.) so the user sees exactly one "API request failed" toast per session,
// even when multiple backends fail around the same time.
let hasShownApiFailureToast = false

interface ToastLike {
  add: (options: Record<string, unknown>) => void
}

export function showApiFailureToast(toast: ToastLike | null, detail: string) {
  if (!toast || hasShownApiFailureToast) return
  hasShownApiFailureToast = true
  toast.add({
    severity: 'error',
    summary: 'API request failed',
    detail,
    life: 5000,
  })
}
