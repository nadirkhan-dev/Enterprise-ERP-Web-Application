import type { TryCatchResult } from '~/types/api'

/**
 * Logo files, via the Nuxt server routes — NOT the Directus SDK.
 *
 * Uploads and FK repoints could happen straight from the browser, but deletes
 * cannot: CONNECT team members hold only `create` + `read` on `directus_files`,
 * so a client-side cleanup of the file a logo just moved away from silently 403s
 * and the file is orphaned in Directus forever. `/api/files/logo` does the whole
 * replacement in one transaction — uploading as the user (honest `uploaded_by`),
 * repointing the FK as the user, and destroying the superseded file with service
 * credentials the browser doesn't have.
 *
 * See `server/utils/logoFiles.ts` for the collection whitelist and the rules.
 */

// Collections that own a logo. Mirrors LOGO_TARGETS in server/utils/logoFiles.ts;
// anything else is rejected by the route.
export const LOGO_COLLECTIONS = {
  businessPartners: 'business_partners',
  manufacturers: 'manufacturers',
} as const

export type LogoCollection = (typeof LOGO_COLLECTIONS)[keyof typeof LOGO_COLLECTIONS]

export function useFiles() {
  const directus = useDirectus()

  // The routes act on the caller's behalf (upload attribution, record-level
  // permissions), so they need the user's own Directus token — same pattern as
  // useShippingEstimates().
  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const token = await directus.getToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  function buildFormData(file: File, collection: LogoCollection, recordId: string | number | null) {
    const formData = new FormData()
    formData.append('collection', collection)
    if (recordId !== null && recordId !== undefined) {
      formData.append('recordId', String(recordId))
    }
    formData.append('file', file)
    return formData
  }

  /**
   * Upload a logo and attach it to an existing record, replacing whatever was
   * there. The superseded file is deleted server-side.
   *
   * @returns the new file's id
   */
  async function replaceLogo(
    file: File,
    collection: LogoCollection,
    recordId: string | number,
  ): Promise<TryCatchResult<string>> {
    const { data, error } = await tryCatch(
      $fetch<{ fileId: string }>('/api/files/logo', {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: buildFormData(file, collection, recordId),
      }),
    )
    return { data: data?.fileId ?? null, error }
  }

  /**
   * Upload a logo for a record that doesn't exist yet (the create flows). The
   * file is left dangling until the record is saved with its id — or until
   * `discardStagedLogo` throws it away.
   *
   * @returns the new file's id
   */
  async function stageLogo(
    file: File,
    collection: LogoCollection,
  ): Promise<TryCatchResult<string>> {
    const { data, error } = await tryCatch(
      $fetch<{ fileId: string }>('/api/files/logo', {
        method: 'POST',
        headers: await buildAuthHeaders(),
        body: buildFormData(file, collection, null),
      }),
    )
    return { data: data?.fileId ?? null, error }
  }

  /** Clear a record's logo and delete the file it pointed at. */
  async function removeLogo(
    collection: LogoCollection,
    recordId: string | number,
  ): Promise<TryCatchResult<{ ok: true }>> {
    return await tryCatch(
      $fetch<{ ok: true }>('/api/files/logo', {
        method: 'DELETE',
        headers: await buildAuthHeaders(),
        body: { collection, recordId },
      }),
    )
  }

  /**
   * Throw away a staged upload the user never committed (re-picked a logo, or
   * abandoned the create form). The route refuses if the file is referenced by
   * any record or wasn't uploaded by this user.
   */
  async function discardStagedLogo(fileId: string): Promise<TryCatchResult<{ ok: true }>> {
    return await tryCatch(
      $fetch<{ ok: true }>('/api/files/logo', {
        method: 'DELETE',
        headers: await buildAuthHeaders(),
        body: { fileId },
      }),
    )
  }

  return { replaceLogo, stageLogo, removeLogo, discardStagedLogo }
}
