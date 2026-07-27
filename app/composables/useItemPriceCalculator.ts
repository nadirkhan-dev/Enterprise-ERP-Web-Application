import type { InputNumberInputEvent } from 'primevue/inputnumber'

export type PriceField = 'baseCost' | 'offerPrice' | 'grossMargin'

export type PriceCalculatorTarget = {
  baseCost: string
  offerPrice: string
  grossMargin: string
}

function formatCurrency(value: number | null) {
  if (value === null) return '—'
  // Match the stat-card currency style (app/utils/formatCurrency): thousands
  // separators on every value beyond 3 digits, so the calculator reads
  // consistently with the page's other money values ($1,267.38, not $1267.38).
  return `$${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function calculateMargin(cost: number | null, price: number | null) {
  if (cost === null || price === null || Number(price) === 0) return '—'
  const margin = ((Number(price) - Number(cost)) / Number(price)) * 100
  return `${margin.toFixed(1)}%`
}

export function useItemPriceCalculator(target: PriceCalculatorTarget) {
  const rawBaseCost = ref<number | null>(null)
  const rawOfferPrice = ref<number | null>(null)
  // Snapshots = original (page-load) raw values — % delta is always measured from these.
  const snapshotBaseCost = ref<number | null>(null)
  const snapshotOfferPrice = ref<number | null>(null)
  // Originals — kept as the "before" reference in the header until refresh.
  const originalBaseCostDisplay = ref<string>('—')
  const originalOfferPriceDisplay = ref<string>('—')
  const originalGrossMarginDisplay = ref<string>('—')

  const editingField = ref<PriceField | null>(null)
  const editDollarValue = ref<number | null>(null)
  const editPercentValue = ref<number | null>(null)
  const editorRef = ref<HTMLElement | null>(null)

  const isBaseCostValid = computed(() => rawBaseCost.value !== null && !isNaN(Number(rawBaseCost.value)))
  const isOfferPriceValid = computed(() => rawOfferPrice.value !== null && !isNaN(Number(rawOfferPrice.value)))
  const isGrossMarginValid = computed(() => isBaseCostValid.value && isOfferPriceValid.value)

  function recalcGrossMargin(cost: number | null, price: number | null) {
    if (cost === null || price === null || Number(price) === 0) return
    const margin = ((Number(price) - Number(cost)) / Number(price)) * 100
    target.grossMargin = `${margin.toFixed(1)}%`
  }

  function openCalculator(field: PriceField) {
    editingField.value = field
    if (field === 'baseCost') {
      editDollarValue.value = rawBaseCost.value
      const original = Number(snapshotBaseCost.value)
      editPercentValue.value = original !== 0
        ? Math.round(((Number(rawBaseCost.value) - original) / original) * 1000) / 10
        : 0
    } else if (field === 'offerPrice') {
      editDollarValue.value = rawOfferPrice.value
      const original = Number(snapshotOfferPrice.value)
      editPercentValue.value = original !== 0
        ? Math.round(((Number(rawOfferPrice.value) - original) / original) * 1000) / 10
        : 0
    } else {
      const margin = Number(rawOfferPrice.value) !== 0
        ? ((Number(rawOfferPrice.value) - Number(rawBaseCost.value)) / Number(rawOfferPrice.value)) * 100
        : 0
      editDollarValue.value = null
      editPercentValue.value = Math.round(margin * 10) / 10
    }
  }

  function closeCalculator() {
    if (!editingField.value) return
    editingField.value = null
    editDollarValue.value = null
    editPercentValue.value = null
  }

  function onDollarInput(value: number | null) {
    editDollarValue.value = value
    if (value === null) return

    if (editingField.value === 'baseCost') {
      const originalCost = Number(snapshotBaseCost.value)
      editPercentValue.value = originalCost !== 0
        ? Math.round(((value - originalCost) / originalCost) * 1000) / 10
        : 0
      rawBaseCost.value = value
      target.baseCost = formatCurrency(value)
      recalcGrossMargin(value, rawOfferPrice.value)
    } else if (editingField.value === 'offerPrice') {
      const originalPrice = Number(snapshotOfferPrice.value)
      editPercentValue.value = originalPrice !== 0
        ? Math.round(((value - originalPrice) / originalPrice) * 1000) / 10
        : 0
      rawOfferPrice.value = value
      target.offerPrice = formatCurrency(value)
      recalcGrossMargin(rawBaseCost.value, value)
    }
  }

  function onPercentInput(value: number | null) {
    editPercentValue.value = value
    if (editingField.value === 'baseCost') {
      const newCost = Math.round(Number(snapshotBaseCost.value) * (1 + (value || 0) / 100) * 100) / 100
      editDollarValue.value = newCost
      rawBaseCost.value = newCost
      target.baseCost = formatCurrency(newCost)
      recalcGrossMargin(newCost, rawOfferPrice.value)
    } else if (editingField.value === 'offerPrice') {
      const newPrice = Math.round(Number(snapshotOfferPrice.value) * (1 + (value || 0) / 100) * 100) / 100
      editDollarValue.value = newPrice
      rawOfferPrice.value = newPrice
      target.offerPrice = formatCurrency(newPrice)
      recalcGrossMargin(rawBaseCost.value, newPrice)
    } else if (editingField.value === 'grossMargin') {
      const marginDecimal = (value || 0) / 100
      if (marginDecimal === 1) return
      const newOfferPrice = Math.round(Number(rawBaseCost.value) / (1 - marginDecimal) * 100) / 100
      rawOfferPrice.value = newOfferPrice
      target.offerPrice = formatCurrency(newOfferPrice)
      target.grossMargin = `${(value || 0).toFixed(1)}%`
    }
  }

  function onDollarInputEvent(event: InputNumberInputEvent) {
    onDollarInput(event.value === null || event.value === undefined ? null : Number(event.value))
  }

  function onPercentInputEvent(event: InputNumberInputEvent) {
    onPercentInput(event.value === null || event.value === undefined ? null : Number(event.value))
  }

  function applyPricingSnapshot(baseCost: number | null, offerPrice: number | null, grossMargin: number | null = null) {
    rawBaseCost.value = baseCost
    rawOfferPrice.value = offerPrice
    snapshotBaseCost.value = baseCost
    snapshotOfferPrice.value = offerPrice
    target.baseCost = formatCurrency(baseCost)
    target.offerPrice = formatCurrency(offerPrice)
    // Prefer Looker's authoritative gross margin (`item_price.c_gross_margin`, a
    // decimal fraction) when provided; otherwise derive it from cost/price. Live
    // edits in the calculator still recompute via recalcGrossMargin().
    target.grossMargin = grossMargin !== null
      ? `${(Number(grossMargin) * 100).toFixed(1)}%`
      : calculateMargin(baseCost, offerPrice)
    originalBaseCostDisplay.value = target.baseCost
    originalOfferPriceDisplay.value = target.offerPrice
    originalGrossMarginDisplay.value = target.grossMargin
  }

  function handleClickOutside(event: MouseEvent) {
    if (!editingField.value) return
    if (editorRef.value && editorRef.value.contains(event.target as Node)) return
    const inlineEditor = (event.target as HTMLElement).closest('.price-stat__editor-inline')
    if (inlineEditor) return
    const dropdownEditor = (event.target as HTMLElement).closest('.price-stat__dropdown-inputs')
    if (dropdownEditor) return
    const calcIcon = (event.target as HTMLElement).closest('.price-stat__calc-icon')
    if (calcIcon) return
    closeCalculator()
  }

  onMounted(() => {
    document.addEventListener('click', handleClickOutside, true)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', handleClickOutside, true)
  })

  return {
    rawBaseCost,
    rawOfferPrice,
    snapshotBaseCost,
    snapshotOfferPrice,
    originalBaseCostDisplay,
    originalOfferPriceDisplay,
    originalGrossMarginDisplay,
    editingField,
    editDollarValue,
    editPercentValue,
    editorRef,
    isBaseCostValid,
    isOfferPriceValid,
    isGrossMarginValid,
    openCalculator,
    closeCalculator,
    onDollarInput,
    onPercentInput,
    onDollarInputEvent,
    onPercentInputEvent,
    applyPricingSnapshot,
    formatCurrency,
    calculateMargin,
  }
}
