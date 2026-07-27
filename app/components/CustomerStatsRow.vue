<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    customer: Record<string, any>
    isLoading: boolean
    // Looker deep-links per key figure. Lifetime figures open the report scoped to
    // every quote/order (Open + Closed); Open figures scope it to Open only, so the
    // report matches the exact figure the user clicked.
    quotesLifetimeLookerUrl?: string | null
    quotesOpenLookerUrl?: string | null
    ordersLifetimeLookerUrl?: string | null
    ordersOpenLookerUrl?: string | null
  }>(),
  {
    quotesLifetimeLookerUrl: null,
    quotesOpenLookerUrl: null,
    ordersLifetimeLookerUrl: null,
    ordersOpenLookerUrl: null,
  },
)

interface StatItem {
  label: string
  value: string | number
  lookerUrl?: string | null
  valueClass?: string
  icon?: string | null
}

const statsCards = computed<{ items: StatItem[] }[]>(() => [
  {
    items: [
      { label: 'Lifetime Quote Count', value: props.customer.lifetimeQuoteCount.toLocaleString(), lookerUrl: props.quotesLifetimeLookerUrl },
      { label: 'Lifetime Quote Dollars', value: props.customer.lifetimeQuoteDollars, lookerUrl: props.quotesLifetimeLookerUrl },
      { label: 'Open Quote Count', value: props.customer.openQuoteCount.toLocaleString(), lookerUrl: props.quotesOpenLookerUrl },
      { label: 'Open Quote Dollars', value: props.customer.openQuoteDollars, lookerUrl: props.quotesOpenLookerUrl },
    ],
  },
  {
    items: [
      { label: 'Lifetime Order Count', value: props.customer.lifetimeOrderCount.toLocaleString(), lookerUrl: props.ordersLifetimeLookerUrl },
      { label: 'Lifetime Order Dollars', value: props.customer.lifetimeOrderDollars, lookerUrl: props.ordersLifetimeLookerUrl },
      { label: 'Open Order Count', value: props.customer.openOrderCount.toLocaleString(), lookerUrl: props.ordersOpenLookerUrl },
      { label: 'Open Order Dollars', value: props.customer.openOrderDollars, lookerUrl: props.ordersOpenLookerUrl },
    ],
  },
  {
    items: [
      { label: 'Account Balance', value: props.customer.accountBalance },
      { label: 'Payment Terms', value: props.customer.paymentTerms },
      { label: 'Credit Limit', value: props.customer.creditLimit },
      {
        label: 'Account Standing',
        value: ['Good', 'Bad'].includes(props.customer.accountStanding) ? props.customer.accountStanding : '—',
        valueClass:
          props.customer.accountStanding === 'Good'
            ? 'standing-good'
            : props.customer.accountStanding === 'Bad'
              ? 'standing-bad'
              : '',
        icon:
          props.customer.accountStanding === 'Good'
            ? 'pi pi-check-circle'
            : props.customer.accountStanding === 'Bad'
              ? 'pi pi-times'
              : null,
      },
    ],
  },
])
</script>

<template>
  <div class="stats-row">
    <div
      v-for="(card, cardIndex) in statsCards"
      :key="cardIndex"
      class="stats-card"
    >
      <div class="stats-grid">
        <div
          v-for="stat in card.items"
          :key="stat.label"
          class="stat"
        >
          <span class="stat-label">{{ stat.label }}</span>
          <span
            v-if="isLoading"
            class="skeleton-block skeleton-line skeleton-line--value"
          />
          <div
            v-else
            class="stat-value-row"
          >
            <span :class="['stat-value', stat.valueClass]">
              <i
                v-if="stat.icon"
                :class="stat.icon"
              />{{ stat.value }}</span>
            <BaseLookerLink
              v-if="stat.lookerUrl"
              :url="stat.lookerUrl"
              icon-only
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
:deep(.skeleton-line) {
    display: inline-block;
    height: var(--p-font-size-sm);
    border-radius: 0;
}

:deep(.skeleton-line--value) {
    width: 60%;
    min-width: var(--p-spacing-10);
    height: var(--p-font-size-sm);
    animation: skeleton-pulse var(--p-undertow-duration) ease-in-out infinite;
}

.stats-row {
    display: grid;
    gap: var(--p-spacing-3);

    @media (min-width: 1024px) {
        display: flex;
        gap: var(--p-spacing-4);
    }
}

.stats-card {
    flex: 1;
    background: var(--p-surface-0);
    border-radius: var(--p-border-radius-xs);
    box-shadow: var(--p-shadow-sm);
    padding: clamp(var(--p-spacing-4), 2vw, var(--p-spacing-6));
}

.stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--p-spacing-3);

    @media (min-width: 768px) {
        gap: var(--p-spacing-4) var(--p-spacing-4);
    }
}

.stat {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    gap: var(--p-spacing-2);
}

/* Value + Looker deep-link icon on one line. */
.stat-value-row {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
}

.stat-label {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

.stat-value {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    line-height: 1;
}

.stat-value.standing-good,
.stat-value.standing-bad {
    font-family: var(--p-font-family);
    font-size: var(--p-font-size-base);
    font-style: normal;
    font-weight: var(--p-font-weight-bold);
    line-height: 1;
    letter-spacing: 0;
    font-feature-settings: 'liga' off, 'clig' off;
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.stat-value.standing-good {
    color: var(--p-vividgreen-500);
}

.stat-value.standing-bad {
    color: var(--p-red-500);
}

.stat-value.standing-good .pi,
.stat-value.standing-bad .pi {
    width: var(--p-spacing-3);
    height: var(--p-spacing-3);
    font-size: var(--p-font-size-xs);
}
</style>
