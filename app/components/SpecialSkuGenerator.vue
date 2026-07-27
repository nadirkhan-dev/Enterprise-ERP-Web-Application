<script setup lang="ts">
import type { SpecialSkuResponse } from '~/composables/useSapSpecialSku'

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

const itemTypes: Array<{ label: string; value: ItemTypeValue }> = [
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

const lookupButtonLabel = computed(() =>
  isGenerating.value ? 'Generating...' : 'Lookup SKU',
)

const isLookupDisabled = computed(
  () => initialOptionsLoading.value || isGenerating.value,
)

const isSyncing = computed(() => optionsLoading.value || optionsSyncing.value)

onMounted(() => {
  hydrate()
})

watch([manufacturerSapId, itemGroupSapId, itemType], () => {
  result.value = null
  formError.value = null
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

function handleClear() {
  manufacturerSapId.value = null
  itemGroupSapId.value = null
  itemType.value = null
  submitted.value = false
  result.value = null
  formError.value = null
}
</script>

<template>
  <BasePanel title="Special Order SKU Lookup">
    <div class="special-sku">
      <Message
        v-if="optionsError"
        class="special-sku__message"
        severity="error"
        :closable="false"
      >
        {{ optionsError }}
      </Message>

      <Message
        v-if="formError"
        class="special-sku__message"
        severity="error"
        :closable="false"
      >
        {{ formError }}
      </Message>

      <form
        class="special-sku__form"
        autocomplete="off"
        @submit.prevent="handleGenerateSku"
      >
        <div class="special-sku__fields">
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
              :loading="initialOptionsLoading"
              :invalid="Boolean(manufacturerError)"
            >
              <template #loadingicon>
                <BaseSpinner size="sm" class="special-sku__select-spinner" />
              </template>
            </Select>
            <small
              v-if="manufacturerError"
              class="form-field__error"
            >
              {{ manufacturerError }}
            </small>
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
              :loading="initialOptionsLoading"
              :invalid="Boolean(itemGroupError)"
            >
              <template #loadingicon>
                <BaseSpinner size="sm" class="special-sku__select-spinner" />
              </template>
            </Select>
            <small
              v-if="itemGroupError"
              class="form-field__error"
            >
              {{ itemGroupError }}
            </small>
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
              :invalid="Boolean(itemTypeError)"
            />
            <small
              v-if="itemTypeError"
              class="form-field__error"
            >
              {{ itemTypeError }}
            </small>
          </div>
        </div>

        <div class="special-sku__actions">
          <div class="special-sku__actions-primary">
            <Button
              type="submit"
              size="small"
              class="special-sku__lookup"
              :disabled="isLookupDisabled"
            >
              <BaseSpinner
                v-if="isGenerating"
                size="sm"
                class="special-sku__lookup-spinner"
              />
              <AppNavIcon
                v-else
                icon="ms:barcode_scanner"
                aria-hidden="true"
              />
              <span>{{ lookupButtonLabel }}</span>
            </Button>
            <Button
              v-if="result"
              type="button"
              severity="secondary"
              size="small"
              class="special-sku__clear"
              @click="handleClear"
            >
              <i class="pi pi-replay" />
              <span>Clear</span>
            </Button>
          </div>
          <SapSyncingIndicator
            v-if="isSyncing"
            size="sm"
          />
        </div>
      </form>

      <template v-if="result">
        <Divider class="special-sku__divider" />
        <div class="special-sku__result">
          <span class="special-sku__result-label">Special Order SKU</span>
          <span class="special-sku__result-row">
            <span class="special-sku__result-code">{{ result.itemCode }}</span>
            <BaseIconButton
              icon="pi pi-copy"
              label="Copy SKU"
              @click="copySku"
            />
          </span>
        </div>
      </template>
    </div>
  </BasePanel>
</template>

<style scoped>
/* The section's vertical rhythm — fields → actions → divider → generated SKU.
   The divider's own margins are zeroed below, so this gap alone spaces it. */
.special-sku {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-6);
}

.special-sku__message {
    margin: 0;
}

.special-sku__form {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.special-sku__fields {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-3);

    @media (min-width: 768px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--p-spacing-4);
    }
}

/* Lookup + Clear on the left, Syncing indicator pinned bottom-right. */
.special-sku__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--p-spacing-2) var(--p-spacing-3);
}

.special-sku__actions-primary {
    display: flex;
    align-items: center;
    gap: var(--p-spacing-3);
}

.special-sku__lookup.p-button,
.special-sku__clear.p-button {
    display: inline-flex;
    align-items: center;
    gap: var(--p-button-gap);
}

/* AppNavIcon's inline <svg> sizes off the inherited font-size; keep the flex row
   from squeezing it when the label wraps. */
.special-sku__lookup .app-nav-icon-svg {
    flex-shrink: 0;
}

/* Clear: borderless filled-secondary (gray-50) with tideblue-50 hover — matches
   the drawer's secondary action styling. */
.special-sku__clear.p-button {
    border-color: transparent;
    background: var(--p-gray-50);
    color: var(--p-deepblue-900);
}

.special-sku__clear.p-button:hover,
.special-sku__clear.p-button:focus-visible {
    border-color: transparent;
    background: var(--p-tideblue-50);
    color: var(--p-deepblue-900);
}

.special-sku__select-spinner,
.special-sku__lookup-spinner {
    width: var(--p-font-size-base);
    height: var(--p-font-size-base);
}

/* Kill PrimeVue's default divider margins — the flex gap already spaces it. */
.special-sku__divider.p-divider-horizontal {
    margin: 0;
}

/* Special Order SKU — highlighted box with the code + copy affordance. */
.special-sku__result {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-2);
    padding: var(--p-spacing-4);
    border: 1px solid var(--p-skyblue-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-skyblue-50);
}

.special-sku__result-label {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-600);
}

.special-sku__result-row {
    display: inline-flex;
    align-items: center;
    gap: var(--p-spacing-2);
}

.special-sku__result-code {
    font-family: var(--p-mono-family);
    font-size: var(--p-font-size-lg);
    font-weight: var(--p-font-weight-bold);
    color: var(--p-deepblue-900);
}
</style>
