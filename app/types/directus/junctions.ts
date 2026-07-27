/**
 * Junction / pivot table interfaces for M2M relationships.
 */
import type {
  Address,
  BusinessPartner,
  Contact,
  Location,
  PhoneNumber,
} from './collections'

export interface BusinessPartnerAddress {
  id: number
  business_partners_id: number | BusinessPartner
  addresses_id: number | Address
  addresses_sort: number | null
  is_billing_address: boolean
  is_shipping_address: boolean
  status: 'active' | 'inactive'
  inactive_note: string | null
  tags: string[] | null
  remarks: string | null
  locations?: BusinessPartnerAddressLocation[]
}

export interface BusinessPartnerContact {
  id: number
  business_partners_id: number | BusinessPartner | null
  contacts_id: number | Contact | null
  contacts_sort: number | null
  status: 'active' | 'inactive'
  business_partners_addresses_id: number | BusinessPartnerAddress | null
  allow_transactional_email: boolean
  allow_marketing_email: boolean
  allow_transactional_sms: boolean
  allow_marketing_sms: boolean
  inactive_note: string | null
  sap_id: number | null
  shopify_id: number | null
  remarks: string | null
}

export interface BusinessPartnerPhoneNumber {
  id: number
  business_partners_id: number | BusinessPartner | null
  phone_numbers_id: number | PhoneNumber | null
  phone_numbers_sort: number | null
}

export interface BusinessPartnerEquipment {
  id: number
  business_partners_id: number | BusinessPartner | null
  equipment_id: number | null
}

export interface BusinessPartnerAddressLocation {
  id: number
  business_partners_addresses_id: number | BusinessPartnerAddress
  locations_id: number | Location
  locations_sort: number | null
}

export interface ContactPhoneNumber {
  id: number
  contacts_id: number | Contact | null
  phone_numbers_id: number | PhoneNumber | null
  phone_numbers_sort: number | null
}
