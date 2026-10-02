/**
 * Persist a snapshot of form state to sessionStorage so it survives navigation
 * away and back to the same page. The caller supplies the storage key, a getter
 * that returns the snapshot to save, and a setter that applies a snapshot when
 * restoring. `restore()` consumes the stored entry once read.
 */
export function useFormSessionPersistence<T>(
  key: string,
  getState: () => T,
  setState: (state: T) => void,
) {
  function save() {
    sessionStorage.setItem(key, JSON.stringify(getState()))
  }

  function restore(): boolean {
    const stored = sessionStorage.getItem(key)
    if (!stored) { return false }
    setState(JSON.parse(stored) as T)
    sessionStorage.removeItem(key)
    return true
  }

  function clear() {
    sessionStorage.removeItem(key)
  }

  return { save, restore, clear }
}
