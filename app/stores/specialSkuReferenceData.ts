import {defineStore} from 'pinia';
import type {TryCatchResult} from '~/types/api';

export interface SpecialSkuReferenceOption {
    label: string;
    value: number;
    sapId: number;
}

interface SpecialSkuReferenceDataResponse {
    manufacturers: SpecialSkuReferenceOption[];
    itemGroups: SpecialSkuReferenceOption[];
}

interface SpecialSkuReferenceDataState {
    manufacturers: SpecialSkuReferenceOption[];
    itemGroups: SpecialSkuReferenceOption[];
    hydrated: boolean;
    loading: boolean;
    syncing: boolean;
    error: string | null;
}

export const useSpecialSkuReferenceDataStore = defineStore('specialSkuReferenceData', {
    state: (): SpecialSkuReferenceDataState => ({
        manufacturers: [],
        itemGroups: [],
        hydrated: false,
        loading: false,
        syncing: false,
        error: null
    }),

    actions: {
        /**
         * Load the Special-SKU picker reference data (manufacturers + item groups)
         * into the global (persisted) store. Sourced from SupplyHub/Directus — the
         * option values are SAP ids, but the lists themselves come from Directus.
         * Fetched at most once per session — preloaded on app mount — and served
         * from cache thereafter, so opening the Special-SKU drawer/card never
         * re-hits the API. Pass `force` (via `refresh`) to re-sync on demand.
         */
        async hydrate(
            force = false
        ): Promise<TryCatchResult<SpecialSkuReferenceDataResponse>> {
            const hasCache = this.hydrated && this.manufacturers.length > 0;

            // Already loaded → serve from cache, no API call. Freshness is a
            // manual "Refresh Sync" action, not a per-open background sync.
            if (!force && hasCache) {
                return {
                    data: {
                        manufacturers: this.manufacturers,
                        itemGroups: this.itemGroups
                    },
                    error: null
                };
            }

            // A load is already in flight (e.g. the app-mount preload racing an
            // immediate drawer open) — don't fire a duplicate. Reactive consumers
            // pick up the result when it lands.
            if (!force && (this.loading || this.syncing)) {
                return {
                    data: {
                        manufacturers: this.manufacturers,
                        itemGroups: this.itemGroups
                    },
                    error: null
                };
            }

            // A forced refresh over existing data keeps the pickers populated
            // (syncing); a first load with nothing to show blocks them (loading).
            if (force && hasCache) {
                this.syncing = true;
            } else {
                this.loading = true;
            }
            this.error = null;

            const {data, error} = await tryCatch(
                $fetch<SpecialSkuReferenceDataResponse>('/api/special-sku/reference-data')
            );

            this.loading = false;
            this.syncing = false;

            if (error) {
                this.error =
                    error.message || 'Failed to load Special-SKU reference data.';
                return {data: null, error};
            }

            const nextManufacturers = data?.manufacturers || [];
            const nextItemGroups = data?.itemGroups || [];

            // Don't let a transient empty response wipe already-good cached data.
            if (
                hasCache &&
                nextManufacturers.length === 0 &&
                nextItemGroups.length === 0
            ) {
                this.error = null;
                return {
                    data: {
                        manufacturers: this.manufacturers,
                        itemGroups: this.itemGroups
                    },
                    error: null
                };
            }

            this.manufacturers = nextManufacturers;
            this.itemGroups = nextItemGroups;
            this.hydrated = true;
            this.error = null;

            return {
                data: {
                    manufacturers: this.manufacturers,
                    itemGroups: this.itemGroups
                },
                error: null
            };
        },

        async refresh(): Promise<TryCatchResult<SpecialSkuReferenceDataResponse>> {
            return await this.hydrate(true);
        },

        $resetSpecialSkuReferenceData(): void {
            this.manufacturers = [];
            this.itemGroups = [];
            this.hydrated = false;
            this.loading = false;
            this.syncing = false;
            this.error = null;
        }
    },

    // sessionStorage (not localStorage): the Special-SKU reference cache lives for
    // the browser session only — it re-hydrates fresh on the next login / tab-open
    // rather than persisting stale manufacturers/item groups across sessions.
    persist: {
        storage: piniaPluginPersistedstate.sessionStorage(),
        pick: ['manufacturers', 'itemGroups', 'hydrated']
    }
});
