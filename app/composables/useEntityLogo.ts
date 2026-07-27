import type { Ref } from 'vue'

/**
 * Logo select/remove for a record that already exists — customers, suppliers
 * (both `business_partners`) and manufacturers.
 *
 * The three pages used to carry byte-identical copies of an upload → repoint FK →
 * delete-old-file sequence, whose final step silently 403'd for every non-admin
 * (see useFiles.ts). All of that now happens in one server round-trip, so this is
 * just the UI state around it: a processing flag, the responsive <img> sources,
 * and a toast either way.
 *
 * @param collection — which collection owns the record (see LOGO_COLLECTIONS)
 * @param recordId — the record whose logo this is; null while it's still loading
 * @param logoId — the record's current logo file id; kept in step with the server
 */
export function useEntityLogo(
  collection: LogoCollection,
  recordId: Ref<string | number | null>,
  logoId: Ref<string | null>,
) {
  const toast = useToast()
  const { replaceLogo, removeLogo } = useFiles()
  const { getResponsiveSrcset } = useAssetUrl()

  const isLogoProcessing = ref(false)
  const logoSrc = ref<string | null>(null)
  const logoSrcset = ref<string | null>(null)

  watch(logoId, async (fileId) => {
    const responsive = await getResponsiveSrcset(fileId, PROFILE_AVATAR_WIDTHS)
    logoSrc.value = responsive?.src ?? null
    logoSrcset.value = responsive?.srcset ?? null
  })

  async function handleLogoSelect(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file || recordId.value === null) { return }

    isLogoProcessing.value = true
    const { data: fileId, error } = await replaceLogo(file, collection, recordId.value)
    isLogoProcessing.value = false
    // Let the same file be picked again after a failure.
    input.value = ''

    if (error || !fileId) {
      toast.add({ severity: 'error', summary: 'Failed', detail: error?.message || 'Could not update logo.', life: 5000 })
      return
    }

    logoId.value = fileId
    toast.add({ severity: 'success', summary: 'Success', detail: 'Logo updated.', life: 3000 })
  }

  async function handleLogoRemove() {
    if (recordId.value === null) { return }

    isLogoProcessing.value = true
    const { error } = await removeLogo(collection, recordId.value)
    isLogoProcessing.value = false

    if (error) {
      toast.add({ severity: 'error', summary: 'Failed', detail: error.message || 'Could not remove logo.', life: 5000 })
      return
    }

    logoId.value = null
    toast.add({ severity: 'success', summary: 'Success', detail: 'Logo removed.', life: 3000 })
  }

  return {
    isLogoProcessing,
    logoSrc,
    logoSrcset,
    handleLogoSelect,
    handleLogoRemove,
  }
}
