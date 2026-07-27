import type {ComputedRef, MaybeRefOrGetter, Ref} from 'vue';

/**
 * Rows-per-page options for the Looker-backed detail-page tables. The selected
 * value sets how many rows are visible; the table scrolls when the dataset is
 * larger. The full dataset is also reachable via the "View in Looker" link.
 */
export const TABLE_ROWS_PER_PAGE_OPTIONS = [3, 6, 9];

/** Default visible rows before the user changes it (intentionally not persisted). */
export const DEFAULT_TABLE_ROWS_PER_PAGE = 3;

/**
 * First-paint guess only. The rendered header/row heights are viewport-dependent
 * — the DataTable cell padding is a vw-based clamp — so the real heights are
 * measured live below and this is just used until the first measurement lands.
 */
const FALLBACK_ROW_HEIGHT = 52;

interface UseTableRowsPerPageOptions {
    /**
     * Initial rows-per-page. Defaults to DEFAULT_TABLE_ROWS_PER_PAGE.
     *
     * Extension point for a future dynamic default driven by result count
     * (e.g. large datasets → 9): pass the derived value here. The selection
     * stays local-only and is deliberately not persisted across navigation.
     */
    defaultRows?: number;
}

/**
 * Local, non-persisted rows-per-page state plus the derived DataTable scroll
 * sizing. The header and body row heights are measured from the live table
 * (they are viewport-dependent), so `rowsPerPage` maps to an exact N-row
 * viewport. PrimeVue's scroll viewport includes the sticky column header, so
 * the scroll height is `headerHeight + N × rowHeight`.
 *
 * @param tableRef  Ref to the PrimeVue DataTable component.
 * @param rowCount  The table's current (filtered) row count.
 */
export function useTableRowsPerPage(
    tableRef: Ref<any>,
    rowCount: MaybeRefOrGetter<number>,
    options: UseTableRowsPerPageOptions = {}
): {
    rowsPerPage: Ref<number>;
    rowsPerPageOptions: number[];
    scrollHeight: ComputedRef<string>;
    virtualScrollerOptions: ComputedRef<{itemSize: number} | undefined>;
} {
    const {defaultRows = DEFAULT_TABLE_ROWS_PER_PAGE} = options;
    const rowsPerPage = ref(defaultRows);

    // Live-measured heights — the scroll viewport spans the sticky header plus
    // the body rows, so both are needed to size an exact N-row viewport.
    const rowHeight = ref(FALLBACK_ROW_HEIGHT);
    const headerHeight = ref(FALLBACK_ROW_HEIGHT);

    function measureTableMetrics() {
        const el = tableRef.value?.$el;
        if (!el) {
            return;
        }
        const bodyRow = el.querySelector(
            '.p-datatable-tbody > tr'
        ) as HTMLElement | null;
        if (bodyRow?.offsetHeight) {
            rowHeight.value = bodyRow.offsetHeight;
        }
        const headerEl = el.querySelector(
            '.p-datatable-thead'
        ) as HTMLElement | null;
        if (headerEl?.offsetHeight) {
            headerHeight.value = headerEl.offsetHeight;
        }
    }

    onMounted(() => {
        nextTick(measureTableMetrics);
        // Cell padding is a vw-based clamp, so the heights shift on resize.
        window.addEventListener('resize', measureTableMetrics);
    });

    onUnmounted(() => {
        window.removeEventListener('resize', measureTableMetrics);
    });

    // Rows may not exist at mount (data loads async) — re-measure when they do.
    watch(
        () => toValue(rowCount),
        () => nextTick(measureTableMetrics)
    );

    const fitsWithoutScroll = computed(
        () => toValue(rowCount) <= rowsPerPage.value
    );
    const scrollHeight = computed(() =>
        fitsWithoutScroll.value
            ? 'auto'
            : `${headerHeight.value + rowsPerPage.value * rowHeight.value}px`
    );
    const virtualScrollerOptions = computed(() =>
        fitsWithoutScroll.value ? undefined : {itemSize: rowHeight.value}
    );

    return {
        rowsPerPage,
        rowsPerPageOptions: TABLE_ROWS_PER_PAGE_OPTIONS,
        scrollHeight,
        virtualScrollerOptions
    };
}
