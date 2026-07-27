<script setup lang="ts">
import { SquareTokenizeError } from '~/composables/useSquareWebPayments'
import type { SquareBillingAddressPayload } from '~/composables/useSquare'

interface Props {
  visible?: boolean
  referenceId?: string | null
  contacts?: Record<string, any>[]
  addresses?: Record<string, any>[]
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  referenceId: null,
  contacts: () => [],
  addresses: () => [],
})
const emit = defineEmits<{
  'update:visible': [value: boolean]
  saved: []
}>()

const toast = useToast()
const { createCustomerCard } = useSquare()

const isSaving = ref(false)
const submitted = ref(false)
const cardError = ref('')
const cardContainerRef = ref<HTMLElement | null>(null)
let cardController: ReturnType<typeof useSquareWebPayments> | null = null
const isCardReady = ref(false)
const cardInitError = ref('')

const errors = reactive({
  cardholderName: '',
  billingAddress: '',
})

const localVisible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val),
})

const contactOptions = computed(() => props.contacts.map((contact) => ({
  label: contact.name,
  value: contact.id,
})))

const addressOptions = computed(() => props.addresses.map((addr) => ({
  label: [addr.street, addr.city, addr.state].filter(Boolean).join(', '),
  value: addr.id,
})))

const form = reactive({
  cardholderName: null as number | null,
  billingAddress: null as number | null,
})
useClearErrorsOnEdit(form, errors)

const selectedContact = computed(() =>
  props.contacts.find((contact) => contact.id === form.cardholderName) || null,
)
const selectedAddress = computed(() =>
  props.addresses.find((addr) => addr.id === form.billingAddress) || null,
)

watch(
  () => form.cardholderName,
  (contactId) => {
    // Clear the validation error as soon as a cardholder is selected.
    if (contactId) { errors.cardholderName = '' }
    if (!contactId) {return}
    const contact = props.contacts.find((c) => c.id === contactId)
    if (!contact?.addressJunctionId) {return}
    const matchingAddress = props.addresses.find((addr) => addr.id === contact.addressJunctionId)
    if (matchingAddress) {
      form.billingAddress = matchingAddress.id
    }
  },
)

watch(
  () => form.billingAddress,
  (addressId) => {
    // Clear the validation error as soon as a billing address is selected.
    if (addressId) { errors.billingAddress = '' }
  },
)

// The card inputs render inside Square's cross-origin iframe, so they can't
// read our CSS variables. Resolve the design tokens to concrete values and
// hand Square a style object so the hosted field matches the rest of the form.
function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') { return fallback }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function buildSquareCardStyle(): Record<string, unknown> {
  return {
    input: {
      color: readToken('--p-deepblue-900', '#1c3c70'),
      // Square's iframe requires px (it rejects rem) and only allows fonts from
      // its own allowlist — our self-hosted "TT Norms Pro" can't be applied
      // inside the iframe, so fontFamily is intentionally omitted.
      fontSize: '14px',
      backgroundColor: 'transparent',
    },
    'input::placeholder': {
      color: readToken('--p-form-field-placeholder-color', '#94a3b8'),
    },
    '.input-container': {
      borderColor: readToken('--p-surface-200', '#d4d6d8'),
      // borderRadius is only valid on the base .input-container (Square rejects
      // it on the .is-focus/.is-error state selectors); it carries to those
      // states automatically, matching the 2px crop radius and avoiding a
      // thick corner notch on focus.
      borderRadius: readToken('--p-border-radius-xs', '2px'),
    },
    '.input-container.is-focus': {
      borderColor: readToken('--p-primary-color', '#009bd4'),
    },
    '.input-container.is-error': {
      borderColor: readToken('--p-red-400', '#ff2b12'),
    },
    '.message-text': {
      color: readToken('--p-text-muted-color', '#64748b'),
    },
    '.message-icon': {
      color: readToken('--p-text-muted-color', '#64748b'),
    },
    '.message-text.is-error': {
      color: readToken('--p-red-400', '#ff2b12'),
    },
    '.message-icon.is-error': {
      color: readToken('--p-red-400', '#ff2b12'),
    },
  }
}

async function initializeCardElement() {
  cardInitError.value = ''
  isCardReady.value = false
  try {
    cardController = useSquareWebPayments()
    await nextTick()
    if (!cardContainerRef.value) {
      throw new Error('Card container is not mounted')
    }
    await cardController.attach(cardContainerRef.value, buildSquareCardStyle())
    isCardReady.value = true
  } catch (initError) {
    cardController = null
    cardInitError.value = (initError as Error).message || 'Failed to load Square card form'
    console.error('Failed to initialize Square card element:', initError)
  }
}

async function teardownCardElement() {
  if (cardController) {
    await cardController.destroy()
    cardController = null
  }
  isCardReady.value = false
}

// Tracks unsaved changes on the cardholder/billing selects. The card number
// itself lives in Square's cross-origin iframe and cannot be read, so it can't
// contribute to the dirty check — the selects are the only readable state.
const {
  isDirty,
  showResumePrompt,
  markClosedAnyway,
  continueEditing,
  discardResume,
  markSaved,
} = useDrawerResumeGuard({
  isOpen: localVisible,
  recordKey: () => props.referenceId,
  snapshot: () => ({ ...form }),
  // Only the readable selects are populated. The Square iframe setup is a
  // side effect kept in the watch below so it still runs when resuming edits.
  populate: () => {
    form.cardholderName = null
    form.billingAddress = null
  },
})

// Square's hosted card iframe + transient validation state — must run on every
// open/close (including resume), so it lives outside the resume guard's populate().
watch(
  () => props.visible,
  async (isOpen) => {
    if (isOpen) {
      submitted.value = false
      errors.cardholderName = ''
      errors.billingAddress = ''
      cardError.value = ''
      await initializeCardElement()
    } else {
      await teardownCardElement()
    }
  },
)

onBeforeUnmount(() => {
  teardownCardElement()
})

function validateForm() {
  const requiredRule = { required: true }
  errors.cardholderName = validateField(form.cardholderName, requiredRule)
  errors.billingAddress = validateField(form.billingAddress, requiredRule)
  return !errors.cardholderName && !errors.billingAddress
}

function buildBillingAddress(): SquareBillingAddressPayload | null {
  const addr = selectedAddress.value
  if (!addr) {return null}
  const payload: SquareBillingAddressPayload = {}
  if (addr.street) {payload.address_line_1 = addr.street}
  if (addr.unitSuite) {payload.address_line_2 = addr.unitSuite}
  if (addr.city) {payload.locality = addr.city}
  if (addr.state) {payload.administrative_district_level_1 = addr.state}
  if (addr.country) {payload.country = addr.country}
  // postal_code is intentionally omitted — Square's iframe collects its own
  // postal field for AVS, and providing a different value here triggers a
  // generic INVALID_CARD_DATA rejection.
  return Object.keys(payload).length ? payload : null
}

async function onSave() {
  submitted.value = true
  cardError.value = ''

  if (!validateForm()) {return}
  if (!props.referenceId) {
    cardError.value = 'Customer reference ID is missing'
    return
  }
  if (!cardController || !isCardReady.value) {
    cardError.value = cardInitError.value || 'Card form is not ready yet'
    return
  }
  const contact = selectedContact.value
  if (!contact) {
    cardError.value = 'Selected cardholder not found'
    return
  }

  isSaving.value = true
  let nonce: string
  try {
    nonce = await cardController.tokenize()
  } catch (tokenizeError) {
    isSaving.value = false
    if (tokenizeError instanceof SquareTokenizeError) {
      cardError.value = tokenizeError.details.map((detail) => detail.message).join(' • ')
    } else {
      cardError.value = (tokenizeError as Error).message || 'Failed to read card'
    }
    return
  }

  const { data, error } = await createCustomerCard({
    referenceId: props.referenceId,
    nonce,
    cardholderName: contact.name,
    contactEmail: contact.email || null,
    billingAddress: buildBillingAddress(),
  })

  isSaving.value = false

  if (error) {
    cardError.value = (error as any)?.data?.statusMessage || error.message || 'Failed to save card'
    return
  }

  toast.add({
    severity: 'success',
    summary: 'Success',
    detail: data?.createdNewCustomer
      ? 'Card saved (new Square contact created)'
      : 'Card saved to Square',
    life: 3000,
  })
  markSaved()
  emit('saved')
  localVisible.value = false
}

function onCancel() {
  localVisible.value = false
}
</script>

<template>
  <BaseDrawer
    v-model:visible="localVisible"
    title="Credit Card"
    body-gap="5"
    :dirty="isDirty"
    :busy="isSaving"
    :show-resume-prompt="showResumePrompt"
    @save="onSave"
    @close-anyway="markClosedAnyway"
    @resume="continueEditing"
    @resume-discard="discardResume"
  >
    <div class="form-field">
      <label class="form-field__label">Cardholder Name</label>
      <Select
        v-model="form.cardholderName"
        :options="contactOptions"
        option-label="label"
        option-value="value"
        placeholder="Search Customer Contacts"
        filter
        fluid
        panel-class="address-select-panel"
        :invalid="submitted && !!errors.cardholderName"
      />
      <span
        v-if="submitted && errors.cardholderName"
        class="form-field__error"
      >{{ errors.cardholderName }}</span>
    </div>

    <div class="form-field">
      <label class="form-field__label">Card Billing Address</label>
      <Select
        v-model="form.billingAddress"
        :options="addressOptions"
        option-label="label"
        option-value="value"
        placeholder="Select billing address"
        filter
        fluid
        panel-class="address-select-panel"
        :invalid="submitted && !!errors.billingAddress"
      />
      <span
        v-if="submitted && errors.billingAddress"
        class="form-field__error"
      >{{ errors.billingAddress }}</span>
    </div>

    <div class="form-field">
      <label class="form-field__label">Card Information</label>
      <div class="square-card-field">
        <div
          ref="cardContainerRef"
          class="square-card-container"
          :class="{ 'square-card-container--ready': isCardReady }"
        />
        <div
          v-if="!isCardReady && !cardInitError"
          class="square-card-loading"
        >
          <BaseSpinner size="sm" />
          <span class="square-card-loading__text">Loading secure card form…</span>
        </div>
      </div>
      <span
        v-if="cardInitError"
        class="form-field__error"
      >{{ cardInitError }}</span>
      <span
        v-if="cardError"
        class="form-field__error"
      >{{ cardError }}</span>
    </div>

    <template #footer>
      <BaseActionButtons
        save-label="Add"
        :save-loading="isSaving"
        :save-disabled="isSaving || !isCardReady"
        @save="onSave"
        @cancel="onCancel"
      />
    </template>
  </BaseDrawer>
</template>

<style scoped>
/* Before Square's hosted field mounts, show a placeholder box that matches the
   other form fields so the layout doesn't jump. */
.square-card-container:not(.square-card-container--ready) {
    min-height: var(--p-spacing-12);
    padding: var(--p-spacing-2) var(--p-spacing-3);
    border: 1px solid var(--p-surface-200);
    border-radius: var(--p-border-radius-xs);
    background: var(--p-form-field-background);
}

/* Once mounted, Square draws its own (token-themed) bordered field, so our
   wrapper becomes a transparent mount point — otherwise the two borders stack
   into a doubled outline. */
.square-card-container :deep(.sq-card-wrapper) {
    width: 100%;
}

/* Square sizes the iframe at a fixed ~97px with the input row pinned to the
   top, leaving dead space below. Clamp it to a single-row height to remove
   that gap. Adjust the height value if Square clips its field border. */
.square-card-container :deep(.sq-card-iframe-container) {
    width: 100% !important;
    height: var(--p-spacing-12) !important;
    border-radius: var(--p-border-radius-xs) !important;
    overflow: hidden !important;
}

.square-card-container :deep(.sq-card-component) {
    height: var(--p-spacing-12) !important;
    border-radius: var(--p-border-radius-xs) !important;
}

/* Square's external message span (validation errors shown below the field). */
.square-card-container :deep(.sq-card-message) {
    margin-top: var(--p-spacing-1) !important;
    font-size: var(--p-font-size-sm) !important;
    color: var(--p-text-muted-color) !important;
}

/* Loading state: spinner + label centered over the placeholder box while
   Square's hosted field mounts. */
.square-card-field {
    position: relative;
}

.square-card-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--p-spacing-2);
    pointer-events: none;
}

.square-card-loading__text {
    font-size: var(--p-font-size-sm);
    color: var(--p-text-muted-color);
}
</style>
