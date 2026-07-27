import type { Ref } from 'vue'

/**
 * Drawer "unsaved changes" session guard.
 *
 * Builds on the same snapshot/baseline dirty-tracking as {@link useUnsavedGuard},
 * but adds the **preserve-and-resume** flow used across the editing drawers:
 *
 *  - Edit a field, then dismiss the drawer (outside click / Escape) → BaseDrawer
 *    shows the "Save Changes / Close Anyway" dialog.
 *  - "Close Anyway" calls {@link markClosedAnyway} — the drawer closes WITHOUT
 *    discarding; the in-progress edits stay in the form.
 *  - Reopening the SAME record → `showResumePrompt` flips true so the drawer can
 *    show a yes/no prompt: **Yes** ({@link continueEditing}) keeps the preserved
 *    edits, **No** ({@link discardResume}) re-populates a clean form.
 *  - Opening a DIFFERENT record (or a fresh open with no preserved edits) just
 *    populates normally.
 *
 * The caller owns form population — pass a `populate()` that writes the form from
 * props. The guard decides WHEN to call it (fresh open / discard-resume) and when
 * to skip it (resuming preserved edits). Drawers with side-effecting open logic
 * (e.g. Square / Mapbox setup) must keep that setup OUTSIDE `populate()` so it
 * still runs on every open.
 */
export function useDrawerResumeGuard(options: {
  /** The drawer's open state (its `localVisible`). */
  isOpen: Ref<boolean>
  /** Identity of the record being edited — used to detect "same record" on reopen. */
  recordKey: () => unknown
  /** A serializable snapshot of the form state for dirty-tracking. */
  snapshot: () => unknown
  /** Populate the form from props. Called on fresh open and on discard-resume. */
  populate: () => void | Promise<void>
}) {
  const { isOpen, recordKey, snapshot, populate } = options

  // Baseline is managed here (not via useUnsavedGuard) so it survives a
  // Close-Anyway close — that's what keeps `isDirty` meaningful when the user
  // resumes the preserved edits.
  const baseline = ref<string | null>(null)

  function serialize(): string {
    try {
      return JSON.stringify(snapshot()) ?? ''
    } catch {
      return ''
    }
  }

  const isDirty = computed<boolean>(() => {
    if (baseline.value === null) return false
    return serialize() !== baseline.value
  })

  const showResumePrompt = ref(false)
  // True once the user has chosen "Close Anyway" with unsaved edits — the form
  // is intentionally left as-is for the next open.
  const hasPreservedEdits = ref(false)
  const lastKey = ref<unknown>(undefined)

  async function runPopulate(): Promise<void> {
    await populate()
    baseline.value = serialize()
  }

  watch(isOpen, async (open) => {
    if (!open) {
      showResumePrompt.value = false
      return
    }
    const key = recordKey()
    // Same record + preserved edits → ask whether to resume them.
    if (hasPreservedEdits.value && lastKey.value === key) {
      showResumePrompt.value = true
      return
    }
    // Fresh open or a different record → clean populate.
    lastKey.value = key
    hasPreservedEdits.value = false
    await runPopulate()
  })

  /**
   * Called when the user picks "Close Anyway" in BaseDrawer's dialog. Preserves
   * the in-progress edits so reopening the same record offers to resume them.
   */
  function markClosedAnyway(): void {
    hasPreservedEdits.value = isDirty.value
    lastKey.value = recordKey()
  }

  /** Resume prompt → "Yes": keep the preserved edits (baseline is unchanged). */
  function continueEditing(): void {
    showResumePrompt.value = false
  }

  /** Resume prompt → "No": discard the preserved edits and populate a clean form. */
  async function discardResume(): Promise<void> {
    showResumePrompt.value = false
    hasPreservedEdits.value = false
    lastKey.value = recordKey()
    await runPopulate()
  }

  /** After a successful save — re-baseline and drop any preserved-edit flag. */
  function markSaved(): void {
    hasPreservedEdits.value = false
    baseline.value = serialize()
  }

  return {
    isDirty,
    showResumePrompt,
    markClosedAnyway,
    continueEditing,
    discardResume,
    markSaved,
    /** Re-capture the baseline (e.g. after appending an item to a sub-list). */
    captureBaseline: () => { baseline.value = serialize() },
  }
}
