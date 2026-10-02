import { readItems } from '@directus/sdk'
import { useDirectus } from '~/composables/useDirectus'
import { createWorkerClient, type WorkerClient } from '~/utils/workerClient'
import type { Country, Region } from '~/types/directus'
import type { NormalizePayload, MergePayload } from '~/types/worker'

// Cast to bypass generic schema constraints (same pattern as useDirectusCrud)
const _readItems = readItems as any

export interface CountryWithRegions extends Omit<Country, 'regions'> {
  regions: Region[]
}

interface ReferenceDataState {
  countries: CountryWithRegions[]
  hydrated: boolean
  loading: boolean
}

let workerClient: WorkerClient | null = null

function getWorkerClient(): WorkerClient {
  if (!workerClient) {
    const worker = new Worker(
      new URL('~/workers/referenceData.worker.ts', import.meta.url),
      { type: 'module' },
    )
    workerClient = createWorkerClient(worker)
  }
  return workerClient
}

function terminateWorker(): void {
  if (workerClient) {
    workerClient.terminate()
    workerClient = null
  }
}

export const useReferenceDataStore = defineStore('referenceData', {
  state: (): ReferenceDataState => ({
    countries: [],
    hydrated: false,
    loading: false,
  }),

  getters: {
    /**
     * All countries sorted by name (without regions payload).
     */
    countryOptions(state): Pick<Country, 'id' | 'name' | 'code' | 'phone_code' | 'status'>[] {
      return state.countries.map(({ id, name, code, phone_code, status }) => ({
        id,
        name,
        code,
        phone_code,
        status,
      }))
    },

    /**
     * Countries active in SupplyHub — the set offered for address selection.
     * (`countryOptions` stays unfiltered so lookups by id/code still resolve
     * an address saved against a country later deactivated.)
     */
    activeCountryOptions(state): Pick<Country, 'id' | 'name' | 'code' | 'phone_code' | 'status'>[] {
      return state.countries
        .filter((country) => country.status === 'active')
        .map(({ id, name, code, phone_code, status }) => ({
          id,
          name,
          code,
          phone_code,
          status,
        }))
    },

    /**
     * Returns a function to get regions for a specific country.
     * Usage: `store.getRegionsByCountry(countryId)`
     */
    getRegionsByCountry(state) {
      return (countryId: number): Region[] => {
        const country = state.countries.find((c) => c.id === countryId)
        return country?.regions ?? []
      }
    },

    /**
     * Lookup a single country by ID.
     */
    getCountryById(state) {
      return (countryId: number): CountryWithRegions | undefined => {
        return state.countries.find((c) => c.id === countryId)
      }
    },
  },

  actions: {
    /**
     * Hydrate the store — fetches fresh data from the API into the
     * in-memory Pinia store. WebSocket sync keeps it live after that.
     * Store state is purely in-memory (no persistence); refresh = refetch.
     */
    async hydrate(): Promise<void> {
      if (this.hydrated) return

      const freshLoaded = await this.fetchCountriesWithRegions()
      this.hydrated = true

      if (!freshLoaded) {
        console.warn('Reference data: initial API fetch failed')
      }
    },

    /**
     * Fetch countries + nested regions in a single API call,
     * send to worker for normalization, then commit to store.
     *
     * @returns true if fresh data was loaded successfully
     */
    async fetchCountriesWithRegions(): Promise<boolean> {
      this.loading = true

      const { data: rawCountries, error } = await tryCatch(
        useDirectus().request(
          _readItems('countries', {
            fields: [
              'id',
              'name',
              'code',
              'phone_code',
              'status',
              'regions.id',
              'regions.code',
              'regions.name',
              'regions.countries_id',
            ],
            sort: ['name'],
            limit: -1,
            deep: {
              regions: { _sort: ['name'] },
            },
          }),
        ),
      )

      this.loading = false

      if (error) {
        console.error('Failed to fetch countries with regions:', error.message)
        return false
      }

      const client = getWorkerClient()
      const normalized = await client.send<CountryWithRegions[], NormalizePayload<unknown>>(
        'countries',
        'normalize',
        { rawData: rawCountries as unknown[] },
      )

      this.countries = normalized
      return true
    },

    /**
     * Apply incremental updates from WebSocket events.
     * Merges patches, additions, and removals via the worker.
     */
    async mergeCountryUpdates(
      updates: Partial<CountryWithRegions>[] = [],
      additions: CountryWithRegions[] = [],
      removals: number[] = [],
    ): Promise<void> {
      const client = getWorkerClient()
      const merged = await client.send<CountryWithRegions[], MergePayload<CountryWithRegions>>(
        'countries',
        'merge',
        {
          currentData: this.countries,
          updates,
          additions,
          removals,
        },
      )

      this.countries = merged
    },

    /**
     * Force a refetch from API.
     */
    async invalidateCountries(): Promise<void> {
      this.hydrated = false
      await this.fetchCountriesWithRegions()
      this.hydrated = true
    },

    /**
     * Reset store state — call on logout.
     */
    $resetReferenceData(): void {
      this.countries = []
      this.hydrated = false
      this.loading = false
      terminateWorker()
    },
  },
})
