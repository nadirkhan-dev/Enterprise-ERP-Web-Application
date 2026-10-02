// A SAP BusinessPartner card code — "C" (customer) or "V" (vendor/supplier)
// followed by 6 digits, e.g. C121380 / V000123. The detail routes are keyed on
// the Directus id, but list links and synced records use the card code, so this
// tells the two apart. A freshly-created record has no card code until the SAP
// sync worker writes it back, so `false` here also means "awaiting SAP id".
const SAP_CARD_CODE_PATTERN = /^[CV]\d{6}$/i

export function isSapCardCode(value: string | null | undefined): boolean {
  return typeof value === 'string' && SAP_CARD_CODE_PATTERN.test(value)
}
