import type { TryCatchResult } from '~/types/api'
import type { FollowUp } from '~/types/directus'
import { useDirectusCrud } from '~/composables/useDirectusCrud'

// Fields needed to prefill the activity drawer from a follow-up that was
// created *from* an activity via the `sources` m2a link.
const SOURCED_FOLLOW_UP_FIELDS: string[] = [
  'id',
  'due_date',
  'assigned_user_id.id',
  'assigned_user_id.first_name',
  'assigned_user_id.last_name',
  'sources.sources_id',
  'sources.sources_collection',
]

interface UseFollowUpsReturn {
  fetchFollowUpsBySourceActivities: (activityIds: (number | string)[]) => Promise<TryCatchResult<Record<string, any>[]>>
  createFollowUp: (payload: Record<string, unknown>) => Promise<TryCatchResult<FollowUp>>
  updateFollowUp: (followUpId: number | string, payload: Record<string, unknown>) => Promise<TryCatchResult<FollowUp>>
}

/**
 * Composable for the follow_ups collection.
 *
 * A follow-up is created from an activity — its `sources` m2a links back to
 * the originating activity (`{ sources_collection: 'activities', sources_id }`).
 * The activity edit drawer surfaces a linked follow-up's `due_date` and
 * `assigned_user_id`; updates write back here.
 */
export function useFollowUps(): UseFollowUpsReturn {
  const crud = useDirectusCrud('follow_ups')

  /**
   * Fetch follow-ups whose `sources` m2a links them to any of the given
   * activities — the inverse of the `activities.source_follow_ups_id` link.
   * Lets the drawer surface a follow-up on the activity it was created from.
   */
  async function fetchFollowUpsBySourceActivities(
    activityIds: (number | string)[],
  ): Promise<TryCatchResult<Record<string, any>[]>> {
    if (!activityIds.length) {
      return { data: [], error: null }
    }
    // `sources` is a many-to-any relation, so the filter must scope the
    // polymorphic id to a collection: `sources_id:activities` then `id`.
    return await crud.fetchMany({
      fields: SOURCED_FOLLOW_UP_FIELDS,
      filter: {
        sources: {
          'sources_id:activities': {
            id: { _in: activityIds },
          },
        },
      },
      limit: -1,
    })
  }

  async function createFollowUp(payload: Record<string, unknown>): Promise<TryCatchResult<FollowUp>> {
    return await crud.createOne(payload)
  }

  async function updateFollowUp(
    followUpId: number | string,
    payload: Record<string, unknown>,
  ): Promise<TryCatchResult<FollowUp>> {
    return await crud.updateOne(followUpId, payload)
  }

  return { fetchFollowUpsBySourceActivities, createFollowUp, updateFollowUp }
}
