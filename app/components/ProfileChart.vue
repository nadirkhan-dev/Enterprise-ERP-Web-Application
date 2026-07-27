<script setup lang="ts">
interface ChartBar {
  label: string
  bookedSales: number
  orderCount: number
}

const props = withDefaults(defineProps<{
  chartBars?: ChartBar[]
  lookerUrl?: string | null
  isChartLoading?: boolean
  bookedSalesLabel?: string
  orderCountLabel?: string
  // Which mode is shown first / selected by default. Defaults to bookedSales
  // (Customers / Suppliers). Item-style pages set 'orderCount' so Unit Sales
  // appears first and is the initial selection.
  primaryMode?: 'bookedSales' | 'orderCount'
  // Whether this card plots a chart at all. When true the chart chrome renders
  // even with nothing to plot (see isChartEmpty); a chart-less card passes false.
  hasChart?: boolean
}>(), {
  chartBars: () => [],
  lookerUrl: null,
  isChartLoading: false,
  bookedSalesLabel: 'Booked Sales',
  orderCountLabel: 'Order Count',
  primaryMode: 'bookedSales',
  hasChart: true,
})

// Nothing to plot: no history yet, or the data never arrived (e.g. a supplier
// whose SAP sync failed, so it has no SAP id to pull quarters for). The card
// already reserves the chart's height, so hiding the chart outright left a bare
// white slab — render the same chrome as a synced record with empty data instead.
const isChartEmpty = computed(() => !props.isChartLoading && !props.chartBars.length)

const SKELETON_HEIGHTS = [15, 45, 95, 55, 80, 25, 50, 35, 12]

// Trailing quarters the chart plots — mirrors TRAILING_QUARTERS and the
// `YYYY-Qn` label format in server/api/looker/*-quarterly-chart.get.ts.
const TRAILING_QUARTERS = 9

const chartMode = ref<'bookedSales' | 'orderCount'>(props.primaryMode)

const modeOrder = computed<('bookedSales' | 'orderCount')[]>(() =>
  props.primaryMode === 'orderCount'
    ? ['orderCount', 'bookedSales']
    : ['bookedSales', 'orderCount'],
)

// The x-axis an empty chart falls back to: the same trailing quarters the API
// would return, at zero, so the bars' labels are in place and real values simply
// replace them once the record syncs.
const placeholderBars = computed<ChartBar[]>(() => {
  const now = new Date()
  const currentQuarter = Math.ceil((now.getMonth() + 1) / 3)
  const currentYear = now.getFullYear()
  const bars: ChartBar[] = []
  for (let index = TRAILING_QUARTERS - 1; index >= 0; index--) {
    let quarter = currentQuarter - index
    let year = currentYear
    while (quarter <= 0) {
      quarter += 4
      year -= 1
    }
    bars.push({ label: `${year}-Q${quarter}`, bookedSales: 0, orderCount: 0 })
  }
  return bars
})

// What the plot actually draws — real quarters when they exist, the zeroed
// placeholder quarters when they don't.
const displayBars = computed(() => (isChartEmpty.value ? placeholderBars.value : props.chartBars))

const chartMaxValue = computed(() => {
  if (!props.chartBars.length) return 0
  const values = props.chartBars.map(bar =>
    chartMode.value === 'bookedSales' ? bar.bookedSales : bar.orderCount,
  )
  return Math.max(...values, 0)
})

const chartTicks = computed(() => {
  const max = chartMaxValue.value
  if (!max) return [0, 0, 0, 0]
  const step = niceStep(max / 3)
  return [0, step, step * 2, step * 3]
})

const reversedTicks = computed(() => [...chartTicks.value].reverse())
const widestTickLabel = computed(() => {
  let longest = ''
  for (const tick of reversedTicks.value) {
    const label = formatTick(tick)
    if (label.length > longest.length) {longest = label}
  }
  return longest
})

function niceStep(rough: number): number {
  if (rough <= 0) return 1
  const exponent = Math.floor(Math.log10(rough))
  const fraction = rough / 10 ** exponent
  let nice
  if (fraction <= 1) nice = 1
  else if (fraction <= 2) nice = 2
  else if (fraction <= 2.5) nice = 2.5
  else if (fraction <= 5) nice = 5
  else nice = 10
  return nice * 10 ** exponent
}

function formatTick(value: number): string {
  if (chartMode.value === 'orderCount') return value.toLocaleString()
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function getBarHeight(bar: ChartBar): string {
  const max = chartTicks.value[chartTicks.value.length - 1] || 0
  if (!max) return '0%'
  const value = chartMode.value === 'bookedSales' ? bar.bookedSales : bar.orderCount
  return `${(value / max) * 100}%`
}

const chartScrollRef = ref<HTMLElement | null>(null)
const isChartScrolled = ref(false)

function handleChartScroll() {
  const element = chartScrollRef.value
  if (!element) return
  isChartScrolled.value = element.scrollLeft > 0
}

/**
 * Scroll the bars container to its rightmost position so the most recent
 * quarter is visible on viewports too narrow to fit every bar. On wide
 * viewports the bars fit (width: 100% + justify-content: space-between)
 * and scrollWidth ≤ clientWidth, so this is a no-op.
 */
function scrollToLatest() {
  const element = chartScrollRef.value
  if (!element) return
  if (element.scrollWidth <= element.clientWidth) return
  element.scrollLeft = element.scrollWidth - element.clientWidth
}

// When data first arrives (or changes), jump to the latest bar after the
// next DOM tick so the bars are laid out and scrollWidth is accurate.
watch(
  () => [props.chartBars.length, props.isChartLoading],
  async () => {
    if (props.isChartLoading) return
    if (!props.chartBars.length) return
    await nextTick()
    scrollToLatest()
  },
  { immediate: true },
)

const hoveredBarIndex = ref<number | null>(null)
const tooltipX = ref(0)
const tooltipY = ref(0)

function handleBarMouseMove(event: MouseEvent, idx: number) {
  hoveredBarIndex.value = idx
  tooltipX.value = event.clientX
  tooltipY.value = event.clientY
}

function handleBarMouseLeave() {
  hoveredBarIndex.value = null
}

function formatTooltipValue(bar: ChartBar): string {
  if (chartMode.value === 'orderCount') return bar.orderCount.toLocaleString()
  return `$${bar.bookedSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
</script>

<template>
  <div
    v-if="hasChart || chartBars.length || isChartLoading"
    class="profile-chart"
    :class="`profile-chart--${chartMode}`"
    aria-hidden="true"
  >
    <a
      v-if="lookerUrl"
      :href="lookerUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="profile-chart__looker"
    >
      <span>Looker</span>
      <span class="profile-chart__looker-icon">
        <BaseLookerIcon />
      </span>
    </a>

    <div class="profile-chart__plot">
      <div
        class="profile-chart__yaxis"
        :class="{ 'is-scrolled': isChartScrolled, 'is-loading': isChartLoading }"
      >
        <span
          v-if="!isChartLoading"
          class="profile-chart__yaxis-sizer"
          aria-hidden="true"
        >{{ widestTickLabel }}</span>
        <template v-if="isChartLoading">
          <span
            v-for="i in 4"
            :key="`tick-skeleton-${i}`"
            class="profile-chart__tick profile-chart__tick--skeleton"
            :style="{ top: `calc(${i - 1} / 3 * (100% - var(--p-spacing-5)))` }"
          />
        </template>
        <template v-else>
          <span
            v-for="(tick, idx) in reversedTicks"
            :key="`tick-${idx}`"
            class="profile-chart__tick"
            :style="{ top: `calc(${idx} / ${reversedTicks.length - 1} * (100% - var(--p-spacing-5)))` }"
          >{{ formatTick(tick) }}</span>
        </template>
      </div>

      <div class="profile-chart__canvas">
        <div
          v-if="displayBars.length"
          class="profile-chart__gridlines"
        >
          <span
            v-for="(tick, idx) in [...chartTicks].reverse()"
            :key="`gridline-${idx}`"
            class="profile-chart__gridline"
          />
        </div>

        <div
          ref="chartScrollRef"
          class="profile-chart__bars-scroll"
          @scroll.passive="handleChartScroll"
        >
          <div class="profile-chart__bars">
            <template v-if="isChartLoading">
              <div
                v-for="i in SKELETON_HEIGHTS.length"
                :key="`skeleton-${i}`"
                class="profile-chart__bar-wrapper"
              >
                <div class="profile-chart__bar-track">
                  <div class="profile-chart__bar profile-chart__bar--skeleton" />
                </div>
                <span class="profile-chart__bar-label profile-chart__bar-label--skeleton" />
              </div>
            </template>
            <template v-else>
              <div
                v-for="(bar, idx) in displayBars"
                :key="bar.label"
                class="profile-chart__bar-wrapper"
              >
                <div class="profile-chart__bar-track">
                  <div
                    class="profile-chart__bar"
                    :style="{ height: getBarHeight(bar) }"
                    @mousemove="handleBarMouseMove($event, idx)"
                    @mouseleave="handleBarMouseLeave"
                  />
                </div>
                <span class="profile-chart__bar-label">{{ bar.label }}</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div class="profile-chart__toggle">
      <label
        v-for="mode in modeOrder"
        :key="mode"
        :class="['profile-chart__radio', `profile-chart__radio--${mode}`]"
      >
        <RadioButton
          v-model="chartMode"
          name="chartMode"
          :value="mode"
        />
        <span>{{ mode === 'bookedSales' ? bookedSalesLabel : orderCountLabel }}</span>
      </label>
    </div>

    <Teleport to="body">
      <div
        v-if="hoveredBarIndex !== null && chartBars[hoveredBarIndex]"
        class="profile-chart__tooltip"
        :class="`profile-chart__tooltip--${chartMode}`"
        :style="{ top: `${tooltipY}px`, left: `${tooltipX}px` }"
      >
        <div class="profile-chart__tooltip-row">
          <span class="profile-chart__tooltip-label">Quarter</span>
          <span class="profile-chart__tooltip-value">{{ chartBars[hoveredBarIndex].label }}</span>
        </div>
        <div class="profile-chart__tooltip-row">
          <span class="profile-chart__tooltip-label">{{ chartMode === 'bookedSales' ? bookedSalesLabel : orderCountLabel }}</span>
          <span class="profile-chart__tooltip-value">{{ formatTooltipValue(chartBars[hoveredBarIndex]) }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.profile-chart {
    --chart-plot-height: 140px;
    --chart-bar-gap: var(--p-spacing-1);
    --chart-yaxis-width: 70px;

    position: absolute;
    inset: calc(var(--p-spacing-12) + var(--p-spacing-3) + var(--p-spacing-2)) var(--p-spacing-2) var(--p-spacing-5);
    display: flex;
    flex-direction: column;
    pointer-events: none;
    user-select: none;
    z-index: 0;

    @media (min-width: 768px) {
        --chart-plot-height: 170px;
        --chart-bar-gap: var(--p-spacing-3);
        inset: var(--p-spacing-12) var(--p-spacing-3) var(--p-spacing-3);
    }
}

.profile-chart__looker {
    position: absolute;
    top: var(--p-spacing-6);
    right: var(--p-spacing-2);
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-1);
    padding-left: var(--p-spacing-2);
    color: var(--p-primary-500);
    background: var(--p-surface-0);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-medium);
    text-decoration: none;
    pointer-events: auto;
    z-index: 2;
    transform: translateY(-50%);
}

.profile-chart__looker span {
    color: var(--p-deepblue-900);
}

.profile-chart__looker-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* 20px hit area matching the copy / globe icon buttons (BaseIconButton). */
    width: var(--p-spacing-5);
    height: var(--p-spacing-5);
    border-radius: var(--p-border-radius-xs);
    transition: background var(--p-transition-duration-fast) var(--p-transition-timing-ease-out);
}

.profile-chart__looker:hover .profile-chart__looker-icon {
    background: var(--p-tideblue-50);
}

.profile-chart__plot {
    position: relative;
    flex: 1;
    display: flex;
    align-items: stretch;
    margin-top: var(--p-spacing-6);
    min-height: var(--chart-plot-height);
}

.profile-chart__yaxis {
    width: max-content;
    flex-shrink: 0;
    background: var(--p-surface-0);
    position: relative;
    z-index: 2;
    transition: box-shadow var(--p-transition-duration-fast) var(--p-transition-timing-ease-out);
}
.profile-chart__yaxis.is-loading {
    min-width: var(--chart-yaxis-width);
}

.profile-chart__yaxis-sizer {
    display: block;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    white-space: nowrap;
    font-size: var(--p-font-size-xs);
    padding-left: var(--p-spacing-1);
    padding-right: var(--p-spacing-2);
}

.profile-chart__yaxis.is-scrolled::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 100%;
    width: var(--p-spacing-2);
    pointer-events: none;
    background: linear-gradient(
        to right,
        rgba(0, 0, 0, var(--p-opacity-10)),
        rgba(0, 0, 0, 0)
    );
}

.profile-chart__tick {
    position: absolute;
    left: var(--p-spacing-1);
    right: var(--p-spacing-2);
    font-size: var(--p-font-size-xs);
    color: var(--p-gray-600);
    text-align: left;
    line-height: 1;
    transform: translateY(-50%);
}

.profile-chart--orderCount .profile-chart__tick {
    text-align: right;
}

.profile-chart__canvas {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
    padding-right: var(--p-spacing-2);
}

.profile-chart__gridlines {
    position: absolute;
    inset: 0 var(--p-spacing-2) var(--p-spacing-5) 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    pointer-events: none;
}


.profile-chart__gridline {
    display: block;
    height: 1px;
    background: var(--p-surface-100);
    width: 100%;
}

.profile-chart__bars-scroll {
    position: relative;
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    pointer-events: auto;
    -webkit-overflow-scrolling: touch;

    @media (min-width: 768px) {
        overflow: visible;
    }
}

.profile-chart__bars-scroll::-webkit-scrollbar {
    display: none;
}

.profile-chart__bars {
    display: flex;
    align-items: flex-end;
    gap: var(--chart-bar-gap);
    height: 100%;
    width: max-content;

    @media (min-width: 768px) {
        width: 100%;
        justify-content: space-between;
    }
}

.profile-chart__bar-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--p-spacing-2);
    height: 100%;
    width: calc((100cqi - var(--chart-bar-gap) * 3) / 4);
    flex-shrink: 0;

    @media (min-width: 768px) {
        flex: 1;
        width: auto;
        min-width: 0;
    }
}

.profile-chart__bar-track {
    position: relative;
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
}

.profile-chart__bar {
    width: 100%;
    border-radius: var(--p-border-radius-xs) var(--p-border-radius-xs) 0 0;
    transition:
        height var(--p-transition-duration-normal) var(--p-transition-timing-ease-out),
        background var(--p-transition-duration-fast) var(--p-transition-timing-ease-out),
        border-color var(--p-transition-duration-fast) var(--p-transition-timing-ease-out);
    min-height: 1px;
}

.profile-chart--bookedSales .profile-chart__bar:not(.profile-chart__bar--skeleton) {
    background: color-mix(in srgb, var(--p-vividgreen-500) 10%, var(--p-surface-0));
    border-top: 1px solid color-mix(in srgb, var(--p-vividgreen-500) 10%, var(--p-surface-0));
    border-right: 1px solid color-mix(in srgb, var(--p-vividgreen-500) 10%, var(--p-surface-0));
    border-left: 1px solid color-mix(in srgb, var(--p-vividgreen-500) 10%, var(--p-surface-0));
}

.profile-chart--orderCount .profile-chart__bar:not(.profile-chart__bar--skeleton) {
    background: color-mix(in srgb, var(--p-skyblue-600) 10%, var(--p-surface-0));
    border-top: 1px solid color-mix(in srgb, var(--p-skyblue-600) 10%, var(--p-surface-0));
    border-right: 1px solid color-mix(in srgb, var(--p-skyblue-600) 10%, var(--p-surface-0));
    border-left: 1px solid color-mix(in srgb, var(--p-skyblue-600) 10%, var(--p-surface-0));
}

.profile-chart__bar--skeleton {
    border: none;
    border-radius: var(--p-border-radius-xs) var(--p-border-radius-xs) 0 0;
    height: 15%;
    background-color: var(--p-undertow-base);
    animation: chart-skeleton-sine calc(var(--p-undertow-stagger) * 9) linear infinite;
}

.profile-chart__bar-label--skeleton {
    width: 100%;
    height: var(--p-font-size-sm);
    border-radius: var(--p-border-radius-xs);
    animation: skeleton-pulse var(--p-undertow-duration) ease-in-out infinite;
}

.profile-chart__tick--skeleton {
    width: calc(90% - var(--p-spacing-2));
    height: var(--p-font-size-sm);
    border-radius: var(--p-border-radius-xs);
    animation: skeleton-pulse var(--p-undertow-duration) ease-in-out infinite;
}

@keyframes chart-skeleton-sine {
    0%, 100% { height: 15%; }
    50% { height: 95%; }
}

.profile-chart__bar-wrapper:nth-child(1) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * 0); }
.profile-chart__bar-wrapper:nth-child(2) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * -1); }
.profile-chart__bar-wrapper:nth-child(3) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * -2); }
.profile-chart__bar-wrapper:nth-child(4) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * -3); }
.profile-chart__bar-wrapper:nth-child(5) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * -4); }
.profile-chart__bar-wrapper:nth-child(6) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * -5); }
.profile-chart__bar-wrapper:nth-child(7) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * -6); }
.profile-chart__bar-wrapper:nth-child(8) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * -7); }
.profile-chart__bar-wrapper:nth-child(9) .profile-chart__bar--skeleton { animation-delay: calc(var(--p-undertow-stagger) * -8); }

.profile-chart__bar-label {
    font-size: var(--p-font-size-xs);
    color: var(--p-gray-800);
    line-height: 1;
    white-space: nowrap;
    transform: scale(0.75);
    transform-origin: top center;

    @media (min-width: 768px) {
        transform: none;
    }
}

.profile-chart__toggle {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: var(--p-spacing-4);
    margin-top: var(--p-spacing-4);
    margin-bottom: var(--p-spacing-1);
    pointer-events: auto;

    @media (min-width: 768px) {
        margin-bottom: var(--p-spacing-2);
    }
}

.profile-chart__radio {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-2);
    font-size: var(--p-font-size-xs);
    line-height: 1;
    color: var(--p-gray-800);
    cursor: pointer;

    @media (min-width: 768px) {
        font-size: var(--p-font-size-sm);
    }
}

.profile-chart__radio span {
    display: inline-flex;
    align-items: center;
    line-height: 1;
}

.profile-chart__radio--bookedSales {
    --p-radiobutton-checked-background: var(--p-vividgreen-500);
    --p-radiobutton-checked-border-color: var(--p-vividgreen-500);
    --p-radiobutton-checked-hover-background: var(--p-vividgreen-500);
    --p-radiobutton-checked-hover-border-color: var(--p-vividgreen-500);
    --p-radiobutton-hover-border-color: var(--p-vividgreen-500);
    --p-radiobutton-icon-checked-color: var(--p-surface-0);
    --p-radiobutton-icon-checked-hover-color: var(--p-surface-0);
}

.profile-chart__radio--orderCount {
    --p-radiobutton-checked-background: var(--p-skyblue-600);
    --p-radiobutton-checked-border-color: var(--p-skyblue-600);
    --p-radiobutton-checked-hover-background: var(--p-skyblue-600);
    --p-radiobutton-checked-hover-border-color: var(--p-skyblue-600);
    --p-radiobutton-hover-border-color: var(--p-skyblue-600);
    --p-radiobutton-icon-checked-color: var(--p-surface-0);
    --p-radiobutton-icon-checked-hover-color: var(--p-surface-0);
}

.profile-chart__tooltip {
    position: fixed;
    transform: translate(-50%, calc(-100% - var(--p-spacing-3)));
    padding: var(--p-spacing-3);
    border-radius: var(--p-border-radius-sm);
    box-shadow: var(--p-shadow-md);
    white-space: nowrap;
    z-index: 9999;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
}

.profile-chart__tooltip::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border-left: var(--p-spacing-2) solid transparent;
    border-right: var(--p-spacing-2) solid transparent;
    border-top-style: solid;
    border-top-width: var(--p-spacing-2);
}

.profile-chart__tooltip--bookedSales {
    background: var(--p-mildgreen-50);
}

.profile-chart__tooltip--bookedSales::after {
    border-top-color: var(--p-mildgreen-50);
}

.profile-chart__tooltip--orderCount {
    background: var(--p-skyblue-50);
}

.profile-chart__tooltip--orderCount::after {
    border-top-color: var(--p-skyblue-50);
}

.profile-chart__tooltip-row {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
}

.profile-chart__tooltip-label {
    font-size: var(--p-font-size-xs);
    color: var(--p-deepblue-900);
    line-height: 1;
}

.profile-chart__tooltip-value {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: 1;
}
</style>
