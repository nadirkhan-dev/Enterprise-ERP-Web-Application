import type { Ref } from 'vue'

const ACTIVITIES_PAGE_SIZE = 20

/**
 * Activity list + pagination for a business-partner detail page (customers and
 * suppliers share the same Activities UX). Wraps the shared `useActivities` /
 * `useActivityGroups` services and the `mapCustomerActivities` mapper so a detail
 * page only has to wire `SectionActivities` props + events.
 *
 * Keyed on a reactive `partnerId` so the loaders always target the current
 * record. The Account Manager / follow-up-date default lives in the activity
 * drawer (driven by the `account-manager-id` prop) and is unaffected here.
 */
export function useBusinessPartnerActivities(partnerId: Ref<number | string | null>) {
  const { fetchActivities, fetchActivityCount } = useActivities()
  const { fetchActivityGroups } = useActivityGroups()

  const activities = ref<Record<string, any>[]>([])
  const activityGroups = ref<Record<string, any>[]>([])
  const activityCount = ref(0)
  const isActivitiesLoading = ref(false)
  const isActivitiesLoadingMore = ref(false)
  const currentPage = ref(1)
  const allLoaded = ref(false)

  const hasMoreActivities = computed(() => {
    if (allLoaded.value) { return false }
    if (activityCount.value > 0) {
      return activities.value.length < activityCount.value
    }
    return activities.value.length > 0 && activities.value.length % ACTIVITIES_PAGE_SIZE === 0
  })

  async function loadActivities() {
    if (partnerId.value === null) { return }
    isActivitiesLoading.value = true
    currentPage.value = 1
    allLoaded.value = false

    const [listResult, countResult] = await Promise.all([
      fetchActivities(partnerId.value, { page: 1, limit: ACTIVITIES_PAGE_SIZE }),
      fetchActivityCount(partnerId.value),
    ])

    if (listResult.error) {
      console.error('Failed to load activities:', listResult.error.message)
      activities.value = []
      allLoaded.value = true
      isActivitiesLoading.value = false
      return
    }

    activities.value = mapCustomerActivities(listResult.data)
    if (listResult.data.length < ACTIVITIES_PAGE_SIZE) {
      allLoaded.value = true
    }
    if (countResult && !countResult.error) {
      activityCount.value = countResult.data
    }
    isActivitiesLoading.value = false
  }

  async function loadMoreActivities() {
    if (
      partnerId.value === null
      || !hasMoreActivities.value
      || isActivitiesLoadingMore.value
      || isActivitiesLoading.value
    ) {
      return
    }

    isActivitiesLoadingMore.value = true
    const nextPage = currentPage.value + 1
    const { data, error } = await fetchActivities(partnerId.value, {
      page: nextPage,
      limit: ACTIVITIES_PAGE_SIZE,
    })

    if (!error && data) {
      activities.value = [...activities.value, ...mapCustomerActivities(data)]
      currentPage.value = nextPage
      if (data.length < ACTIVITIES_PAGE_SIZE) {
        allLoaded.value = true
      }
    }
    isActivitiesLoadingMore.value = false
  }

  async function loadAllActivities() {
    if (
      partnerId.value === null
      || allLoaded.value
      || isActivitiesLoading.value
      || isActivitiesLoadingMore.value
    ) {
      return
    }

    isActivitiesLoadingMore.value = true
    const { data, error } = await fetchActivities(partnerId.value, { limit: -1 })

    if (!error && data) {
      activities.value = mapCustomerActivities(data)
      activityCount.value = data.length
      allLoaded.value = true
    }
    isActivitiesLoadingMore.value = false
  }

  async function loadActivityGroups() {
    if (activityGroups.value.length) { return }
    const { data, error } = await fetchActivityGroups()
    if (error) {
      console.error('Failed to load activity groups:', error.message)
      return
    }
    activityGroups.value = data ?? []
  }

  function reloadActivities() {
    if (partnerId.value === null) { return }
    if (allLoaded.value && activityCount.value > ACTIVITIES_PAGE_SIZE) {
      allLoaded.value = false
      loadAllActivities()
    } else {
      loadActivities()
    }
  }

  return {
    activities,
    activityGroups,
    activityCount,
    isActivitiesLoading,
    isActivitiesLoadingMore,
    hasMoreActivities,
    loadActivities,
    loadMoreActivities,
    loadAllActivities,
    loadActivityGroups,
    reloadActivities,
  }
}
