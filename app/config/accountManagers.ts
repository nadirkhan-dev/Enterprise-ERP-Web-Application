
export const UNASSIGNED_ACCOUNT_MANAGER_ID = 'unassigned'

export interface AccountManagerOption {
  id: string
  name: string
  avatarUrl: string | null
}

export const UNASSIGNED_ACCOUNT_MANAGER: AccountManagerOption = {
  id: UNASSIGNED_ACCOUNT_MANAGER_ID,
  name: 'Unassigned',
  // No avatar — the filter list already falls back to a generic person icon.
  avatarUrl: null,
}

/** Split a filter selection into real user ids and the unassigned sentinel. */
export function splitAccountManagerIds(ids: string[]): {
  managerIds: string[]
  includeUnassigned: boolean
} {
  return {
    managerIds: ids.filter((id) => id !== UNASSIGNED_ACCOUNT_MANAGER_ID),
    includeUnassigned: ids.includes(UNASSIGNED_ACCOUNT_MANAGER_ID),
  }
}
