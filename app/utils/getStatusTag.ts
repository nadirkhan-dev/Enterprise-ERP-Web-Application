/**
 * Maps a status string to its display label and status-tag CSS class.
 *
 * Handles the document vocabulary (open / closed / cancelled) shown on the
 * Looker-backed detail tables as well as the active / inactive vocabulary,
 * case-insensitively. Unknown values fall back to the neutral style.
 */
const STATUS_TAG_CLASSES: Record<string, string> = {
  open: 'status-active',
  active: 'status-active',
  closed: 'status-closed',
  cancelled: 'status-inactive',
  canceled: 'status-inactive',
  inactive: 'status-inactive',
}

export function getStatusTag(status?: string | null): { label: string, class: string } {
  const normalized = String(status ?? '').trim().toLowerCase()
  return {
    label: normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '',
    class: STATUS_TAG_CLASSES[normalized] ?? 'status-closed',
  }
}
