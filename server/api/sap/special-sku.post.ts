import { SapServiceLayerError, useSapServiceLayer } from '../../utils/sapServiceLayer'

interface SpecialSkuPayload {
  manufacturerSapId: number
  manufacturerName: string
  itemGroupSapId: number
  itemGroupName: string
  itemType: 'complete' | 'repair'
}

interface SapItem {
  ItemCode: string
  [key: string]: unknown
}

const ITEM_TYPES = {
  complete: {
    suffix: 'C',
    descriptionSuffix: 'COMPLETE ITEM DESCRIPTION',
  },
  repair: {
    suffix: 'R',
    descriptionSuffix: 'REPAIR ITEM DESCRIPTION',
  },
} as const

function validatePayload(payload: Partial<SpecialSkuPayload>): SpecialSkuPayload {
  const manufacturerSapId = Number(payload.manufacturerSapId)
  const itemGroupSapId = Number(payload.itemGroupSapId)
  const manufacturerName = String(payload.manufacturerName || '').trim()
  const itemGroupName = String(payload.itemGroupName || '').trim()
  const itemType = payload.itemType

  if (!Number.isFinite(manufacturerSapId) || manufacturerSapId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Manufacturer is required.' })
  }

  if (!Number.isFinite(itemGroupSapId) || itemGroupSapId <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'Item group is required.' })
  }

  if (!manufacturerName || !itemGroupName) {
    throw createError({ statusCode: 400, statusMessage: 'Manufacturer and item group names are required.' })
  }

  if (itemType !== 'complete' && itemType !== 'repair') {
    throw createError({ statusCode: 400, statusMessage: 'Item type is required.' })
  }

  return {
    manufacturerSapId,
    manufacturerName,
    itemGroupSapId,
    itemGroupName,
    itemType,
  }
}

function buildSpecialSku(payload: SpecialSkuPayload): string {
  return `LSSMFR${payload.manufacturerSapId}IG${payload.itemGroupSapId}${ITEM_TYPES[payload.itemType].suffix}`
}

function buildSapItemBody(payload: SpecialSkuPayload, itemCode: string) {
  const typeConfig = ITEM_TYPES[payload.itemType]
  const itemName = `***EDIT ${payload.manufacturerName} ${payload.itemGroupName} ${typeConfig.descriptionSuffix}***`

  return {
    ItemCode: itemCode,
    ItemName: itemName.toUpperCase(),
    SalesUnitWeight: 99999,
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof SapServiceLayerError && error.statusCode === 404
}

function isConflict(error: unknown): boolean {
  if (!(error instanceof SapServiceLayerError)) {
    return false
  }

  return error.statusCode === 409 || /already|exist|duplicate/i.test(error.message)
}

async function getSapItem(itemCode: string): Promise<SapItem | null> {
  const sap = useSapServiceLayer()

  try {
    return await sap.get<SapItem>(`Items('${itemCode}')`)
  } catch (error) {
    if (isNotFound(error)) {
      return null
    }

    throw error
  }
}

export default defineEventHandler(async (event) => {
  const payload = validatePayload(await readBody<Partial<SpecialSkuPayload>>(event))
  const sap = useSapServiceLayer()
  const itemCode = buildSpecialSku(payload)

  try {
    const existingItem = await getSapItem(itemCode)
    if (existingItem) {
      return {
        itemCode: existingItem.ItemCode,
        created: false,
        data: existingItem,
      }
    }

    try {
      const createdItem = await sap.post<SapItem>('Items', buildSapItemBody(payload, itemCode))
      return {
        itemCode: createdItem?.ItemCode || itemCode,
        created: true,
        data: createdItem,
      }
    } catch (createError) {
      if (isConflict(createError)) {
        const concurrentlyCreatedItem = await getSapItem(itemCode)
        if (concurrentlyCreatedItem) {
          return {
            itemCode: concurrentlyCreatedItem.ItemCode,
            created: false,
            data: concurrentlyCreatedItem,
          }
        }
      }

      throw createError
    }
  } catch (error) {
    console.error('SAP special SKU request failed:', error)
    const statusMessage = error instanceof SapServiceLayerError
      ? error.message
      : 'Failed to generate Special SKU in SAP.'

    throw createError({
      statusCode: error instanceof SapServiceLayerError ? (error.statusCode === 401 ? 502 : error.statusCode) : 500,
      statusMessage,
    })
  }
})

export {
  buildSapItemBody,
  buildSpecialSku,
  validatePayload,
}
