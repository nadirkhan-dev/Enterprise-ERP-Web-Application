<script setup lang="ts">
// Duplicate-check step when the entry exactly matches a stored record the
// backend won't allow a second copy of: an error banner, then the user's entry
// set against the existing record they're pointed to instead.
interface MatchSummary {
  title: string
  subtitle?: string
  phone?: string
  email?: string
}

interface Props {
  /** Record kind for the "Existing …" heading, e.g. "Contact" or "Address". */
  recordLabel: string
  entry: MatchSummary
  existing: MatchSummary
}

const props = defineProps<Props>()

const sections = computed(() => [
  {
    key: 'entry',
    heading: 'Your Entry',
    subheading: 'Data you entered — preserved throughout this review',
    summary: props.entry,
    isHighlighted: false,
  },
  {
    key: 'existing',
    heading: `Existing ${props.recordLabel}`,
    subheading: 'Data that is stored in the system',
    summary: props.existing,
    isHighlighted: true,
  },
])
</script>

<template>
  <div class="duplicate-blocked">
    <Message
      severity="error"
      icon="pi pi-exclamation-circle"
      :closable="false"
      class="duplicate-blocked__banner"
    >
      We found a matching record. Use it instead of creating a new one.
    </Message>

    <div
      v-for="section in sections"
      :key="section.key"
      class="duplicate-blocked__section"
    >
      <div class="duplicate-blocked__heading">
        <span class="duplicate-blocked__title">{{ section.heading }}</span>
        <span class="duplicate-blocked__subtitle">{{ section.subheading }}</span>
      </div>

      <div
        class="duplicate-blocked__card"
        :class="{ 'duplicate-blocked__card--highlighted': section.isHighlighted }"
      >
        <div class="duplicate-blocked__caption">
          <span class="duplicate-blocked__name">{{ section.summary.title }}</span>
          <span
            v-if="section.summary.subtitle"
            class="duplicate-blocked__meta"
          >{{ section.summary.subtitle }}</span>
        </div>
        <div
          v-if="section.summary.phone || section.summary.email"
          class="duplicate-blocked__details"
        >
          <div
            v-if="section.summary.phone"
            class="duplicate-blocked__detail-row"
          >
            <i class="pi pi-phone" />
            <span>{{ section.summary.phone }}</span>
          </div>
          <div
            v-if="section.summary.email"
            class="duplicate-blocked__detail-row"
          >
            <i class="pi pi-envelope" />
            <span class="duplicate-blocked__email">{{ section.summary.email }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.duplicate-blocked {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-5);
}

/* PrimeVue draws the Message border as an outline, which sits outside the box.
   As the first item in a drawer's scroll area its top edge gets clipped, so
   pull the outline inside the box. */
.duplicate-blocked__banner.p-message {
    outline-offset: calc(var(--p-message-border-width) * -1);
}

.duplicate-blocked__section {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.duplicate-blocked__heading {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
}

.duplicate-blocked__title {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

.duplicate-blocked__subtitle {
    font-size: var(--p-font-size-xs);
    color: var(--p-gray-800);
}

.duplicate-blocked__card {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    padding: var(--p-spacing-4-375);
    border: 1px solid var(--p-gray-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-surface-0);

    @media (min-width: 768px) {
        flex-direction: row;
        align-items: center;
        gap: var(--p-spacing-4);
    }
}

.duplicate-blocked__card--highlighted {
    padding: var(--p-spacing-4);
    border-color: var(--p-skyblue-600);
    background: var(--p-alpha-a8skyblue);
}

.duplicate-blocked__caption {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
}

.duplicate-blocked__name {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

.duplicate-blocked__card--highlighted .duplicate-blocked__name {
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

.duplicate-blocked__meta {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

.duplicate-blocked__details {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
}

.duplicate-blocked__detail-row {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
    min-width: 0;
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-800);
}

.duplicate-blocked__detail-row .pi {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-400);
}

.duplicate-blocked__email {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
