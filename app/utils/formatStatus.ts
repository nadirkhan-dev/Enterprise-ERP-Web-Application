/**
 * Format a status string for display.
 * Converts lowercase Directus values ('active'/'inactive') to title case.
 */
export function formatStatus(status: string): string {
  return status === 'active' ? 'Active' : 'Inactive'
}
