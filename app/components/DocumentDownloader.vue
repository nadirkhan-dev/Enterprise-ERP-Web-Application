<script lang="ts">
import type { DocumentSummary } from '~/composables/useLooker'

interface DocumentOption {
  label: string
  // The DocEntry passed to the render service.
  value: string
  number: string | number
}

// Document lists fetched per type, cached for the app session. Module scope so
// the cache survives leaving and returning to the dashboard — it only clears on
// a hard page refresh. Lets switching types (or returning later) skip the API.
const documentCache = new Map<string, DocumentOption[]>()
</script>

<script setup lang="ts">
const { downloadDocument, openDocument, isActionPending } = useDocumentDownload()
const { fetchDocumentsByType } = useLooker()
const toast = useToast()

interface DocumentTypeOption {
  label: string
  // The render service template (see server/api/documents/render.post.ts).
  value: string
  // Human-friendly token used when naming the downloaded file.
  fileLabel: string
}

// Only document types whose Looker rows carry a DocEntry can be rendered — that
// excludes shipments/deliveries, which the shipments tile returns without one.
const documentTypes: DocumentTypeOption[] = [
  { label: 'Sales Quote', value: 'sales-quotes', fileLabel: 'Quote' },
  { label: 'Sales Order', value: 'sales-orders', fileLabel: 'Order' },
  { label: 'Sales Invoice', value: 'sales-invoices', fileLabel: 'Invoice' },
  { label: 'Purchase Order', value: 'purchase-orders', fileLabel: 'PurchaseOrder' },
]

const template = ref<string | null>(null)
const documents = ref<DocumentOption[]>([])
const isLoadingDocuments = ref(false)
const docEntry = ref<string | null>(null)
const submitted = ref(false)

const selectedType = computed(() =>
  documentTypes.find(option => option.value === template.value) || null,
)
const selectedDocument = computed(() =>
  documents.value.find(option => option.value === docEntry.value) || null,
)

const templateError = computed(() =>
  submitted.value && !template.value ? 'Document type is required.' : '',
)
const docEntryError = computed(() =>
  submitted.value && !docEntry.value ? 'Document is required.' : '',
)

const canSubmit = computed(() =>
  Boolean(template.value && docEntry.value),
)

// Tracked per action, so each button reflects (and disables on) only its own
// action — Download and Open can run at the same time.
const isDownloading = computed(() => isActionPending(docEntry.value ?? '', 'download'))
const isOpening = computed(() => isActionPending(docEntry.value ?? '', 'open'))

const showNoDocuments = computed(
  () => Boolean(template.value) && !isLoadingDocuments.value && documents.value.length === 0,
)

const documentPlaceholder = computed(() => {
  if (!template.value) { return 'Select a document type first' }
  if (isLoadingDocuments.value) { return 'Loading documents…' }
  return 'Select a document'
})

// Picking a document type loads every document of that type. Clear any prior
// validation so the document field shows a clean loading state rather than a
// lingering "required" error from an earlier empty submit.
watch(template, () => {
  submitted.value = false
  loadDocuments()
})

async function loadDocuments() {
  documents.value = []
  docEntry.value = null

  const type = selectedType.value
  if (!type) {
    return
  }

  // Reuse a previously fetched list for this type — no second API call until a
  // hard refresh clears the cache.
  const cached = documentCache.get(type.value)
  if (cached) {
    documents.value = cached
    return
  }

  isLoadingDocuments.value = true
  const { data, error } = await fetchDocumentsByType(type.value)
  isLoadingDocuments.value = false

  // Guard against a stale response: the user may have switched type while this
  // request was in flight.
  if (selectedType.value?.value !== type.value) {
    return
  }

  if (error) {
    toast.add({
      severity: 'error',
      summary: 'Documents unavailable',
      detail: `Could not load ${type.label.toLowerCase()}s. Please try again.`,
      life: 4000,
    })
    return
  }

  const mapped = (data ?? []).map((document: DocumentSummary) => ({
    label: `#${document.number}`,
    value: String(document.docEntry),
    number: document.number,
  }))
  documentCache.set(type.value, mapped)
  documents.value = mapped
}

function buildRenderInput() {
  const type = selectedType.value
  const document = selectedDocument.value
  if (!type || !document) {
    return null
  }

  return {
    template: type.value,
    docEntry: document.value,
    filename: buildDocumentFilename(document.number, type.fileLabel),
  }
}

function handleDownload() {
  submitted.value = true
  const renderInput = buildRenderInput()
  if (!renderInput || !canSubmit.value) {
    return
  }
  downloadDocument(renderInput)
}

function handleOpen() {
  submitted.value = true
  const renderInput = buildRenderInput()
  if (!renderInput || !canSubmit.value) {
    return
  }
  openDocument(renderInput)
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
              for="document-downloader-id"
              class="form-field__label form-field__label--required"
            >
              Document
            </label>
            <Select
              id="document-downloader-id"
              v-model="docEntry"
              :options="documents"
              option-label="label"
              option-value="value"
              :placeholder="documentPlaceholder"
              :disabled="!template || documents.length === 0"
              :loading="isLoadingDocuments"
              filter
              :virtual-scroller-options="{ itemSize: 38 }"
              :invalid="Boolean(docEntryError)"
            >
              <template #loadingicon>
                <BaseSpinner size="sm" class="document-downloader__select-spinner" />
              </template>
            </Select>
            <small
              v-if="docEntryError"
              class="form-field__error"
            >
              {{ docEntryError }}
            </small>
            <small
              v-else-if="showNoDocuments"
              class="document-downloader__empty"
            >
              No documents found for this type.
            </small>
          </div>
        </div>

        <div class="document-downloader__actions">
          <Button
            type="submit"
            size="small"
            :disabled="isDownloading"
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
            :disabled="isOpening"
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

.document-downloader__select-spinner {
    width: var(--p-font-size-base);
    height: var(--p-font-size-base);
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

.document-downloader__empty {
    font-size: var(--p-font-size-sm);
    color: var(--p-gray-600);
}
</style>
