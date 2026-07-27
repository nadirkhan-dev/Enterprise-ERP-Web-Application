<script setup lang="ts">
import { useItemsNavigationStore } from '~/stores/itemsNavigation'
import type { InventoryRow } from '~/composables/useItemDetail'
import type { ManufacturerSupplier } from '~/composables/useManufacturers'

const route = useRoute()
const toast = useToast()
const navStore = useItemsNavigationStore()
const shopifyProductDrawerVisible = ref(false)
const item = reactive(createEmptyItem())

// Detail-page title is the semantic identifier (SKU); reactive so it updates
// once the record loads. Falls back to 'Item' before data arrives.
useHead({ title: () => item.sku || 'Item' })

const calculator = useItemPriceCalculator(item)

const {
  inventory,
  documents,
  alternateItems,
  repairParts,
  crossSells,
  productionTypeNote,
  isLoading,
  isPricingLoading,
  hasLoadError,
  loadError,
  chartBars,
  isChartLoading,
  chartLookerUrl,
  suppliers,
  loadItem,
  loadItemFieldNotes,
} = useItemDetail({
  item,
  applyPricingSnapshot: calculator.applyPricingSnapshot,
  formatCurrency: calculator.formatCurrency,
})
// Suppliers are associated with the item's MANUFACTURER (not the item itself).
// The item page is view-only: no Add / edit / reorder — those are manufacturer-
// level actions surfaced on the manufacturer page (CONNECT-556). The sort-order
// (drag) column is dropped here so there's no reorder affordance.
const supplierAssociationNote = computed(() =>
  `Suppliers are associated with this item's manufacturer${item.manufacturer ? ` (${item.manufacturer})` : ''}, not the item itself.`,
)

const { showLoader } = useDeferredLoading(isLoading)

const navTabs = computed(() => [
  { label: 'Price & Availability', icon: 'ms:shoppingmode', sectionId: 'price-availability' },
  { label: `Suppliers (${suppliers.value.length})`, icon: 'pi pi-box', sectionId: 'suppliers' },
  { label: 'Logistics', icon: 'ms:conveyor_belt', sectionId: 'logistics' },
  // Estimate Shipping moves from a standalone section into a per-row side panel
  // (triggered from Warehouse / Supplier rows), so its nav entry is disabled too.
  // { label: 'Estimate Shipping', icon: 'ms:local_shipping', sectionId: 'estimate-shipping' },
  { label: `Documents (${documents.value.length})`, icon: 'pi pi-file-pdf', sectionId: 'documents' },
  { label: `Alternate Items (${alternateItems.value.length})`, icon: 'ms:barcode_scanner', sectionId: 'alternate-items' },
  { label: `Repair Parts (${repairParts.value.length})`, icon: 'pi pi-wrench', sectionId: 'repair-parts' },
  { label: `Cross Sells (${crossSells.value.length})`, icon: 'pi pi-arrow-right-arrow-left', sectionId: 'cross-sells' },
])

function setEditorRef(el: HTMLElement | null) {
  calculator.editorRef.value = el
}

function openShopifyProductDrawer() {
  shopifyProductDrawerVisible.value = true
}

// Shipping Estimator drawer — opened by the per-row truck icon on a Warehouse
// (Price & Availability) or Supplier row. The context tells the drawer which
// ship-from origin to preselect.
const shippingEstimatorVisible = ref(false)
const estimatorContext = ref<{
  source: 'warehouse' | 'supplier'
  warehouseName?: string | null
  supplier?: { id: number | string, name: string, accountNumber?: string | null } | null
} | null>(null)

const estimatorSuppliers = computed(() =>
  suppliers.value.map(supplier => ({
    id: supplier.id,
    name: supplier.name,
    accountNumber: supplier.accountNumber,
  })),
)

function openEstimatorForWarehouse(row: InventoryRow) {
  estimatorContext.value = { source: 'warehouse', warehouseName: row.warehouse }
  shippingEstimatorVisible.value = true
}

function openEstimatorForSupplier(supplier: ManufacturerSupplier) {
  estimatorContext.value = {
    source: 'supplier',
    supplier: { id: supplier.id, name: supplier.name, accountNumber: supplier.accountNumber },
  }
  shippingEstimatorVisible.value = true
}

// Points the Next/Prev navigation at the current route. The nav store
// decides whether this is a fresh entry (rebuild + reset the detail filter)
// or a Next/Prev step (preserve the detail filter). The item record itself
// is loaded by `useItemDetail`, which owns its own route.params.id watcher.
function handleItemRoute() {
  navStore.enterItem(String(route.params.id))
}

// The page transition re-creates this component on every Next/Prev, so
// `onMounted` covers in-detail navigation; the route watch covers the case
// where the component is reused instead.
watch(() => route.params.id, handleItemRoute)
onMounted(() => {
  handleItemRoute()
  loadItem()
  loadItemFieldNotes()
})

// Surface navigation fetch failures as a toast. The nonce re-fires the
// watcher even when consecutive failures carry the same message.
watch(
  () => navStore.navErrorNonce,
  () => {
    toast.add({
      severity: 'error',
      summary: 'Item navigation',
      detail: navStore.navErrorMessage ?? 'Something went wrong.',
      life: 4000,
    })
  },
)
</script>

<template>
  <div class="item-page">
    <BaseLoader
      v-if="showLoader"
      overlay
      label="Loading item..."
    />

    <!-- Top toolbar — back link + filter / next-prev CTAs -->
    <div
      v-if="!hasLoadError"
      class="item-page__top"
    >
      <BaseBackButton
        to="/items"
        label="Back to Items"
        class="item-back"
      />
      <ItemsToolbar :show-navigation="true" />
    </div>

    <Error500 v-if="hasLoadError" />

    <Message
      v-if="loadError"
      severity="error"
      :closable="false"
    >
      {{ loadError }}
    </Message>

    <div
      v-if="!isLoading && !hasLoadError && !loadError"
      class="item-page__content"
    >
      <ProfileCard
        :tabs="navTabs"
        :chart-bars="chartBars"
        :looker-url="chartLookerUrl"
        :is-chart-loading="isChartLoading"
        order-count-label="Units Sold"
        primary-mode="orderCount"
      >
        <template #avatar>
          <div class="item-avatar">
            <BasePlaceholderIcon
              category="item"
              class="placeholder-avatar__icon"
            />
          </div>
        </template>

        <template #header-left>
          <div class="item-profile__header-left">
            <Tag
              :value="item.status === 'active' ? 'Active' : 'Inactive'"
              :class="item.status === 'active' ? 'status-active' : 'status-inactive'"
            />
            <BaseCopyText
              :value="item.sku"
              icon-position="right"
              class="item-profile__sku"
            />
            <BaseCopyText
              :value="item.mpn"
              icon-position="right"
              class="item-profile__mpn"
            />
          </div>
        </template>

        <template #header-right>
          <div class="item-profile__header-right">
            <Tag
              v-if="!item.allowReturns"
              rounded
              aria-label="Non-returnable Item"
              class="item-profile__non-returnable"
            >
              <span
                class="non-returnable-tag__icon"
                aria-hidden="true"
              >
                <i class="pi pi-box non-returnable-tag__box" />
                <i class="pi pi-ban non-returnable-tag__ban" />
              </span>
              <span class="non-returnable-tag__label">Non-returnable Item</span>
            </Tag>
            <Button
              link
              class="item-profile__shopify-btn"
              @click="openShopifyProductDrawer"
            >
              <span class="item-profile__shopify-label-mobile">Shopify</span>
              <span class="item-profile__shopify-label">Shopify Product</span>
              <i class="pi pi-ellipsis-h item-profile__shopify-icon" />
            </Button>
            <BaseCopyText
              :value="item.mpn"
              icon-position="right"
              class="item-profile__mpn-mobile"
            />
          </div>
        </template>

        <template #identity>
          <div class="item-profile__name-row">
            <span class="item-profile__name">{{ item.name }}</span>
            <BaseIconButton
              icon="pi pi-globe"
              label="Open product page"
              :to="`https://libertysupply.com/products/${item.sku.toLowerCase()}`"
              external
              target="_blank"
            />
          </div>
          <div class="item-profile__chips">
            <Tag :value="item.manufacturer" rounded severity="secondary" />
            <Tag :value="item.category" rounded severity="secondary" />
          </div>
        </template>
      </ProfileCard>

      <ItemPricePanel
        :item="item"
        :inventory="inventory"
        :is-pricing-loading="isPricingLoading"
        :original-base-cost-display="calculator.originalBaseCostDisplay.value"
        :original-offer-price-display="calculator.originalOfferPriceDisplay.value"
        :original-gross-margin-display="calculator.originalGrossMarginDisplay.value"
        :is-base-cost-valid="calculator.isBaseCostValid.value"
        :is-offer-price-valid="calculator.isOfferPriceValid.value"
        :is-gross-margin-valid="calculator.isGrossMarginValid.value"
        :editing-field="calculator.editingField.value"
        :edit-dollar-value="calculator.editDollarValue.value"
        :edit-percent-value="calculator.editPercentValue.value"
        @open-calculator="calculator.openCalculator"
        @close-calculator="calculator.closeCalculator"
        @dollar-input-event="calculator.onDollarInputEvent"
        @dollar-input="calculator.onDollarInput"
        @percent-input-event="calculator.onPercentInputEvent"
        @percent-input="calculator.onPercentInput"
        @editor-ref="setEditorRef"
        @estimate-shipping="openEstimatorForWarehouse"
      />

      <SectionManufacturerSuppliers
        :suppliers="suppliers"
        :collapsed="!suppliers.length"
        :show-add="false"
        :show-edit="false"
        :reorderable="false"
        :show-estimate-shipping="true"
        :association-note="supplierAssociationNote"
        :active-detail-id="shippingEstimatorVisible && estimatorContext?.source === 'supplier'
          ? estimatorContext?.supplier?.id ?? null
          : null"
        @estimate-shipping="openEstimatorForSupplier"
      />

      <ItemLogistics
        :item="item"
        :production-type-note="productionTypeNote"
      />

      <SectionDocuments
        :documents="documents"
        :collapsed="!documents.length"
      />

      <SectionRelatedItemsPanel
        id="alternate-items"
        :title="`Alternate Items (${alternateItems.length})`"
        :items="alternateItems"
        :collapsed="!alternateItems.length"
        filterable
        filter-placeholder="Search Alternate Items"
        page-label="alternate items"
      />

      <SectionRelatedItemsPanel
        id="repair-parts"
        :title="`Repair Parts (${repairParts.length})`"
        :items="repairParts"
        :collapsed="!repairParts.length"
        page-label="repair parts"
        filter-placeholder="Search Repair Parts"
      />

      <SectionRelatedItemsPanel
        id="cross-sells"
        :title="`Cross Sells (${crossSells.length})`"
        :items="crossSells"
        :collapsed="!crossSells.length"
        page-label="cross sells"
        filter-placeholder="Search Cross Sells"
      />
    </div>

    <DrawerUnderConstruction v-model:visible="shopifyProductDrawerVisible" />
    <DrawerShippingEstimator
      v-model:visible="shippingEstimatorVisible"
      :item="item"
      :context="estimatorContext"
      :suppliers="estimatorSuppliers"
    />
    <PageScrollTop />
  </div>
</template>

<style scoped>
.item-page {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    padding: 0;

    @media (min-width: 768px) {
        gap: var(--p-spacing-4);
    }
}

/* Content stack (everything below the toolbar). On mobile the inline
   nav/filter trigger bar (`.items-toolbar__nav`, height var(--p-spacing-8))
   adds a row of whitespace above the profile card; pull the content up by
   exactly that height so it tucks into the card's empty avatar padding
   instead of leaving a gap. The pull is removed from tablet up, where the
   toolbar shares the back-button row. */
.item-page__content {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-3);
    margin-top: calc(-1 * var(--p-spacing-8));

    @media (min-width: 768px) {
        /* Transparent wrapper on desktop: the profile card, price panel and
           related panels become direct flex children of `.item-page` again,
           restoring the original desktop layout. With no box generated the
           negative margin-top is also dropped — no separate reset needed. */
        display: contents;
    }
}

/* Top toolbar — back link + filter / next-prev CTAs */
.item-page__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-3);
}

.item-page__top > .items-toolbar {
    margin-left: auto;
}

.item-back {
    display: none;

    @media (min-width: 768px) {
        display: inline-flex;
    }
}

/* Item avatar (ProfileCard #avatar slot) */
.item-avatar {
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

/* Item profile header (ProfileCard #header-left slot) */
.item-profile__header-left {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    max-width: 100%;
    min-width: 0;
    row-gap: var(--p-spacing-1);

    @media (min-width: 790px) {
        max-width: none;
        min-width: auto;
        gap: var(--p-spacing-4);
    }
}

:deep(.item-profile__header-left .base-copy-text__link) {
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-xs);
}

/* Below 790: the SKU drops onto its own line under the Active tag, so it sits
   on the lower row alongside the right-aligned MPN. At 790+ it returns to the
   inline Active / SKU / MPN strip. */
.item-profile__sku {
    flex-basis: 100%;

    @media (min-width: 790px) {
        flex-basis: auto;
    }
}

/* MPN's home is inline after the SKU on the left (790+). Below 790 it hides
   here and surfaces on the right, under the Shopify text (see the mobile
   element below). */
.item-profile__mpn {
    display: none;

    @media (min-width: 790px) {
        display: inline-flex;
    }
}

/* Below 790: the MPN sits on the right, on its own line directly under the
   Shopify text (header-right's flex-end keeps it right-aligned), forming the
   lower SKU / MPN row. Hidden at 790+, where the MPN lives inline on the left. */
.item-profile__mpn-mobile {
    position: relative;
    z-index: 2;
    flex-basis: 100%;
    justify-content: flex-end;
    flex-shrink: 0;
    white-space: nowrap;

    @media (min-width: 790px) {
        display: none;
    }
}

:deep(.item-profile__mpn-mobile .base-copy-text__link) {
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-xs);
}

/* Let a long MPN extend leftward past the right-half constraint and overlay
   the avatar instead of being clipped. The z-index on the MPN element lifts
   it above the avatar (z-index: 1 on the ProfileCard avatar container). */
:deep(.profile-card__header-right) {
    overflow: visible;
}

:deep(.item-profile__header-left .base-copy-text) {
    flex-shrink: 0;
    white-space: nowrap;
}

:deep(.item-profile__header-left .base-copy-text__text-right) {
    @media (min-width: 768px) {
        margin-left: var(--p-spacing-2);
    }
}

:deep(.item-profile__shopify-btn.p-button-link) {
    font-size: var(--p-font-size-xs);
    color: var(--p-primary-500);
    padding: 0 var(--p-spacing-1) 0 0;
    gap: var(--p-spacing-1);
    border-radius: var(--p-border-radius-xs);
    transition: background var(--p-transition-duration-normal) var(--p-transition-timing-ease-out);

    @media (min-width: 790px) {
        min-height: var(--p-spacing-8);
        padding: var(--p-spacing-1) var(--p-spacing-3);
    }
}

:deep(.item-profile__shopify-btn.p-button-link:hover),
:deep(.item-profile__shopify-btn.p-button-link:focus-visible) {
    background: var(--p-tideblue-50);
    color: var(--p-primary-500);
}

.item-profile__shopify-icon {
    font-size: var(--p-font-size-xs);
}

.item-profile__shopify-label {
    display: none;
    white-space: nowrap;

    @container (min-width: 440px) {
        display: inline-flex;
    }
}

.item-profile__shopify-label-mobile {
    font-size: var(--p-font-size-xs);

    @container (min-width: 440px) {
        display: none;
    }
}

/* Below 790: bottom-align the two header columns so the stacked SKU (left)
   and MPN (right) share a baseline on the lower row, regardless of how tall
   each column's upper row is. At 790+ the shared center-alignment applies so
   the inline strip lines up with the Shopify text. */
:deep(.profile-card__header) {
    align-items: flex-end;

    @media (min-width: 790px) {
        align-items: center;
    }
}

/* Non-returnable tag (ProfileCard #header-right slot) */
.item-profile__header-right {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: var(--p-spacing-1) var(--p-spacing-1);

    @media (min-width: 768px) {
        gap: 0 var(--p-spacing-4);
    }

    @media (min-width: 1024px) {
        flex-wrap: nowrap;
    }
}

.item-profile__non-returnable.p-tag {
    background: var(--p-skyblue-50);
    color: var(--p-deepblue-900);
    gap: var(--p-spacing-1);
    flex-shrink: 0;
    border-radius: var(--p-border-radius-full);
    /* Mobile + tablet (icon-only): equal padding renders a full circle. */
    padding: var(--p-spacing-1);

    @media (min-width: 1024px) {
        /* Laptop+: label visible — horizontal padding renders a pill. */
        padding: var(--p-spacing-1) var(--p-spacing-2);
    }
}

/* Composite icon — PrimeIcons product box overlaid with a prohibition
   mark, stacked and centered per the Figma non-returnable spec. */
.non-returnable-tag__icon {
    position: relative;
    display: inline-block;
    width: var(--p-font-size-sm);
    height: var(--p-font-size-sm);
    flex-shrink: 0;
}

.non-returnable-tag__box,
.non-returnable-tag__ban {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
}

/* Box nests inside the prohibition mark. */
.non-returnable-tag__box {
    font-size: var(--p-font-size-xxxs);
    color: var(--p-gray-800);
}

.non-returnable-tag__ban {
    font-size: var(--p-font-size-sm);
    color: var(--p-red-700);
}

/* body-sm/bold — 12px, weight-bold; deepblue chip color inherited. */
.non-returnable-tag__label {
    font-size: var(--p-font-size-xs);
    font-weight: var(--p-font-weight-bold);

    display: none;

    @media (min-width: 1024px) {
        display: inline;
    }
}

/* Item profile identity (ProfileCard #identity slot) */
.item-profile__name-row {
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

/* Title pill — its own translucent (80%) white background so the chart
   bars beneath bleed through slightly. Kept independent of the globe
   button's background (no shared parent pill) so only the title and the
   globe are tinted, and the gap between them shows the chart. */
.item-profile__name {
    font-size: var(--p-font-size-base);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
    background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);
    padding: var(--p-spacing-0) var(--p-spacing-3);
    border-radius: var(--p-border-radius-full);

    @media (min-width: 768px) {
        background: var(--p-surface-0);
    }
}

/* Globe icon button — its own translucent (80%) white background, applied
   separately from the title so each element only shades the chart directly
   behind it. Hover keeps the standard tideblue tint. */
.item-profile__name-row :deep(.base-icon-button) {
    background: color-mix(in srgb, var(--p-surface-0) 60%, transparent);

    @media (min-width: 768px) {
        background: var(--p-surface-0);
    }
}

.item-profile__name-row :deep(.base-icon-button:hover),
.item-profile__name-row :deep(.base-icon-button:focus-visible) {
    background: var(--p-tideblue-50);
}

.item-profile__chips {
    display: flex;
    gap: var(--p-spacing-2);
    flex-wrap: wrap;
    justify-content: center;

    @media (min-width: 768px) {
        flex-wrap: nowrap;
        justify-content: flex-start;
    }
}

/* Mirror the customer/supplier chip styling: white border + rounded pill,
   so each tag reads cleanly against the chart-bar green/blue behind. */
.item-profile__chips :deep(.p-tag) {
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
