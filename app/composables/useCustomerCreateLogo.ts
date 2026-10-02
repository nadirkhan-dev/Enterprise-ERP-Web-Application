import type { Ref } from 'vue'

interface LogoForm {
  logoFileId: string | null
}

/**
 * Logo upload/preview/cleanup for the create-customer and create-supplier flows.
 *
 * The record doesn't exist yet, so the file is *staged*: uploaded up front (to
 * show a preview and to have an id ready for the create payload) and left
 * dangling until save. Anything that abandons it — re-picking a logo, or leaving
 * the form without saving — has to throw the staged file away, or it is orphaned
 * in Directus with nothing pointing at it.
 *
 * That discard runs through the server route: users have no `delete` on
 * `directus_files`, so the browser cannot do it (see useFiles.ts).
 */
export function useCustomerCreateLogo(
  form: LogoForm,
  saveCompleted: Ref<boolean>,
) {
  const toast = useToast()
  const { stageLogo, discardStagedLogo } = useFiles()

  const logoPreviewUrl = ref<string | null>(null)

  async function handleFileSelect(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) { return }

    // Picking a second logo abandons the first — throw it away before it's
    // forgotten about.
    if (form.logoFileId) {
      const { error: discardError } = await discardStagedLogo(form.logoFileId)
      if (discardError) {
        console.error('Failed to discard the previous logo:', discardError.message)
      }
      form.logoFileId = null
    }

    if (logoPreviewUrl.value) {
      URL.revokeObjectURL(logoPreviewUrl.value)
      logoPreviewUrl.value = null
    }

    const { data: fileId, error: uploadError } = await stageLogo(file, LOGO_COLLECTIONS.businessPartners)
    if (uploadError || !fileId) {
      toast.add({ severity: 'error', summary: 'Failed', detail: uploadError?.message || 'Could not upload logo.', life: 5000 })
      return
    }

    form.logoFileId = fileId
    logoPreviewUrl.value = URL.createObjectURL(file)

    input.value = ''
  }

  onBeforeUnmount(() => {
    if (logoPreviewUrl.value) {
      URL.revokeObjectURL(logoPreviewUrl.value)
    }

    // Left the form without saving: the upload has no record to belong to.
    if (form.logoFileId && !saveCompleted.value) {
      discardStagedLogo(form.logoFileId).then(({ error: discardError }) => {
        if (discardError) {
          console.error('Failed to clean up the orphaned logo:', discardError.message)
        }
      })
    }
  })

  return {
    logoPreviewUrl,
    handleFileSelect,
  }
}
