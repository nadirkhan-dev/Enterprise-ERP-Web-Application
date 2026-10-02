/**
 * Shipping accessorial codes — the integration source of truth.
 *
 * These mirror `shipping_accessorials.code` in Directus (the immutable business
 * identifier; names and ids may change, codes do not). The carrier rate
 * builders translate the codes they support into carrier-specific request
 * options and ignore the rest.
 *
 * Carrier support matrix:
 *   saturday_delivery        → FedEx parcel (SATURDAY_DELIVERY), UPS (SaturdayDeliveryIndicator).
 *                              No Priority1 equivalent — their SATPU is Saturday
 *                              *pickup*, which is a different service.
 *   signature_required       → FedEx parcel (signatureOptionType), UPS (DeliveryConfirmation).
 *                              No Priority1 equivalent — RDNS is "residential
 *                              direct, no signature", close to the opposite.
 *   liftgate_required        → FedEx Freight (LIFTGATE_DELIVERY), Priority1 (LGDEL)
 *   limited_access_delivery  → FedEx Freight (LIMITED_ACCESS_DELIVERY), Priority1 (LTDDEL)
 *   hazardous_materials      → Priority1 (HAZM + items[].isHazardous). Still
 *                              unmapped for FedEx/UPS parcel: rate-level hazmat
 *                              there needs full dangerous-goods detail
 *                              (regulation set, UN numbers, packaging) that this
 *                              flow does not collect.
 *   residential_delivery     → Priority1 (RESDEL). LTL only; mutually exclusive
 *                              with limited_access_delivery.
 *   delivery_appointment     → Priority1 (APPT). LTL only; some carriers price
 *                              it at zero, which is not a failure.
 */
export const ACCESSORIAL_CODES = {
  SATURDAY_DELIVERY: 'saturday_delivery',
  SIGNATURE_REQUIRED: 'signature_required',
  HAZARDOUS_MATERIALS: 'hazardous_materials',
  LIFTGATE_REQUIRED: 'liftgate_required',
  LIMITED_ACCESS_DELIVERY: 'limited_access_delivery',
  RESIDENTIAL_DELIVERY: 'residential_delivery',
  DELIVERY_APPOINTMENT: 'delivery_appointment',
} as const

/** Normalize an incoming accessorial list to a de-duped set of trimmed codes. */
export function normalizeAccessorialCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const codes = value
    .map(code => String(code ?? '').trim().toLowerCase())
    .filter(Boolean)
  return Array.from(new Set(codes))
}
