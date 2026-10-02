/**
 * Copy for the amber banner shown when a record that is still a default pointer
 * (default sales/billing contact, default shipping/billing address) is switched
 * to Inactive (CONNECT-708).
 *
 * The user must repoint the default before the record can be deactivated, so the
 * message names every role the record currently fills and Save stays disabled
 * until they're all reassigned.
 *
 * @param subject – the record being deactivated, e.g. 'contact' or 'address'
 * @param roles – the default roles it currently fills, e.g. ['default sales contact']
 * @returns the banner sentence, or an empty string when it fills no default role
 */
export function buildDefaultAssignmentWarning(subject: string, roles: string[] = []): string {
  if (!roles.length) { return '' }
  const list = roles.join(' and ')
  return `This ${subject} is currently assigned as the ${list}. `
    + `Select a new ${list} before setting this ${subject} to inactive.`
}
