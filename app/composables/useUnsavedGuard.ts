import type { Ref } from 'vue'

/**
 * Tracks whether a drawer's form has unsaved changes by comparing a serialized
 * snapshot of the current form state against a baseline captured when the form
 * was populated.
 *
 * Usage pattern (per drawer):
 *   const { isDirty, captureBaseline, resetBaseline } = useUnsavedGuard(
 *     () => ({ ...form }),   // a getter returning the serializable form state
 *     localVisible,          // the drawer's open ref
 *   )
 *   // after populating the form (NOT on open — the form may still be empty):
 *   captureBaseline()
 *   // after a successful save (so a saved form is no longer "dirty"):
 *   resetBaseline()
 *
 * The baseline is captured explicitly by the caller rather than automatically
 * on open, because most drawers populate their form asynchronously inside a
 * `watch(visible)` — snapshotting on the open transition would capture an empty
 * form and report everything as dirty. The baseline is cleared when the drawer
 * closes so a stale baseline can't leak into the next record.
 *
 * Comparison is via `JSON.stringify` of the snapshot. The snapshot shape is
 * caller-controlled (primitives / arrays / plain objects only), so key order is
 * stable and the string compare is reliable.
 */
export function useUnsavedGuard(getSnapshot: () => unknown, isOpen: Ref<boolean>) {
  const baseline = ref<string | null>(null)

  function serialize(): string {
    try {
      return JSON.stringify(getSnapshot()) ?? ''
    } catch {
      return ''
    }
  }

  /** Capture the current form state as the clean baseline. Call after populate. */
  function captureBaseline(): void {
    baseline.value = serialize()
  }

  /** Re-baseline to the current state (e.g. after a successful save). */
  function resetBaseline(): void {
    baseline.value = serialize()
  }

  const isDirty = computed<boolean>(() => {
    if (baseline.value === null) return false
    return serialize() !== baseline.value
  })

  // Drop the baseline on close so reopening a different record re-captures clean.
  watch(isOpen, (open) => {
    if (!open) baseline.value = null
  })

  return { isDirty, captureBaseline, resetBaseline }
}
