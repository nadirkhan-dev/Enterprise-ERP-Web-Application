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
  // Whether the caller may write the customer's account notes — when false and
  // no notes exist, the trigger hides: an "Add" button opening a read-only
  // empty drawer is a dead end.
  canEditNotes?: boolean
}>()
const { logoFit, isLogoMeasured, isLogoLoading, handleLogoLoad, handleLogoMount } = useLogoFit(toRef(props, 'logoSrc'))

const emit = defineEmits<{
  'logo-select': [event: Event]
  'logo-remove': []
  'logo-error': [event: Event]
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
        <BasePlaceholderIcon
          v-if="isHomeowner"
          category="homeowner"
          class="placeholder-avatar__icon"
        />
        <img
          v-else-if="logoSrc"
          :ref="handleLogoMount"
          :src="logoSrc"
          :srcset="logoSrcset ?? undefined"
          sizes="(min-width: 768px) 150px, 120px"
          alt="Company logo"
          class="avatar-logo-image"
          :class="{ 'avatar-logo-image--measuring': !isLogoMeasured }"
          :style="{ '--logo-fit': logoFit }"
          width="150"
          height="150"
          loading="lazy"
          @load="handleLogoLoad"
          @error="emit('logo-error', $event)"
        >
        <BasePlaceholderIcon
          v-else
          category="customer"
          class="placeholder-avatar__icon"
        />
        <div
          v-if="isLogoProcessing || isLogoLoading"
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
        <StatusTag
          v-if="!awaitingSapId && !sapSyncFailed"
          :status="customer.status"
          :inactive-note="customer.inactiveNote"
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
        v-if="canEditNotes || customer.remarks"
        link
        class="customer-profile__notes-btn"
        @click="emit('notes-click')"
      >
        <AppNavIcon
          :icon="customer.remarks ? 'ms:edit_description' : 'ms:add_description'"
          class="customer-profile__notes-icon"
        />
        <span class="customer-profile__notes-label-mobile">Notes</span>
        <span class="customer-profile__notes-label">
          {{ customer.remarks ? 'View Account Notes' : 'Add Account Notes' }}
        </span>
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
    box-sizing: border-box;
    padding: var(--p-spacing-4);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
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
    /* 7px — the design system's button gap (button-small). */
    gap: var(--p-spacing-1-75);
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

/* The button's own `gap` spaces the icon from the label — the glyph only needs
   to match the label's optical size (see AppNavIcon's 1em box). */
.customer-profile__notes-icon {
    font-size: var(--p-font-size-xs);
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

/* Name + globe share ONE pill (Figma 8056-105958) so the icon reads as part of
   the label instead of floating off the end of a name-only pill. The globe's
   20px hit box carries 4px of its own inset around the 12px glyph, so the row
   pads 4px on the icon side to land Figma's 8px padding / 8px gap. */
.customer-profile__name-row {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
    margin-top: 0;
    justify-content: center;
    text-align: center;
    padding: var(--p-spacing-1) var(--p-spacing-1) var(--p-spacing-1) var(--p-spacing-2);
    border-radius: var(--p-border-radius-full);
    background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);

    @media (min-width: 768px) {
        justify-content: flex-start;
        text-align: left;
        background: var(--p-surface-0);
    }
}

/* Trimmed to cap height so the globe centres on the all-caps name rather than
   hugging its baseline. */
.customer-profile__name {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    text-box-trim: trim-both;
    text-box-edge: cap alphabetic;
}

.customer-profile__name-row :deep(.base-icon-button__icon) {
    font-size: var(--p-font-size-xs);
}

/* The margin tops up ProfileCard's 8px identity gap to Figma's 16px between the
   name pill and the chips (8056-105947). */
.customer-profile__chips {
    display: flex;
    gap: var(--p-spacing-2);
    flex-wrap: wrap;
    justify-content: center;
    margin-top: var(--p-spacing-2);

    @media (min-width: 768px) {
        flex-wrap: nowrap;
        justify-content: flex-start;
    }
}

/* Figma chip (8037:367876): light-blue fill with a 1px gray outline. */
.customer-profile__chips :deep(.p-tag) {
    display: flex;
    padding: var(--p-spacing-0-5) var(--p-spacing-2);
    flex-direction: column;
    align-items: flex-start;
    gap: var(--p-spacing-2);
    border: 1px solid var(--p-gray-200);
    border-radius: var(--p-border-radius-full);
    background: var(--p-skyblue-50);
    color: var(--p-deepblue-900);
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-bold);
    line-height: var(--p-spacing-4);
}
</style>
