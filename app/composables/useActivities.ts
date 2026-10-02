import type { TryCatchResult } from '~/types/api'
import type { Activity } from '~/types/directus'
import { useDirectusCrud } from '~/composables/useDirectusCrud'
import { useFollowUps } from '~/composables/useFollowUps'

const ACTIVITY_FIELDS: string[] = [
  'id',
  'subject',
  'remarks',
  'date_created',
  'activity_groups_id.id',
  'activity_groups_id.name',
  'user_created.first_name',
  'user_created.last_name',
  'business_partners_contacts_id.id',
  'business_partners_contacts_id.contacts_id.first_name',
  'business_partners_contacts_id.contacts_id.last_name',
  'source_follow_ups_id.id',
  'source_follow_ups_id.due_date',
  'source_follow_ups_id.assigned_user_id.id',
  'source_follow_ups_id.assigned_user_id.first_name',
  'source_follow_ups_id.assigned_user_id.last_name',
]

interface FetchActivitiesOptions {
  page?: number
  /** Rows per page. Pass -1 to fetch the full set in one call. */
  limit?: number
}

interface UseActivitiesReturn {
  fetchActivities: (businessPartnerId: number | string, options?: FetchActivitiesOptions) => Promise<TryCatchResult<Activity[]>>
  fetchActivityCount: (businessPartnerId: number | string) => Promise<TryCatchResult<number>>
  createActivity: (payload: Record<string, unknown>) => Promise<TryCatchResult<Activity>>
  updateActivity: (activityId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<Activity>>
  deleteActivity: (activityId: number | string) => Promise<TryCatchResult<void>>
}

/**
 * Composable for the activities collection.
 *
 * Activities have no o2m alias on `business_partners`, so they are fetched
 * by filtering on `business_partners_id`. Creation omits `sap_id` — the
 * `[SAP] Activity Create` flow and its trigger own that column server-side.
 */
export function useActivities(): UseActivitiesReturn {
  const crud = useDirectusCrud('activities')
  const { fetchFollowUpsBySourceActivities } = useFollowUps()

  function buildActivityFilter(businessPartnerId: number | string): Record<string, unknown> {
    return { business_partners_id: { _eq: businessPartnerId } }
  }

  /**
   * Attach to each activity the follow-up created *from* it (the `sources`
   * m2a — the inverse of `source_follow_ups_id`) as `sourced_follow_up`, so
   * the drawer can surface a follow-up added to an activity it did not
   * generate. Non-fatal: on failure the activities still load unenriched.
   */
  async function attachSourcedFollowUps(activities: Record<string, any>[]): Promise<void> {
    const { data: followUps } = await fetchFollowUpsBySourceActivities(
      activities.map((activity) => activity.id),
    )
    if (!followUps?.length) {
      return
    }
    const followUpByActivityId = new Map<number, Record<string, any>>()
    for (const followUp of followUps) {
      for (const source of followUp.sources ?? []) {
        if (source.sources_collection === 'activities') {
          followUpByActivityId.set(Number(source.sources_id), followUp)
        }
      }
    }
    for (const activity of activities) {
      activity.sourced_follow_up = followUpByActivityId.get(activity.id) ?? null
    }
  }

  async function fetchActivities(
    businessPartnerId: number | string,
    options: FetchActivitiesOptions = {},
  ): Promise<TryCatchResult<Activity[]>> {
    const { page = 1, limit = -1 } = options
    const activitiesResult = await crud.fetchMany({
      fields: ACTIVITY_FIELDS,
      filter: buildActivityFilter(businessPartnerId),
      sort: ['-date_created'],
      limit,
      page,
    })
    if (activitiesResult.error || !activitiesResult.data) {
      return activitiesResult
    }
    await attachSourcedFollowUps(activitiesResult.data)
    return activitiesResult
  }

  async function fetchActivityCount(businessPartnerId: number | string): Promise<TryCatchResult<number>> {
    return await crud.fetchCount(buildActivityFilter(businessPartnerId))
  }

  async function createActivity(payload: Record<string, unknown>): Promise<TryCatchResult<Activity>> {
    return await crud.createOne(payload)
  }

  async function updateActivity(
    activityId: number | string,
    payload: Record<string, unknown>,
  ): Promise<TryCatchResult<Activity>> {
    return await crud.updateOne(activityId, payload)
  }

  async function deleteActivity(activityId: number | string): Promise<TryCatchResult<void>> {
    return await crud.removeOne(activityId)
  }

  return {
    fetchActivities,
    fetchActivityCount,
    createActivity,
    updateActivity,
    deleteActivity,
  }
}
