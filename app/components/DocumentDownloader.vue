<script setup lang="ts">
const { downloadDocument, openDocument } = useDocumentDownload()
const { fetchDocumentByNumber } = useLooker()
const toast = useToast()

interface DocumentTypeOption {
  label: string
  // The render service template (see server/api/documents/render.post.ts).
  value: string
  // Human-friendly token used when naming the downloaded file.
  fileLabel: string
}

// Ordered to follow the SAP transactional flow — quote → order → down payment →
// pick/pack → ship → invoice → return → credit memo — rather than alphabetically,
// so the list reads in the order a user works through a sale. Purchase Order sits
// last: it is the one document that isn't part of that sales chain.
const documentTypes: DocumentTypeOption[] = [
  { label: 'Sales Quote', value: 'sales-quotes', fileLabel: 'Quote' },
  { label: 'Sales Order', value: 'sales-orders', fileLabel: 'Order' },
  { label: 'A/R Down Payment Invoice', value: 'sales-dpinvoices', fileLabel: 'DownPayment' },
  { label: 'Packing Slip', value: 'sales-packingslip', fileLabel: 'PackingSlip' },
  { label: 'Shipment Notification', value: 'sales-deliveries', fileLabel: 'Delivery' },
  { label: 'A/R Invoice', value: 'sales-invoices', fileLabel: 'Invoice' },
  { label: 'Return Request', value: 'return-requests', fileLabel: 'Return' },
  { label: 'A/R Credit Memo', value: 'sales-creditmemo', fileLabel: 'CreditMemo' },
  { label: 'Purchase Order', value: 'purchase-orders', fileLabel: 'PurchaseOrder' },
]

type DocumentAction = 'download' | 'open'

const template = ref<string | null>(null)
const documentNumber = ref('')
const submitted = ref(false)
// Which button is mid-flight. Covers the whole operation — resolving the number
// and then rendering the PDF — so a slow lookup shows a spinner too.
const pendingAction = ref<DocumentAction | null>(null)

const selectedType = computed(() =>
  documentTypes.find(option => option.value === template.value) || null,
)

const templateError = computed(() =>
  submitted.value && !template.value ? 'Document type is required.' : '',
)
const documentNumberError = computed(() =>
  submitted.value && !documentNumber.value.trim() ? 'Document number is required.' : '',
)

const isDownloading = computed(() => pendingAction.value === 'download')
const isOpening = computed(() => pendingAction.value === 'open')

// Typing a new number invalidates the previous attempt's validation message.
watch([template, documentNumber], () => {
  submitted.value = false
})

function notifyLookupFailure(typedNumber: string, error: unknown) {
  const statusCode = (error as { statusCode?: number, status?: number } | null)?.statusCode
    ?? (error as { statusCode?: number, status?: number } | null)?.status
  const detail = (error as { data?: { statusMessage?: string } } | null)?.data?.statusMessage
    ?? (error as { statusMessage?: string } | null)?.statusMessage

  // 404 is the expected "no such document" answer and gets a plain message;
  // anything else surfaces what the API actually said.
  toast.add({
    severity: 'error',
    summary: statusCode === 404 ? 'Document not found' : 'Lookup failed',
    detail: statusCode === 404
      ? `No ${selectedType.value?.label.toLowerCase() ?? 'document'} found with number ${typedNumber}.`
      : detail || 'Could not look up that document number. Please try again.',
    life: 4000,
  })
}

async function handleAction(action: DocumentAction, viewer: Window | null = null) {
  submitted.value = true

  const type = selectedType.value
  const typedNumber = documentNumber.value.trim()
  if (!type || !typedNumber || pendingAction.value) {
    viewer?.close()
    return
  }

  pendingAction.value = action
  const { data, error } = await fetchDocumentByNumber(type.value, typedNumber)

  if (error || !data) {
    pendingAction.value = null
    viewer?.close()
    notifyLookupFailure(typedNumber, error)
    return
  }

  const renderInput = {
    template: type.value,
    docEntry: data.docEntry,
    filename: buildDocumentFilename(data.number, type.fileLabel),
  }

  if (action === 'download') {
    await downloadDocument(renderInput)
  } else {
    await openDocument(renderInput, viewer)
  }
  pendingAction.value = null
}

function handleDownload() {
  handleAction('download')
}

function handleOpen() {
  // Reserved synchronously, before any await, so the popup blocker allows it.
  handleAction('open', window.open('', '_blank'))
}
</script>

<template>
  <BasePanel title="Download Document">
    <div class="document-downloader">
      <form
        class="document-downloader__form"
        autocomplete="off"
        @submit.prevent="handleDownload"
      >
        <div class="document-downloader__fields">
          <div class="form-field">
            <label
              for="document-downloader-type"
              class="form-field__label form-field__label--required"
            >
              Document Type
            </label>
            <Select
              id="document-downloader-type"
              v-model="template"
              :options="documentTypes"
              option-label="label"
              option-value="value"
              placeholder="Select document type"
              :invalid="Boolean(templateError)"
            />
            <small
              v-if="templateError"
              class="form-field__error"
            >
              {{ templateError }}
            </small>
          </div>

          <div class="form-field">
            <label
              for="document-downloader-number"
              class="form-field__label form-field__label--required"
            >
              Document Number
            </label>
            <InputText
              id="document-downloader-number"
              v-model="documentNumber"
              placeholder="Enter or paste a document number"
              :invalid="Boolean(documentNumberError)"
            />
            <small
              v-if="documentNumberError"
              class="form-field__error"
            >
              {{ documentNumberError }}
            </small>
          </div>
        </div>

        <div class="document-downloader__actions">
          <Button
            type="submit"
            size="small"
            :disabled="Boolean(pendingAction)"
          >
            <BaseSpinner
              v-if="isDownloading"
              size="sm"
              class="document-downloader__action-spinner"
            />
            <i
              v-else
              class="pi pi-download"
            />
            <span>Download</span>
          </Button>
          <Button
            type="button"
            severity="secondary"
            outlined
            size="small"
            class="document-downloader__open-btn"
            :disabled="Boolean(pendingAction)"
            @click="handleOpen"
          >
            <BaseSpinner
              v-if="isOpening"
              size="sm"
              class="document-downloader__action-spinner"
            />
            <i
              v-else
              class="pi pi-external-link"
            />
            <span>Open</span>
          </Button>
        </div>
      </form>
    </div>
  </BasePanel>
</template>

<style scoped>
.document-downloader {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.document-downloader__form {
    display: flex;
    flex-direction: column;
    gap: var(--p-spacing-4);
}

.document-downloader__fields {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--p-spacing-3);

    @media (min-width: 768px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--p-spacing-4);
    }
}

.document-downloader__actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: var(--p-spacing-3);
}

.document-downloader__action-spinner {
    width: var(--p-font-size-base);
    height: var(--p-font-size-base);
}

/* Gray "cancel"-style secondary button, matching the drawer cancel pattern. */
:deep(.document-downloader__open-btn.p-button-outlined) {
    border-color: transparent;
    background: var(--p-surface-50);
}
</style>
