export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) { return '$0.00' }
  const numericValue = Number(value)
  const formatted = Math.abs(numericValue).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  // Negatives use accounting format — ($32,750.36) rather than $-32,750.36.
  // Positives and zero are unchanged.
  return numericValue < 0 ? `($${formatted})` : `$${formatted}`
}
