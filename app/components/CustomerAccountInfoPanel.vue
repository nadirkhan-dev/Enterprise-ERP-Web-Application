<script setup lang="ts">
withDefaults(defineProps<{
  customer: Record<string, any>
  // Suppliers show a single row of 4 fields and hide the shipping accounts —
  // they're irrelevant (we always ship on our own UPS account).
  isSupplier?: boolean
  // SAP-sync state for the account number cell (mirrors the profile header):
  // spinner while awaiting, "Failed" + Retry Sync on failure, "Synced" indicator
  // (info icon + tooltip) once it syncs live.
  awaitingSapId?: boolean
  sapSyncFailed?: boolean
  // Reason for the failed/unconfirmed sync — shown in the failed indicator's
  // tooltip so the cause stays visible after the toast dismisses.
  sapSyncError?: string | null
  sapSyncedAt?: string | null
}>(), {
  isSupplier: false,
  awaitingSapId: false,
  sapSyncFailed: false,
  sapSyncError: null,
  sapSyncedAt: null,
})

defineEmits<{
  (e: 'edit'): void
  (e: 'retry-sap-sync'): void
}>()
</script>

<template>
  <BasePanel
    id="account-info"
    title="Account Information"
  >
    <template #actions>
      <Button
        size="small"
        label="Edit"
        icon="pi pi-pencil"
        class="customer-panel-edit"
        @click="$emit('edit')"
      />
    </template>
    <div
      class="info-grid"
      :class="{ 'info-grid--supplier': isSupplier }"
    >
      <!-- Account Number — status tag inline before the number -->
      <div class="info-item">
        <span class="info-label">Account Number</span>
        <span class="info-value account-info__account">
          <Tag
            v-if="!awaitingSapId && !sapSyncFailed"
            :value="customer.status === 'active' ? 'Active' : 'Inactive'"
            :class="customer.status === 'active' ? 'status-active' : 'status-inactive'"
          />
          <SapSyncFailedIndicator
            v-if="sapSyncFailed"
            subject="account"
            size="lg"
            :tooltip="sapSyncError || ''"
            @retry="$emit('retry-sap-sync')"
          />
          <SapSyncingIndicator v-else-if="awaitingSapId" />
          <BaseCopyText
            v-else
            :value="customer.accountNumber"
            icon-position="right"
          />
        </span>
      </div>

      <!-- Primary Contact — name only; job title (often long) lives behind the
           info icon so the column never needs an overflow state. -->
      <div class="info-item">
        <span class="info-label">Default Sales Contact</span>
        <span class="info-value account-info__contact-value">
          <span :class="{ muted: customer.primaryContactName === '—' }">{{
            customer.primaryContactName
          }}</span>
          <i
            v-if="customer.primaryContactTitle"
            v-tooltip.top="customer.primaryContactTitle"
            class="pi pi-info-circle account-info__contact-icon"
          />
        </span>
      </div>

      <div class="info-item">
        <span class="info-label">Default Billing Contact</span>
        <span class="info-value account-info__contact-value">
          <span :class="{ muted: customer.billingContactName === '—' }">{{
            customer.billingContactName
          }}</span>
          <i
            v-if="customer.billingContactTitle"
            v-tooltip.top="customer.billingContactTitle"
            class="pi pi-info-circle account-info__contact-icon"
          />
        </span>
      </div>

      <div class="info-item">
        <span class="info-label">Account Representative</span>
        <span :class="['info-value', customer.accountRep === '—' ? 'muted' : '']">{{
          customer.accountRep
        }}</span>
      </div>

      <!-- Shipping accounts are hidden for suppliers (we always ship on our own
           UPS account, so they're irrelevant). -->
      <div
        v-if="!isSupplier"
        class="info-item"
      >
        <span class="info-label">Default Parcel Shipping Account</span>
        <span class="info-value account-info__carrier-account">
          <template v-if="customer.defaultParcelCarrier !== '—'">
            <span class="account-info__carrier">{{ customer.defaultParcelCarrier }}</span>
            <BaseCopyText
              v-if="customer.parcelAccountNumber !== '—'"
              :value="customer.parcelAccountNumber"
              icon-position="right"
            />
          </template>
          <span
            v-else
            class="muted"
          >—</span>
        </span>
      </div>

      <div
        v-if="!isSupplier"
        class="info-item"
      >
        <span class="info-label">Default LTL Shipping Account</span>
        <span class="info-value account-info__carrier-account">
          <template v-if="customer.defaultLtlCarrier !== '—'">
            <span class="account-info__carrier">{{ customer.defaultLtlCarrier }}</span>
            <BaseCopyText
              v-if="customer.ltlAccountNumber !== '—'"
              :value="customer.ltlAccountNumber"
              icon-position="right"
            />
          </template>
          <span
            v-else
            class="muted"
          >—</span>
        </span>
      </div>
    </div>
  </BasePanel>
</template>

<style scoped>
.info-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-4) var(--p-spacing-3);

    @media (min-width: 768px) {
        grid-template-columns: repeat(2, 1fr);
        gap: var(--p-spacing-6) var(--p-spacing-4);
    }

    @media (min-width: 1024px) {
        grid-template-columns: repeat(3, 1fr);
    }
}

/* Suppliers only have 4 fields (no shipping accounts), so they fit one row on
   desktop instead of wrapping to a 3-column grid. */
.info-grid--supplier {
    @media (min-width: 1024px) {
        grid-template-columns: repeat(4, 1fr);
    }
}

.info-item {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
    align-items: flex-start;

    @media (min-width: 768px) {
        align-items: stretch;
    }
}

.info-grid :deep(.base-copy-text__text-right) {
    margin-left: var(--p-spacing-2);
}

/* Copy-text values are part of the data, so match the 16px value style and the
   other values' semibold weight. */
.info-value :deep(.base-copy-text__link) {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-semibold);
}

/* Account Number is the SAP key value — render it in the mono "key data" face,
   matching the same account number in the profile-card header. */
.account-info__account :deep(.base-copy-text__link) {
    font-family: var(--p-mono-family);
}

.info-item > :deep(.p-tag) {
    align-self: flex-start;

    @media (min-width: 768px) {
        align-self: auto;
    }
}

/* Heading / label — Figma body-md/demibold, muted. */
.info-label {
    font-size: var(--p-font-size-sm);
    line-height: var(--p-spacing-5);
    font-weight: var(--p-font-weight-normal);
    color: var(--p-gray-800);
}

/* Data / value — Figma body-lg/demibold, deepblue. */
.info-value {
    font-size: var(--p-font-size-base);
    line-height: var(--p-spacing-6);
    color: var(--p-deepblue-900);
    font-weight: var(--p-font-weight-semibold);
    letter-spacing: 0;
    font-feature-settings: 'liga' off, 'clig' off;
    display: flex;
    align-items: center;
    gap: var(--p-spacing-1);
}

/* Em-dash placeholder stays in the prior muted look. */
.info-value.muted,
.info-value .muted {
    font-size: var(--p-font-size-sm);
    font-weight: var(--p-font-weight-medium);
    color: var(--p-gray-800);
}

/* Status tag sits flush against the account number. */
.account-info__account {
    gap: var(--p-spacing-3);
    flex-wrap: wrap;
}

/* Contact rows: 8px gap between the name and the info icon (per Figma). */
.account-info__contact-value {
    gap: var(--p-spacing-2);
}

.account-info__contact-icon {
    color: var(--p-skyblue-600);
    /* Fixed 14×14 icon (per Figma). */
    width: var(--p-font-size-sm);
    height: var(--p-font-size-sm);
    font-size: var(--p-font-size-sm);
    line-height: var(--p-font-size-sm);
    cursor: default;
}

/* Shipping account values (carrier + number) match the other values' semibold
   weight — inherited from .info-value, with no per-row override. */
.account-info__carrier-account {
    gap: var(--p-spacing-2);
}

.account-info__carrier {
    color: var(--p-deepblue-900);
}

.customer-panel-edit :deep(.p-button-label) {
    display: none;

    @media (min-width: 768px) {
        display: inline;
    }
}

.customer-panel-edit.p-button {
    width: 36px;
    min-width: 36px;
    height: 36px;
    padding: 0;

    @media (min-width: 768px) {
        width: auto;
        min-width: auto;
        height: auto;
        padding: var(--p-button-sm-padding-y) var(--p-button-sm-padding-x);
    }
}
</style>
