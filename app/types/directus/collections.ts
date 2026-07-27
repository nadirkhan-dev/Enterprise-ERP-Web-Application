/**
 * Directus collection interfaces — derived from the live schema.
 *
 * Conventions:
 * - Fields use the exact Directus column names (snake_case).
 * - Relation fields are typed as `number | RelatedType` to support both
 *   raw ID responses and deep-fetched expansions.
 * - Audit fields (user_created, date_created, etc.) are shared via DirectusTimestamps.
 * - Alias / virtual fields (o2m, m2m) only appear when relevant to the frontend.
 */
import type {
  BusinessPartnerAddress,
  BusinessPartnerContact,
  BusinessPartnerEquipment,
  BusinessPartnerPhoneNumber,
  ContactPhoneNumber,
} from './junctions'

export interface DirectusTimestamps {
  user_created: string | null
  date_created: string | null
  user_updated: string | null
  date_updated: string | null
}

export interface Country extends DirectusTimestamps {
  id: number
  sort: number | null
  code: string
  name: string
  phone_code: string
  flag_id: string | null
  // SupplyHub availability — only `active` countries are offered for selection.
  status: 'active' | 'inactive'
  regions?: Region[]
}

export interface Region extends DirectusTimestamps {
  id: number
  countries_id: number | Country
  code: string
  name: string
}

export interface BusinessPartner extends DirectusTimestamps {
  id: number
  status: 'active' | 'inactive'
  name: string
  website: string | null
  remarks: string | null
  is_national_account: boolean
  account_number: string | null
  shopify_id: number | null
  relationship_type: 'customer' | 'supplier'
  business_partner_groups_id: number | BusinessPartnerGroup
  logo_id: string | null
  default_shipping_business_partners_addresses_id: number | BusinessPartnerAddress | null
  default_billing_business_partners_addresses_id: number | BusinessPartnerAddress | null
  contacts?: BusinessPartnerContact[]
  addresses?: BusinessPartnerAddress[]
  phone_numbers?: BusinessPartnerPhoneNumber[]
  equipment?: BusinessPartnerEquipment[]
  price_lists?: PriceList[]
}

export interface BusinessPartnerGroup extends DirectusTimestamps {
  id: number
  sort: number | null
  relationship_type: 'customer' | 'supplier'
  name: string
  sap_id: number
}

export interface Contact extends DirectusTimestamps {
  id: number
  first_name: string
  middle_name: string | null
  last_name: string | null
  job_title: string | null
  email_address: string | null
  phone_numbers?: ContactPhoneNumber[]
}

export interface Address extends DirectusTimestamps {
  id: number
  countries_id: number | Country
  street_line_1: string
  street_line_2: string | null
  city: string
  regions_id: number | Region | null
  postal_code: string
  latitude: number | null
  longitude: number | null
}

export interface PhoneNumber extends DirectusTimestamps {
  id: number
  countries_id: number | Country
  number: string
  extension: string | null
  sms_capable: boolean
  type: 'general' | 'direct' | 'mobile' | 'fax'
}

export interface Location extends DirectusTimestamps {
  id: number
  name: string
  latitude: number | null
  longitude: number | null
  tags: string[] | null
  remarks: string | null
}

export interface ActivityGroup extends DirectusTimestamps {
  id: number
  sort: number | null
  name: string
  type: string | null
  direction: string | null
}

export interface Activity extends DirectusTimestamps {
  id: number
  business_partners_id: number | BusinessPartner
  business_partners_contacts_id: number | BusinessPartnerContact | null
  activity_groups_id: number | ActivityGroup
  subject: string
  remarks: string | null
  sap_id: number
  source_follow_ups_id: number | FollowUp | null
}

export interface FollowUp extends DirectusTimestamps {
  id: number
  status: string
  sort: number | null
  assigned_user_id: string
  activity_groups_id: number | ActivityGroup
  subject: string
  remarks: string | null
  recurrence_interval_days: number | null
  reminder_date: string | null
  due_date: string
  recurrence_end_date: string | null
}

export interface Item extends DirectusTimestamps {
  id: number
  status: 'active' | 'draft' | 'inactive'
  manufacturers_id: number | Manufacturer
  item_groups_id: number | ItemGroup
  mpn: string
  sku: string
  description: string
  mfr_list_price: number | null
  base_cost: number | null
  offer_price: number | null
  min_sale_qty: number
  production_type: 'MTS' | 'ATO' | 'MTO'
  allow_returns: boolean
  unit_weight_lb: number | null
  shipping_weight_lb: number | null
  shipping_length_in: number | null
  shipping_width_in: number | null
  shipping_height_in: number | null
  shipping_volume_in: number | null
  shipping_groups_id: number | ShippingGroup
  barcode: string | null
  hs_code: string | null
  countries_id: number | Country | null
}

export interface Manufacturer extends DirectusTimestamps {
  id: number
  slug: string
  name: string
  description: string | null
  website: string | null
  sap_id: number
  logo_id: string | null
  prompt_sets_id: number | null
}

export interface ItemGroup extends DirectusTimestamps {
  id: number
  sort: number | null
  slug: string
  name: string
  description: string | null
  sap_id: number
  prompts_id: number | null
}

export interface ShippingGroup extends DirectusTimestamps {
  id: number
  sort: number | null
  // Immutable business-logic identifier (e.g. 'parcel', 'ltl').
  code: string
  name: string
  description: string
}

export interface Equipment extends DirectusTimestamps {
  id: number
  status: 'active' | 'inactive'
  manufacturers_id: number | Manufacturer
  equipment_groups_id: number
  model: string | null
  serial_number: string
  description: string
  sap_id: number
}

export interface PriceList extends DirectusTimestamps {
  id: number
  status: 'active' | 'inactive'
  manufacturers_id: number | Manufacturer | null
  material_price_groups_id: number | null
  business_partners_id: number | BusinessPartner
  price_strategy: 'costplus' | 'listdiscount'
  discount_multiplier: number | null
  price_multiplier: number
  break_passthrough_multiplier: number
}

export interface PriceListItem {
  id: number
  price_lists_id: number | PriceList | null
  items_id: number | Item | null
  bp_catalog_number: string
  description: string
  unit_price: number | null
  unit_cost: number | null
  available_qty: number | null
  min_order_qty: number
  price_lists_sort: number | null
  items_sort: number | null
}
