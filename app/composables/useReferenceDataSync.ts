/* * * Subscribes to Directus WebSocket events for reference data collections * and feeds updates into the referenceData store via the worker pipeline. * * Usage: call `startSync()` after auth is confirmed, `stopSync()` on logout. * Designed to be called once from the default layout. * * Adding a new collection (e.g. `manufacturers`) * 1. Add the subscription to the `subscriptions` array below: * { collection: 'manufacturers', fields: ['id', 'name'], handler: handleManufacturerEvent } * 2. Implement the handler (similar to `handleCountryEvent`) that calls a * store action like `store.mergeManufacturerUpdates(...)`. * 3. Add the corresponding state, getters, and merge action to * `~/stores/referenceData.ts` following the countries pattern. * * Nested children (like regions under countries) need their own handler that * patches the parent collection — see `handleRegionEvent` below. */
import { useDirectus } from '~/composables/useDirectus'
import { useReferenceDataStore } from '~/stores/referenceData'
import type { CountryWithRegions } from '~/stores/referenceData'
import type { Region } from '~/types/directus'

type SubscriptionEvent = 'create' | 'update' | 'delete' | 'init' | 'error'
type UnsubscribeFn = () => void
type EventHandler = (
  store: ReturnType<typeof useReferenceDataStore>,
  event: SubscriptionEvent,
  data: any,
) => void

interface SubscriptionSpec {
  collection: string
  fields: string[]
  handler: EventHandler
}

let activeUnsubs: UnsubscribeFn[] = []
let syncActive = false

const subscriptions: SubscriptionSpec[] = [
  {
    collection: 'countries',
    fields: ['id', 'name', 'code', 'phone_code', 'status'],
    handler: handleCountryEvent,
  },
  {
    collection: 'regions',
    fields: ['id', 'name', 'code', 'countries_id'],
    handler: handleRegionEvent,
  },
]

export function useReferenceDataSync() {
  async function startSync(): Promise<void> {
    if (syncActive) return

    const directus = useDirectus()
    const store = useReferenceDataStore()

    await store.hydrate()
    syncActive = true

    try {
      await directus.connect()
    } catch (error) {
      console.error('[WS] Failed to connect:', (error as Error).message)
      syncActive = false
      return
    }

    // `connect()` can resolve while the internal state isn't yet fully open.
    if (!(await directus.isConnected())) {
      console.error('[WS] connect() resolved but socket is not open')
      syncActive = false
      return
    }

    // Subscribe sequentially — parallel subscribes race the internal
    // sendMessage queue in the SDK.
    for (const spec of subscriptions) {
      if (!syncActive) break
      await openSubscription(directus, store, spec)
    }
  }

  function stopSync(): void {
    syncActive = false
    for (const unsub of activeUnsubs) {
      unsub()
    }
    activeUnsubs = []
  }

  return { startSync, stopSync }
}

async function openSubscription(
  directus: ReturnType<typeof useDirectus>,
  store: ReturnType<typeof useReferenceDataStore>,
  spec: SubscriptionSpec,
): Promise<void> {
  try {
    // Call directly on `directus` — extracting the method into a variable
    // breaks the SDK's internal `this` binding and crashes `sendMessage`.
    const { subscription, unsubscribe } = await (directus as any).subscribe(
      spec.collection,
      { query: { fields: spec.fields } },
    )

    activeUnsubs.push(unsubscribe)
    consumeSubscription(spec.collection, subscription, store, spec.handler)
  } catch (error) {
    console.error(`[WS:${spec.collection}] subscribe failed:`, (error as Error).message)
  }
}

async function consumeSubscription(
  collection: string,
  subscription: AsyncGenerator<any, void, unknown>,
  store: ReturnType<typeof useReferenceDataStore>,
  handler: EventHandler,
): Promise<void> {
  try {
    for await (const message of subscription) {
      if (message.event === 'error') {
        console.error(`[WS:${collection}] event error:`, message.error)
        continue
      }
      if (message.event === 'init') {
        // Initial snapshot — already loaded via hydrate(), skip
        continue
      }
      handler(store, message.event, message.data)
    }
  } catch (error) {
    if (syncActive) {
      console.warn(`[WS:${collection}] subscription ended:`, (error as Error).message)
    }
  }
}

/**
 * Handle countries.* events → delegate to worker-backed merge.
 */
function handleCountryEvent(
  store: ReturnType<typeof useReferenceDataStore>,
  event: SubscriptionEvent,
  data: any,
): void {
  switch (event) {
    case 'create': {
      const additions: CountryWithRegions[] = (data as any[]).map((country) => ({
        ...country,
        regions: [],
      }))
      store.mergeCountryUpdates([], additions, [])
      return
    }
    case 'update':
      store.mergeCountryUpdates(data as Partial<CountryWithRegions>[], [], [])
      return
    case 'delete':
      store.mergeCountryUpdates([], [], data as number[])
  }
}

/**
 * Handle regions.* events → patch the nested `regions` array on the parent country.
 * Region merges aren't worker-backed because they operate on nested structure.
 */
function handleRegionEvent(
  store: ReturnType<typeof useReferenceDataStore>,
  event: SubscriptionEvent,
  data: any,
): void {
  switch (event) {
    case 'create':
      applyRegionAdditions(store, groupRegionsByCountry(data as Region[]))
      return
    case 'update':
      applyRegionUpdates(store, data as Partial<Region>[])
      return
    case 'delete':
      applyRegionRemovals(store, data as number[])
  }
}

// Region merge helpers (nested updates)

function groupRegionsByCountry(regions: Region[]): Map<number, Region[]> {
  const grouped = new Map<number, Region[]>()
  for (const region of regions) {
    const countryId = typeof region.countries_id === 'number'
      ? region.countries_id
      : (region.countries_id as any)?.id
    if (!countryId) continue
    const list = grouped.get(countryId) || []
    list.push(region)
    grouped.set(countryId, list)
  }
  return grouped
}

function applyRegionAdditions(
  store: ReturnType<typeof useReferenceDataStore>,
  regionsByCountry: Map<number, Region[]>,
): void {
  store.countries = store.countries.map((country) => {
    const newRegions = regionsByCountry.get(country.id)
    if (!newRegions) return country

    const existingIds = new Set(country.regions.map((r) => r.id))
    const toAdd = newRegions.filter((r) => !existingIds.has(r.id))
    if (toAdd.length === 0) return country

    return {
      ...country,
      regions: [...country.regions, ...toAdd].sort((a, b) => a.name.localeCompare(b.name)),
    }
  })
}

function applyRegionUpdates(
  store: ReturnType<typeof useReferenceDataStore>,
  updates: Partial<Region>[],
): void {
  const updateMap = new Map(updates.map((u) => [(u as any).id, u]))

  store.countries = store.countries.map((country) => {
    let changed = false
    const updatedRegions = country.regions.map((region) => {
      const patch = updateMap.get(region.id)
      if (patch) {
        changed = true
        return { ...region, ...patch }
      }
      return region
    })
    return changed ? { ...country, regions: updatedRegions } : country
  })
}

function applyRegionRemovals(
  store: ReturnType<typeof useReferenceDataStore>,
  regionIds: number[],
): void {
  const removalSet = new Set(regionIds)

  store.countries = store.countries.map((country) => {
    const filtered = country.regions.filter((r) => !removalSet.has(r.id))
    if (filtered.length === country.regions.length) return country
    return { ...country, regions: filtered }
  })
}
