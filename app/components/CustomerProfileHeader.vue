<script setup lang="ts">
const props = defineProps<{
  customer: Record<string, any>
  tabs: { label: string, icon: string, sectionId: string }[]
  chartBars: { label: string, bookedSales: number, orderCount: number }[]
  lookerUrl: string | null
  isChartLoading: boolean
  logoSrc: string | null
  logoSrcset: string | null
  isLogoProcessing: boolean
  // True for a new customer whose SAP id hasn't synced back yet — show a spinner
  // in place of the (not-yet-available) SAP account number + copy button.
  awaitingSapId?: boolean
  // True when the Service Master reported the SAP sync failed — show a failed
  // indicator + Retry Sync instead of the spinner.
  sapSyncFailed?: boolean
  // The reason for the failed/unconfirmed sync — shown in the failed indicator's
  // tooltip so the cause stays visible after the toast dismisses.
  sapSyncError?: string | null
  // Formatted timestamp set when the SAP sync just succeeded this session —
  // shows a "Synced" indicator (info icon + tooltip) next to the account number.
  sapSyncedAt?: string | null
}>()

const emit = defineEmits<{
  'logo-select': [event: Event]
  'logo-remove': []
  'logo-error': []
  'notes-click': []
  'retry-sap-sync': []
}>()

// A homeowner is an individual, not a company: the house placeholder IS their
// image — never uploadable, never replaceable — so the sales team can tell at a
// glance that the account they pulled up belongs to a homeowner.
const isHomeowner = computed(() => props.customer.customerGroup?.toLowerCase() === 'homeowner')

const fileInputRef = ref<HTMLInputElement | null>(null)

function triggerUpload() {
  fileInputRef.value?.click()
}
</script>

<template>
  <ProfileCard
    :tabs="tabs"
    :chart-bars="chartBars"
    :looker-url="lookerUrl"
    :is-chart-loading="isChartLoading"
  >
    <template #avatar>
      <input
        v-if="!isHomeowner"
        ref="fileInputRef"
        type="file"
        accept="image/*"
        class="visually-hidden"
        @change="emit('logo-select', $event)"
      >
      <div class="customer-avatar">
        <i
          v-if="isHomeowner"
          class="pi pi-home customer-avatar__icon"
        />
        <img
          v-else-if="logoSrc"
          :src="logoSrc"
          :srcset="logoSrcset ?? undefined"
          sizes="(min-width: 768px) 150px, 120px"
          alt="Company logo"
          class="customer-avatar__image"
          width="150"
          height="150"
          loading="lazy"
          @error="emit('logo-error')"
        >
        <BasePlaceholderIcon
          v-else
          category="customer"
          class="placeholder-avatar__icon"
        />
        <div
          v-if="isLogoProcessing"
          class="customer-avatar__processing"
        >
          <BaseSpinner size="md" />
        </div>
      </div>
      <!-- Homeowners keep the house image for good — no upload/replace affordance. -->
      <div
        v-if="!isHomeowner && !isLogoProcessing"
        class="customer-avatar__actions"
      >
        <BaseAvatarEditMenu
          :has-image="!!logoSrc"
          @upload="triggerUpload"
          @delete="emit('logo-remove')"
        />
      </div>
    </template>

    <template #header-left>
      <div class="customer-profile__header-left">
        <Tag
          v-if="!awaitingSapId && !sapSyncFailed"
          :value="customer.status === 'active' ? 'Active' : 'Inactive'"
          :class="customer.status === 'active' ? 'status-active' : 'status-inactive'"
        />
        <SapSyncFailedIndicator
          v-if="sapSyncFailed"
          subject="account"
          size="sm"
          :tooltip="sapSyncError || ''"
          @retry="emit('retry-sap-sync')"
        />
        <SapSyncingIndicator
          v-else-if="awaitingSapId"
          size="lg"
        />
        <BaseCopyText
          v-else
          :value="customer.account"
          :to="`/customers/${customer.account || customer.id}`"
          icon-position="right"
        />
      </div>
    </template>

    <template #header-right>
      <Button
        link
        class="customer-profile__notes-btn"
        @click="emit('notes-click')"
      >
        <i
          v-if="!customer.remarks"
          class="pi pi-plus"
          style="margin-right: var(--p-spacing-1); font-size: var(--p-font-size-xs);"
        />
        <span class="customer-profile__notes-label-mobile">Notes</span>
        <span class="customer-profile__notes-label">
          {{ customer.remarks ? 'Customer Notes' : 'Add Customer Notes' }}
        </span>
        <i
          v-if="customer.remarks"
          class="pi pi-ellipsis-h"
          style="margin-left: var(--p-spacing-1); font-size: var(--p-font-size-xs);"
        />
      </Button>
    </template>

    <template #identity>
      <div class="customer-profile__name-row">
        <span class="customer-profile__name">{{ customer.companyName }}</span>
        <BaseWebsiteLink
          :website="customer.website"
          :name="customer.companyName"
        />
      </div>
      <div class="customer-profile__chips">
        <Tag
          v-if="customer.isNationalAccount"
          value="National Customer"
          rounded
          severity="secondary"
        />
        <Tag
          v-if="customer.customerGroup"
          :value="customer.customerGroup"
          rounded
          severity="secondary"
        />
      </div>
    </template>
  </ProfileCard>
</template>

<style scoped>
.customer-avatar {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: var(--p-surface-0);
    border: var(--p-spacing-1) solid var(--p-surface-100);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
}

.customer-avatar__image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
}

/* 60px house in the supplier/building placeholder colour, so a homeowner's
   house reads like a company's building in the hero avatar. */
.customer-avatar__icon {
    /* Scale with the avatar (40% of its size), matching the other placeholder icons —
       60px at 150px (desktop), 48px at 120px (mobile) — instead of a fixed 60px that
       looked oversized on mobile. Intermediate var avoids a calc()-inside-var()-
       fallback parse failure (see placeholder-image.css). */
    --home-icon-fallback-size: calc(var(--p-spacing-px) * 150);
    font-size: calc(var(--profile-avatar-size, var(--home-icon-fallback-size)) * 0.4);
    color: var(--p-surface-100);
}

.customer-avatar__actions {
    position: absolute;
    top: 15%;
    left: 85%;
    transform: translate(-50%, -50%);
    z-index: 2;
    display: flex;
    justify-content: space-between;
    gap: 0;
}

.customer-avatar__actions :deep(.p-button) {
    background: var(--p-surface-0);
}

.customer-avatar__processing {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
}

.customer-profile__header-left {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    max-width: 100%;
    min-width: 0;
    row-gap: var(--p-spacing-1);

    @media (min-width: 768px) {
        max-width: none;
        min-width: auto;
        gap: var(--p-spacing-3);
    }
}

.customer-profile__header-left :deep(.base-copy-text__link) {
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-xs);
}

.customer-profile__notes-btn.p-button-link {
    font-size: var(--p-font-size-xs);
    color: var(--p-primary-500);
    padding: 0 var(--p-spacing-1) 0 0;
    gap: var(--p-spacing-1);
    border-radius: var(--p-border-radius-xs);
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);

    @media (min-width: 768px) {
        min-height: var(--p-spacing-8);
        padding: var(--p-spacing-1) var(--p-spacing-3);
    }
}

.customer-profile__notes-btn.p-button-link:hover,
.customer-profile__notes-btn.p-button-link:focus-visible {
    background: var(--p-tideblue-50);
    color: var(--p-primary-500);
}

.customer-profile__notes-label {
    display: none;
    white-space: nowrap;

    @container (min-width: 440px) {
        display: inline-flex;
    }
}

.customer-profile__notes-label-mobile {
    font-size: var(--p-font-size-xs);

    @container (min-width: 440px) {
        display: none;
    }
}

.customer-profile__name-row {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
    margin-top: 0;
    justify-content: center;
    text-align: center;

    @media (min-width: 768px) {
        justify-content: flex-start;
        text-align: left;
    }
}

.customer-profile__name {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);
    padding: var(--p-spacing-0) var(--p-spacing-1);
    border-radius: var(--p-border-radius-full);

    @media (min-width: 768px) {
        background: var(--p-surface-0);
    }
}

.customer-profile__name-row :deep(.base-icon-button) {
    background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);

    @media (min-width: 768px) {
        background: var(--p-surface-0);
    }
}

.customer-profile__name-row :deep(.base-icon-button:hover),
.customer-profile__name-row :deep(.base-icon-button:focus-visible) {
    background: var(--p-tideblue-50);
}

.customer-profile__chips {
    display: flex;
    gap: var(--p-spacing-2);
    flex-wrap: wrap;
    justify-content: center;

    @media (min-width: 768px) {
        flex-wrap: nowrap;
        justify-content: flex-start;
    }
}

.customer-profile__chips :deep(.p-tag) {
    display: flex;
    padding: var(--p-spacing-1) var(--p-spacing-2);
    flex-direction: column;
    align-items: flex-start;
    gap: var(--p-spacing-2);
    border: 4px solid var(--p-surface-0);
    border-radius: var(--p-border-radius-full);
    color: var(--p-deepblue-900);
    font-weight: var(--p-font-weight-bold);
}
</style>
