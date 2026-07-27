import { readUsers } from '@directus/sdk'
import type { TryCatchResult } from '~/types/api'
import { useDirectus } from '~/composables/useDirectus'

interface DirectusUserSummary {
  id: string
  first_name: string | null
  last_name: string | null
  avatar: string | null
}

interface UseDirectusUsersReturn {
  fetchUsers: () => Promise<TryCatchResult<DirectusUserSummary[]>>
  fetchAccountManagers: (departmentId?: number) => Promise<TryCatchResult<DirectusUserSummary[]>>
}

const _readUsers = readUsers as any

/**
 * Composable for accessing the directus_users system collection.
 * Uses the SDK's readUsers helper because the generic readItems()
 * rejects core/system collections.
 */
export function useDirectusUsers(): UseDirectusUsersReturn {
  const directus = useDirectus()

  /**
   * Fetch all active users, sorted by name. Used to populate user-selection
   * dropdowns (activity follow-up assignee, etc.).
   */
  async function fetchUsers(): Promise<TryCatchResult<DirectusUserSummary[]>> {
    return await tryCatch(directus.request(_readUsers({
      fields: ['id', 'first_name', 'last_name', 'avatar'],
      filter: { status: { _eq: 'active' } },
      sort: ['first_name', 'last_name'],
      limit: -1,
    })))
  }

  /**
   * Fetch the users eligible to be account managers for a department, sorted by
   * name. An account manager is an active member of the given SAP department —
   * Sales (id 1, the default) for customers, Logistics (id 8) for suppliers.
   * Used to populate the "Account Manager" filter and the account-info drawer's
   * reassign picker.
   *
   * The sales-employee-id criterion was dropped (CONNECT-586/634): every sales
   * member is guaranteed a SAP sales employee id, so gating on it added no
   * usability while forcing the backend to expose sap_sales_employee_id — a
   * false sense of security over a field better kept unreadable. One UI filter
   * now maps one-to-one to one backend field (sap_department_id).
   *
   * @param {number} [departmentId=1] SAP department id to filter by.
   */
  async function fetchAccountManagers(departmentId = 1): Promise<TryCatchResult<DirectusUserSummary[]>> {
    return await tryCatch(directus.request(_readUsers({
      fields: ['id', 'first_name', 'last_name', 'avatar'],
      filter: {
        status: { _eq: 'active' },
        sap_department_id: { _eq: departmentId },
      },
      sort: ['first_name', 'last_name'],
      limit: -1,
    })))
  }

  return { fetchUsers, fetchAccountManagers }
}
