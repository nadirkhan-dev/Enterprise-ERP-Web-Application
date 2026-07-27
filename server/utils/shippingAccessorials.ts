/**
 * Shipping accessorial codes — the integration source of truth.
 *
 * These mirror `shipping_accessorials.code` in Directus (the immutable business
 * identifier; names and ids may change, codes do not). The carrier rate
 * builders translate the codes they support into carrier-specific request
 * options and ignore the rest.
 *
 * Carrier support matrix:
 *   saturday_delivery        → FedEx parcel (SATURDAY_DELIVERY), UPS (SaturdayDeliveryIndicator)
 *   signature_required       → FedEx parcel (signatureOptionType), UPS (DeliveryConfirmation)
 *   liftgate_required        → FedEx Freight (LIFTGATE_DELIVERY)
 *   limited_access_delivery  → FedEx Freight (LIMITED_ACCESS_DELIVERY)
 *   hazardous_materials      → unmapped — rate-level hazmat needs full
 *                              dangerous-goods detail (regulation set, UN
 *                              numbers, packaging) that this flow does not
 *                              collect, so it is intentionally ignored.
 */
export const ACCESSORIAL_CODES = {
  SATURDAY_DELIVERY: 'saturday_delivery',
  SIGNATURE_REQUIRED: 'signature_required',
  HAZARDOUS_MATERIALS: 'hazardous_materials',
  LIFTGATE_REQUIRED: 'liftgate_required',
  LIMITED_ACCESS_DELIVERY: 'limited_access_delivery',
} as const

/** Normalize an incoming accessorial list to a de-duped set of trimmed codes. */
export function normalizeAccessorialCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const codes = value
    .map(code => String(code ?? '').trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(codes))
}
