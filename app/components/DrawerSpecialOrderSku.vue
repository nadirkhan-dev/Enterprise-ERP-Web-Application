<script setup lang="ts">
import type { SpecialSkuResponse } from '~/composables/useSapSpecialSku'

// Special Order SKU lookup drawer (Items page). Uses the shared SAP reference
// data + special-SKU composables — pick manufacturer / item group / item type,
// "Lookup SKU" generates the code to copy. It's a lookup, so nothing persists.
interface Props {
  visible?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
})

const emit = defineEmits<{
  'update:visible': [value: boolean]
}>()

const localVisible = computed({
  get: () => props.visible,
  set: (value) => emit('update:visible', value),
})

const toast = useToast()
const {
  manufacturers,
  itemGroups,
  loading: optionsLoading,
  syncing: optionsSyncing,
  error: optionsError,
  hydrate,
} = useSpecialSkuReferenceData()
const { generateSpecialSku } = useSapSpecialSku()

type ItemTypeValue = 'complete' | 'repair'
const itemTypes: Array<{ label: string, value: ItemTypeValue }> = [
  { label: 'Complete', value: 'complete' },
  { label: 'Repair', value: 'repair' },
]

const manufacturerSapId = ref<number | null>(null)
const itemGroupSapId = ref<number | null>(null)
const itemType = ref<ItemTypeValue | null>(null)
const submitted = ref(false)
const isGenerating = ref(false)
const result = ref<SpecialSkuResponse | null>(null)
const formError = ref<string | null>(null)

const selectedManufacturer = computed(() =>
  manufacturers.value.find(option => option.sapId === manufacturerSapId.value) || null,
)
const selectedItemGroup = computed(() =>
  itemGroups.value.find(option => option.sapId === itemGroupSapId.value) || null,
)

const manufacturerError = computed(() =>
  submitted.value && !manufacturerSapId.value ? 'Manufacturer is required.' : '',
)
const itemGroupError = computed(() =>
  submitted.value && !itemGroupSapId.value ? 'Item group is required.' : '',
)
const itemTypeError = computed(() =>
  submitted.value && !itemType.value ? 'Item type is required.' : '',
)

const canSubmit = computed(() =>
  Boolean(manufacturerSapId.value && itemGroupSapId.value && itemType.value),
)
const initialOptionsLoading = computed(
  () => optionsLoading.value && manufacturers.value.length === 0,
)
const isLookupDisabled = computed(() => initialOptionsLoading.value || isGenerating.value)
const isSyncing = computed(() => optionsLoading.value || optionsSyncing.value)

// Same heading before and after a SKU is generated.
const DRAWER_TITLE = 'Special Order SKU Lookup'

// The secondary footer action is Cancel until a SKU exists, then Clear. Driving
// ONE button off this — rather than a v-if/v-else pair — keeps the same element
// mounted across the swap, so it re-labels in place instead of unmounting and
// remounting (which flickered).
const secondaryAction = computed(() =>
  result.value
    ? { key: 'clear', label: 'Clear', icon: 'pi pi-replay', handler: resetForm }
    : { key: 'cancel', label: 'Cancel', icon: 'pi pi-times', handler: handleCancel },
)

// Any change to a selection invalidates the previously generated SKU.
watch([manufacturerSapId, itemGroupSapId, itemType], () => {
  result.value = null
  formError.value = null
})

function resetForm() {
  manufacturerSapId.value = null
  itemGroupSapId.value = null
  itemType.value = null
  submitted.value = false
  result.value = null
  formError.value = null
}

// Fresh form + up-to-date options each time the drawer opens.
watch(localVisible, (isOpen) => {
  if (isOpen) {
    resetForm()
    hydrate()
  }
})

function buildRequestPayload() {
  if (!selectedManufacturer.value || !selectedItemGroup.value || !itemType.value) {
    return null
  }
  return {
    manufacturerSapId: selectedManufacturer.value.sapId,
    manufacturerName: selectedManufacturer.value.label,
    itemGroupSapId: selectedItemGroup.value.sapId,
    itemGroupName: selectedItemGroup.value.label,
    itemType: itemType.value,
  }
}

async function handleGenerateSku() {
  submitted.value = true
  formError.value = null
  result.value = null

  const payload = buildRequestPayload()
  if (!payload || !canSubmit.value) {
    return
  }

  isGenerating.value = true
  const { data, error } = await generateSpecialSku(payload)
  isGenerating.value = false

  if (error) {
    formError.value = error.message || 'Failed to generate Special SKU.'
    return
  }
  result.value = data
}

async function copySku() {
  if (!result.value?.itemCode) {
    return
  }
  await navigator.clipboard.writeText(result.value.itemCode)
  toast.add({
    severity: 'success',
    summary: 'SKU copied',
    detail: `${result.value.itemCode} is copied.`,
    life: 2000,
  })
}

function handleCancel() {
  localVisible.value = false
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    :title="DRAWER_TITLE"
    body-gap="6"
  >
    <Message
      v-if="optionsError"
      class="special-sku-drawer__message"
      severity="error"
      :closable="false"
    >
      {{ optionsError }}
    </Message>
    <Message
      v-if="formError"
      class="special-sku-drawer__message"
      severity="error"
      :closable="false"
    >
      {{ formError }}
    </Message>

    <div class="form-field">
        <label
          for="special-sku-manufacturer"
          class="form-field__label form-field__label--required"
        >
          Manufacturer
        </label>
        <Select
          id="special-sku-manufacturer"
          v-model="manufacturerSapId"
          :options="manufacturers"
          option-label="label"
          option-value="value"
          placeholder="Select manufacturer"
          filter
          filter-match-mode="startsWith"
          fluid
          :loading="initialOptionsLoading"
          :invalid="Boolean(manufacturerError)"
        >
          <template #loadingicon>
            <BaseSpinner
              size="sm"
              class="special-sku-drawer__select-spinner"
            />
          </template>
        </Select>
        <small
          v-if="manufacturerError"
          class="form-field__error"
        >{{ manufacturerError }}</small>
      </div>

      <div class="form-field">
        <label
          for="special-sku-item-group"
          class="form-field__label form-field__label--required"
        >
          Item Group
        </label>
        <Select
          id="special-sku-item-group"
          v-model="itemGroupSapId"
          :options="itemGroups"
          option-label="label"
          option-value="value"
          placeholder="Select item group"
          filter
          fluid
          :loading="initialOptionsLoading"
          :invalid="Boolean(itemGroupError)"
        >
          <template #loadingicon>
            <BaseSpinner
              size="sm"
              class="special-sku-drawer__select-spinner"
            />
          </template>
        </Select>
        <small
          v-if="itemGroupError"
          class="form-field__error"
        >{{ itemGroupError }}</small>
      </div>

      <div class="form-field">
        <label
          for="special-sku-item-type"
          class="form-field__label form-field__label--required"
        >
          Item Type
        </label>
        <Select
          id="special-sku-item-type"
          v-model="itemType"
          :options="itemTypes"
          option-label="label"
          option-value="value"
          placeholder="Select item type"
          fluid
          :invalid="Boolean(itemTypeError)"
        />
        <small
          v-if="itemTypeError"
          class="form-field__error"
        >{{ itemTypeError }}</small>
      </div>

      <template v-if="result">
        <Divider class="special-sku-drawer__divider" />
        <div class="special-sku-drawer__result">
          <span class="special-sku-drawer__result-label">Special Order SKU</span>
          <span class="special-sku-drawer__result-row">
            <span class="special-sku-drawer__result-code">{{ result.itemCode }}</span>
            <BaseIconButton
              icon="pi pi-copy"
              label="Copy SKU"
              @click="copySku"
            />
          </span>
        </div>
      </template>

    <template #footer>
      <div class="special-sku-drawer__footer">
        <div class="special-sku-drawer__footer-primary">
          <Button
            class="special-sku-drawer__lookup"
            :disabled="isLookupDisabled"
            @click="handleGenerateSku"
          >
            <!-- Spinner and icon share one fixed-size, stacked slot, so the glyph
                 swaps without the button reflowing. The spinner must stay v-if:
                 the loading veil in main.css keys off `.p-button:has(.base-spinner)`,
                 so a v-show'd (still-mounted) spinner would dim the button forever. -->
            <span class="special-sku-drawer__btn-icon">
              <BaseSpinner
                v-if="isGenerating"
                size="sm"
                class="special-sku-drawer__btn-spinner"
              />
              <AppNavIcon
                v-show="!isGenerating"
                icon="ms:barcode_scanner"
                aria-hidden="true"
              />
            </span>
            <!-- Both labels are stacked in one grid cell, so the box is always as
                 wide as the LONGER of them ("Generating..."). The idle label can't
                 be narrower than the busy one, so the button — and the Clear/Cancel
                 button beside it — never move when a lookup starts. -->
            <span class="special-sku-drawer__btn-label">
              <span :class="{ 'is-hidden': isGenerating }">Lookup SKU</span>
              <span :class="{ 'is-hidden': !isGenerating }">Generating...</span>
            </span>
          </Button>
          <Button
            type="button"
            severity="secondary"
            :class="[
              secondaryAction.key === 'clear'
                ? 'special-sku-drawer__clear'
                : 'special-sku-drawer__cancel',
              { 'special-sku-drawer__cancel--syncing': isSyncing && secondaryAction.key === 'cancel' },
            ]"
            @click="secondaryAction.handler"
          >
            <i :class="secondaryAction.icon" />
            <!-- Same trick as Lookup SKU: both labels share one grid cell, so the
                 button is always as wide as the longer of them and doesn't resize
                 when Cancel becomes Clear. -->
            <span class="special-sku-drawer__btn-label">
              <span :class="{ 'is-hidden': secondaryAction.key !== 'cancel' }">Cancel</span>
              <span :class="{ 'is-hidden': secondaryAction.key !== 'clear' }">Clear</span>
            </span>
          </Button>
        </div>
        <SapSyncingIndicator
          v-if="isSyncing"
          size="sm"
        />
      </div>
    </template>
  </BaseDrawer>
</template>

<style scoped>
.special-sku-drawer__message {
    margin: 0;
}

.special-sku-drawer__select-spinner,
.special-sku-drawer__btn-spinner {
    width: var(--p-font-size-base);
    height: var(--p-font-size-base);
}

/* Fixed-size slot holding both the spinner and the barcode icon, stacked in the
   same grid cell so the button's width never changes as they swap. */
.special-sku-drawer__btn-icon {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--p-font-size-base);
    height: var(--p-font-size-base);
}

.special-sku-drawer__btn-icon > * {
    grid-area: 1 / 1;
}

/* Both labels occupy the same grid cell, so the cell measures the widest one and
   the button's width is constant across the swap — no shove on Clear / Cancel. */
.special-sku-drawer__btn-label {
    display: inline-grid;
    place-items: center;
}

.special-sku-drawer__btn-label > span {
    grid-area: 1 / 1;
    white-space: nowrap;
}

/* Hidden but still measured — that's what holds the width. */
.special-sku-drawer__btn-label > span.is-hidden {
    visibility: hidden;
}

/* Kill PrimeVue's default ~20px divider margins (higher specificity than
   .p-divider-horizontal) — the drawer-body flex gap already spaces it, so this
   keeps the result section from adding needless height (and a scrollbar). */
.special-sku-drawer__divider.p-divider-horizontal {
    margin: 0;
}

/* Generated SKU — highlighted box with the code + copy affordance. */
.special-sku-drawer__result {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-1);
    padding: var(--p-spacing-3) var(--p-spacing-4);
    border: 1px solid var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-skyblue-50);
}

.special-sku-drawer__result-label {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-600);
}

.special-sku-drawer__result-row {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.special-sku-drawer__result-code {
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}

/* Footer: Lookup SKU + Cancel on the left, Refresh on the right. */
.special-sku-drawer__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-3);
    width: 100%;
}

.special-sku-drawer__footer-primary {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.special-sku-drawer__lookup.p-button,
.special-sku-drawer__cancel.p-button,
.special-sku-drawer__clear.p-button {
    display: inline-flex;
    align-items: center;
    gap: var(--p-button-gap);
}

/* AppNavIcon's inline <svg> sizes itself off the inherited font-size; it only
   needs protecting from the flex row squeezing it when the label wraps. */
.special-sku-drawer__lookup .app-nav-icon-svg {
    flex-shrink: 0;
}

/* Cancel / Clear: borderless filled-secondary (gray-50) with the app's
   tideblue-50 hover — matches BaseActionButtons used by the other drawers.
   Clear replaces Cancel once a SKU result is showing. Shown at every
   breakpoint, including mobile, alongside Lookup SKU. */
.special-sku-drawer__cancel.p-button,
.special-sku-drawer__clear.p-button {
    display: inline-flex;
    border-color: transparent;
    background: var(--p-gray-50);
    color: var(--p-deepblue-900);
}

.special-sku-drawer__cancel.p-button:hover,
.special-sku-drawer__cancel.p-button:focus-visible,
.special-sku-drawer__clear.p-button:hover,
.special-sku-drawer__clear.p-button:focus-visible {
    border-color: transparent;
    background: var(--p-tideblue-50);
    color: var(--p-deepblue-900);
}

/* While syncing there isn't room on mobile for Cancel beside Lookup SKU and the
   Syncing indicator, so hide it there; from tablet up there's room — keep it. */
.special-sku-drawer__cancel--syncing.p-button {
    display: none;

    @media (min-width: 768px) {
        display: inline-flex;
    }
}
</style>
