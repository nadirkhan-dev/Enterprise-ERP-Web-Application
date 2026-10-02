/**
 * Reference data for the Special-SKU pickers: the manufacturer and item-group
 * option lists.
 *
 * Sourced from SupplyHub (Directus), NOT the SAP Service Layer: SupplyHub is the
 * curated master for both collections and carries the display order. Each row's
 * `sap_id` becomes the option `value`, so the generated-SKU POST still submits
 * SAP ids exactly as before — only where the lists are read from, and their
 * order, changes.
 *
 * - manufacturers: ordered by name (the `manufacturers` collection has no `sort`)
 * - item groups:   ordered by SupplyHub's `sort` (nulls sink to the end)
 */

interface DirectusReferenceRow {
  name: string | null
  sap_id: number | null
  sort?: number | null
}

interface ReferenceOption {
  label: string
  value: number
  sapId: number
}

function normalizeOption(label: string, sapId: number): ReferenceOption {
  return {
    label,
    value: sapId,
    sapId,
  }
}

function getDirectusConfig(): { url: string, token: string } {
  const runtime = useRuntimeConfig()
  const url = String(runtime.directusUrl || '').replace(/\/$/, '')
  const token = String(runtime.directusToken || '')
  if (!url || !token) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Directus is not configured (DIRECTUS_URL / NUXT_DIRECTUS_TOKEN missing).',
    })
  }
  return { url, token }
}

/**
 * Read a SupplyHub reference collection via the service token (server-only, so
 * the token never reaches the client and user policies don't gate the picker).
 * `limit=-1` returns every row in one call. Item groups pass `sort` as an extra
 * field so the handler can order by it.
 */
async function fetchDirectusReference(
  collection: string,
  extraFields: string[] = [],
): Promise<DirectusReferenceRow[]> {
  const { url, token } = getDirectusConfig()

  const endpoint = new URL(`${url}/items/${collection}`)
  endpoint.searchParams.set('fields', ['name', 'sap_id', ...extraFields].join(','))
  endpoint.searchParams.set('limit', '-1')

  const response = await fetch(endpoint.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `Directus ${collection} lookup failed (${response.status}).`,
    })
  }

  const payload = (await response.json()) as { data?: DirectusReferenceRow[] }
  return payload.data || []
}

export default defineEventHandler(async () => {
  try {
    const [manufacturerRows, itemGroupRows] = await Promise.all([
      fetchDirectusReference('manufacturers'),
      fetchDirectusReference('item_groups', ['sort']),
    ])

    // A valid option needs both a name to show and a SAP id to submit; rows
    // missing either are unusable in the picker, so drop them.
    const manufacturers = manufacturerRows
      .filter(row => row.sap_id !== null && row.name)
      .sort((a, b) => (a.name as string).localeCompare(b.name as string))
      .map(row => normalizeOption(row.name as string, Number(row.sap_id)))

    const itemGroups = itemGroupRows
      .filter(row => row.sap_id !== null && row.name)
      // SupplyHub's curated order; groups it hasn't ranked (`sort` null) sink to
      // the end, and ties fall back to name.
      .sort((a, b) => {
        const sortA = a.sort ?? Infinity
        const sortB = b.sort ?? Infinity
        if (sortA !== sortB) {
          return sortA - sortB
        }
        return (a.name as string).localeCompare(b.name as string)
      })
      .map(row => normalizeOption(row.name as string, Number(row.sap_id)))

    return { manufacturers, itemGroups }
  } catch (error) {
    console.error('Reference data request failed:', error)
    throw createError({
      statusCode: 502,
      statusMessage: 'Failed to fetch reference data.',
    })
  }
})
