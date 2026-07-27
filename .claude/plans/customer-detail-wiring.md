# Plan: Wire Customer Detail Page — Avatar, Contact & Address Create/Edit

**Created:** 2026-03-14
**Status:** Audited — Ready for Implementation
**Task:** Render the customer avatar from Directus `logo_id`, wire `DrawerContactInfo` and `DrawerAddressInfo` for creating and editing contacts and addresses with SAP flow compatibility, and add a page data refresh mechanism.

---

## High Level Plan

The `Customers/[id].vue` detail page already fetches live data from Directus via `fetchBusinessPartnerBySapId()`, maps contacts and addresses from junction data, and renders them in DataTables. However, the avatar slot shows a static placeholder icon instead of the uploaded logo, and the `DrawerAddressInfo` component has hardcoded dropdown options and stub save/cancel/delete handlers that just close the drawer without persisting anything.

This plan wires five features: **(1) avatar rendering** using the existing `logo_id` field and the project's established `/directus/assets/${id}` URL pattern (identical to `Manufacturers/Index.vue` line 209), **(2) contact creation** via the `business_partners_contacts` junction with nested `contacts_id` objects (required by the SAP blocking filter flow `[SAP] business_partners_contacts | PATCH` which reads `$trigger.payload.contacts_id.*` and `contact.phone_numbers.create[]`), **(3) contact editing** which updates the `contacts` record, `business_partners_contacts` junction, and individual `phone_numbers` records, **(4) address creation** via the `business_partners_addresses` junction with nested `addresses_id` objects (required by the SAP blocking filter flow `[SAP] business_partners_addresses | PATCH` which reads `$trigger.payload.addresses_id.*`), and **(5) address editing** which updates the `addresses` record directly for field changes and the junction record for billing/shipping/tags changes.

A new `useRegions` composable will provide country-filtered region data for the state/region dropdown (used by both drawers). The existing `useCountries`, `useContacts`, `usePhoneNumbers`, `useAddresses`, and `useBusinessPartners` composables already provide the CRUD operations needed. Both drawers will emit a `saved` event so the parent page can refresh its data after mutations.

**Key SAP constraints:** Two blocking filter flows intercept `items.create`:
1. **`[SAP] business_partners_contacts | PATCH`** — reads `payload.contacts_id.first_name`, `.last_name`, `.job_title`, `.email_address` and `contact.phone_numbers.create[].phone_numbers_id` for phone type mapping (general→Phone1, direct→Phone2, mobile→MobilePhone, fax→Fax). Contact creation **must** use nested Directus creation syntax.
2. **`[SAP] business_partners_addresses | PATCH`** — reads `payload.addresses_id.street_line_1`, `.city`, `.countries_id`, `.regions_id` as nested objects. Address creation **must** use nested Directus creation syntax.

Both flows only fire on create, not update — edits go directly to the underlying records without SAP interception.

**Uppercase constraint:** All address text fields (`street_line_1`, `street_line_2`, `city`, `postal_code`) have Directus validation regex `^[^a-z]*$` with message "Lowercase characters are not allowed". The drawer must auto-uppercase these values before submission, identical to the `companyName.toUpperCase()` pattern used in `useCreateBusinessPartner.js`.

## Low Level Description

### Avatar Rendering

The `business_partners` collection has a `logo_id` field (uuid FK to `directus_files`). The `DETAIL_FIELDS` array in `useBusinessPartners.js` already includes `'logo_id'` (line 17), so the data is fetched. The page just doesn't use it.

The established pattern for rendering Directus file assets is `/directus/assets/${fileId}` — this works because `nuxt.config.js` has `routeRules` proxying `/directus/**` to the Directus instance. Used in `Manufacturers/Index.vue` line 209:
```html
<img v-if="manufacturer.logo_id" :src="`/directus/assets/${manufacturer.logo_id}`" ... />
```

The `[id].vue` page will store `logoId` from the fetched data and render it in the `#avatar` slot's existing `.customer-avatar` container, replacing the placeholder icon when available.

### Address Creation (nested junction + SAP flow)

**SAP flow analysis** (flow `d8c73b5b`, verified via MCP):
- Trigger: blocking filter on `items.create` for `business_partners_addresses`
- Operations chain: `read_country` → `read_region` → `build_body` → `sap_request`
- `build_body` reads: `payload.addresses_id.street_line_1`, `.street_line_2`, `.city`, `.postal_code`, `payload.addresses_id.countries_id` (used to look up country code), `payload.addresses_id.regions_id` (used to look up region code), `payload.is_shipping_address`, `payload.is_billing_address`
- Creates SAP `BPAddresses` with `AddressType: 'bo_ShipTo'` and/or `'bo_BillTo'`

**Required creation payload shape** (must match SAP flow expectations):
```javascript
createPartnerAddress({
  business_partners_id: partnerId,  // integer — partner's primary key
  is_shipping_address: true,
  is_billing_address: false,
  tags: [],  // JSON array
  addresses_id: {  // nested object, NOT an integer reference
    street_line_1: 'STREET NAME'.toUpperCase(),
    // street_line_2 omitted when empty (regex ^[^a-z]*$ may reject null)
    city: 'CITY NAME'.toUpperCase(),
    postal_code: '12345',
    countries_id: 239,  // integer FK
    regions_id: 129,  // integer FK or null
  }
})
```

This uses the existing `useBusinessPartners().createPartnerAddress()` which calls `addressJunctionCrud.createOne()` — line 233 of `useBusinessPartners.js`.

### Address Editing

Editing has two targets:
1. **Address fields** (street, city, state, country, postal code) → update via `useAddresses().updateAddress(addressId, payload)` — already exists (line 88 of `useAddresses.js`)
2. **Junction fields** (is_billing, is_shipping, tags) → update via `useBusinessPartners().updatePartnerAddress(junctionId, payload)` — already exists (line 244 of `useBusinessPartners.js`)

No SAP flow intercepts address updates (flow only fires on `items.create`). SAP address sync on updates is a backend concern outside this plan's scope.

The same uppercase constraint applies on edit — all text fields must be `.toUpperCase()` before submission.

### Reference Data: Regions

Regions are country-dependent. The Directus `regions` collection has fields: `id`, `name`, `code`, `countries_id` (FK to `countries`). Confirmed 50+ US states/territories exist for `countries_id: 239`.

A new `useRegions` composable will fetch regions filtered by country ID. When the country dropdown changes, the state dropdown reloads. If the user changes country, the state selection is cleared (the previous state belongs to the old country).

### Reference Data: Countries

Reuse the existing `useCountries().fetchCountries()` composable — already created, returns `{ id, name, code, phone_code }`. Same formatting function `formatCountryLabel` pattern from `Create.vue` can be simplified here — addresses just need country name, not phone code. Use `optionLabel="name"` + `optionValue="id"`.

### Drawer Data Flow

**Props extended:**
- `businessPartnerId` (integer) — needed for junction creation, passed from parent
- `address` (object|null) — existing shape from `mapAddresses()`, already passed

**Events added:**
- `saved` — emitted after successful create or edit, parent calls `loadCustomer()` to refresh

**Form ↔ Directus field mapping:**
| Drawer Form | Directus Field | Collection |
|---|---|---|
| `country` | `countries_id` | `addresses` |
| `street` | `street_line_1` | `addresses` |
| `unitSuite` | `street_line_2` | `addresses` |
| `city` | `city` | `addresses` |
| `state` | `regions_id` | `addresses` |
| `postalCode` | `postal_code` | `addresses` |
| `isShipping` | `is_shipping_address` | `business_partners_addresses` |
| `isBilling` | `is_billing_address` | `business_partners_addresses` |
| `tags` | `tags` | `business_partners_addresses` |

**Current drawer form has `isDefault` checkbox labeled "Default Shipping Address"** — this maps to the `business_partners.default_shipping_business_partners_addresses_id` field on the parent partner record, not the junction. Setting a default would require updating the business partner itself. This is deferred — the checkbox will be replaced with `isShipping` and `isBilling` checkboxes which map directly to junction fields.

### Contact Creation (nested junction + SAP flow)

**SAP flow analysis** (flow `63ed0f39`, verified via MCP):
- Trigger: blocking filter on `items.create` for `business_partners_contacts`
- Operations chain: reads `$trigger.payload.contacts_id.*` (first_name, last_name, job_title, email_address), then reads `contact.phone_numbers.create[].phone_numbers_id` for phone type mapping
- Phone type mapping: `general`→`Phone1`, `direct`→`Phone2`, `mobile`→`MobilePhone`, `fax`→`Fax`
- Writes back `sap_id` (InternalCode) to the junction record

**Required creation payload shape** (must match SAP flow expectations):
```javascript
createPartnerContact({
  business_partners_id: partnerId,  // integer — partner's primary key
  status: 'active',
  business_partners_addresses_id: addressJunctionId || null,  // optional — links contact to address
  allow_transactional_email: true,
  allow_marketing_email: false,
  allow_transactional_sms: true,
  allow_marketing_sms: false,
  remarks: '<p>Notes here</p>',  // HTML text via Textarea (or null)
  contacts_id: {  // nested object, NOT an integer reference
    first_name: 'John',
    last_name: 'Doe',
    job_title: 'Sales Manager',  // plain string, NOT a dropdown selection
    email_address: 'john@example.com',
    phone_numbers: {
      create: [{
        phone_numbers_id: {
          number: '5555555555',
          type: 'general',
          sms_capable: true,
          countries_id: 239,
          // extension omitted when empty (Directus regex rejects null)
        },
      }],
    },
  },
})
```

This uses the existing `useBusinessPartners().createPartnerContact()` — line 212 of `useBusinessPartners.js`.

### Contact Editing

Editing has three targets:
1. **Contact fields** (first_name, last_name, job_title, email_address) → update via `useContacts().updateContact(contactId, payload)` — already exists in `useContacts.js`
2. **Junction fields** (status, business_partners_addresses_id, notification booleans, remarks, inactive_note) → update via `useBusinessPartners().updatePartnerContact(junctionId, payload)` — already exists (line 223 of `useBusinessPartners.js`)
3. **Phone number fields** (number, type, extension, sms_capable, countries_id) → update via `usePhoneNumbers().updatePhoneNumber(phoneId, payload)` — already exists in `usePhoneNumbers.js`

No SAP flow intercepts contact updates (flow only fires on `items.create`). Edits go directly to the records.

**`inactive_note` conditional requirement:** The `business_partners_contacts.inactive_note` field is required when `status` is `'inactive'` (Directus conditional validation). The drawer must show an "Inactive Note" field when status is inactive and validate it is non-empty before submission.

### Phone Number Management Within Contact Drawer

The DrawerContactInfo has an inline phone number edit/add UI (phone cards). Phone numbers are managed at three levels:

**Existing phones (edit):** When the user edits a phone card's fields and saves the contact drawer, each modified phone is updated via `usePhoneNumbers().updatePhoneNumber(phoneId, payload)`. The extension field must be omitted when empty (same pattern as `useCreateBusinessPartner.js`).

**New phones (add):** When creating a contact, all phones go in the nested `phone_numbers.create[]` array. When adding a phone to an *existing* contact, two operations are needed:
1. Create the phone number record via `usePhoneNumbers().createPhoneNumber(payload)` — returns the new phone ID
2. Create the contact–phone junction via `useDirectusCrud('contacts_phone_numbers').createOne({ contacts_id: contactId, phone_numbers_id: newPhoneId })`. **Note:** `createPartnerPhoneNumber` in `useBusinessPartners.js` writes to `business_partners_phone_numbers` (partner-level phones) — NOT the correct junction. Contact-level phones use the `contacts_phone_numbers` junction (fields: `contacts_id`, `phone_numbers_id`, `phone_numbers_sort`).

**Note:** Adding a phone to an existing contact does NOT go through the SAP contact flow (that flow only fires on `business_partners_contacts` create, not phone create). SAP phone sync on add-to-existing is a backend gap — same as address edits.

**Phone deletion:** Not implemented in this plan. The current UI has no delete button on phone cards (only edit and reorder). Deletion can be added later if needed.

### Contact Drawer Data Flow

**Props extended:**
- `businessPartnerId` (integer) — needed for junction creation, passed from parent
- `addresses` (array) — list of mapped addresses for the "Addresses" dropdown, passed from parent
- `contact` (object|null) — existing shape from `mapContacts()` (extended with IDs and phone data)

**Events added:**
- `saved` — emitted after successful create or edit, parent calls `loadCustomer()` to refresh

**Form ↔ Directus field mapping:**
| Drawer Form | Directus Field | Collection |
|---|---|---|
| `status` | `status` | `business_partners_contacts` |
| `firstName` | `first_name` | `contacts` |
| `lastName` | `last_name` | `contacts` |
| `jobTitle` | `job_title` | `contacts` (plain string, NOT dropdown) |
| `email` | `email_address` | `contacts` |
| `address` | `business_partners_addresses_id` | `business_partners_contacts` |
| `phoneNumbers[]` | `phone_numbers` | `contacts_phone_numbers` + `phone_numbers` |
| `allowTransactionalEmail` | `allow_transactional_email` | `business_partners_contacts` |
| `allowMarketingEmail` | `allow_marketing_email` | `business_partners_contacts` |
| `allowTransactionalSms` | `allow_transactional_sms` | `business_partners_contacts` |
| `allowMarketingSms` | `allow_marketing_sms` | `business_partners_contacts` |
| `notes` | `remarks` | `business_partners_contacts` |
| `inactiveNote` | `inactive_note` | `business_partners_contacts` |

**Key UI change:** `job_title` in Directus is a plain string field (`interface: "input"`, max 90 chars), not a dropdown. The current drawer uses a `Select` with hardcoded options — this must be changed to `InputText`.

### Page Refresh After Save

The `[id].vue` page already has `loadCustomer()` which re-fetches everything. After drawer emits `saved`, the page calls `loadCustomer()`. The addresses DataTable reactively updates because `addresses` is a `ref([])` that gets reassigned in `loadCustomer()`.

### Tags

The `business_partners_addresses.tags` field is JSON array. The hardcoded tag options (`Main office`, `Warehouse`, `Billing`) remain hardcoded — there is no tags collection in Directus. These are UI convenience labels. The user can type custom tags if PrimeVue `MultiSelect` supports it (it does not natively — but the `Chips` component does). For now, keep the predefined options. This matches the current UI design.

## Specific Actions

### Phase 1: New Composable

1. **Create `app/composables/useRegions.js`** — CRUD wrapper for `regions` collection. Single function `fetchRegionsByCountry(countryId)` that fetches regions filtered by `countries_id`, sorted by `name`, with fields `['id', 'name', 'code', 'countries_id']`, limit `-1`. Pattern: identical to `useCountries.js`.

2. **Update `app/composables/useBusinessPartners.js` — extend DETAIL_FIELDS for contact phone countries:** Add `'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.id'` and `'contacts.contacts_id.phone_numbers.phone_numbers_id.countries_id.name'` to the DETAIL_FIELDS array. Currently only `countries_id.phone_code` is fetched (line 74) — the `id` and `name` are needed for the phone edit form's country dropdown pre-selection.

### Phase 2: Avatar Rendering

3. **Update `app/pages/Customers/[id].vue` — store `logoId`:** Add `const logoId = ref(null)` to script. In `loadCustomer()`, after populating `customer`, set `logoId.value = partnerData.logo_id || null`.

4. **Update `app/pages/Customers/[id].vue` — render avatar image:** In the `#avatar` template slot, add `<img>` with `v-if="logoId"` using `:src="/directus/assets/${logoId}"` and `alt="Company logo"`. Keep the `pi pi-image` icon as `v-else` fallback. Add `object-fit: cover` and `border-radius: 50%` styles for the image (matching `Create.vue` `.create-profile-avatar__image` pattern).

### Phase 2.5: Consolidate Address Drawers

5. **Delete `DrawerAddressAdd.vue`:** A separate `DrawerAddressAdd.vue` component exists but is confirmed unused — no imports or references anywhere in `app/` (verified via grep). `DrawerAddressInfo` already handles both create mode (`address` prop is null) and edit mode (`address` prop is populated). Delete `DrawerAddressAdd.vue` to avoid confusion.

### Phase 3: Wire DrawerAddressInfo

6. **Update `DrawerAddressInfo.vue` — add props and events:** Add `businessPartnerId` prop (Number, required when creating). Add `saved` emit. Keep existing `address` prop and `update:visible` emit.

7. **Update `DrawerAddressInfo.vue` — replace hardcoded options with live data:** Remove hardcoded `countryOptions` and `stateOptions` arrays. Import and use `useCountries().fetchCountries()` and `useRegions().fetchRegionsByCountry()`. Fetch countries on drawer open. Fetch regions when country changes (via `watch` on `form.country`). Clear `form.state` when country changes (previous state invalid for new country). Add `filter` prop to Country `Select` for typeahead (245+ countries). Use `optionLabel="name"` and `optionValue="id"` for both dropdowns. Format state dropdown labels as `"Florida (FL)"` using a formatting function or computed label.

8. **Update `DrawerAddressInfo.vue` — replace `isDefault` with `isShipping`/`isBilling`:** Remove the single "Default Shipping Address" checkbox. Add two checkboxes: "Shipping Address" (`form.isShipping`, default `true`) and "Billing Address" (`form.isBilling`, default `false`). These map directly to the junction's `is_shipping_address` and `is_billing_address` fields.

9. **Update `DrawerAddressInfo.vue` — wire `onSave` for create mode:** When `!isEditMode` (no `address` prop): build nested junction payload with auto-uppercased text fields, call `createPartnerAddress()` from `useBusinessPartners()`. Handle success (toast + emit `saved` + close drawer) and error (toast with error message, stay open). Add `isSaving` ref to disable save button during request. Wire `isSaving` to `BaseActionButtons` `:save-loading` and `:save-disabled`.

10. **Update `DrawerAddressInfo.vue` — wire `onSave` for edit mode:** When `isEditMode`: build two payloads — address fields payload for `updateAddress(addressId, {...})` and junction fields payload for `updatePartnerAddress(junctionId, {...})`. Execute both via `Promise.all`. Handle success/error same as create. The `address` prop from the parent contains both `id` (junction ID) and `addressId` (address record ID) — use these to target the correct records.

11. **Update `DrawerAddressInfo.vue` — wire `onDelete`:** Call `removeOne()` on the junction record via a new `useDirectusCrud('business_partners_addresses')` instance, or add `removePartnerAddress` to `useBusinessPartners`. Emit `saved` to refresh parent. Show confirmation dialog before delete (PrimeVue `useConfirm`). Toast on success/error.

12. **Update `DrawerAddressInfo.vue` — add form validation:** Required fields: country, street, city, postal code. Add `submitted` ref, `errors` reactive object, `validateForm()` function. Show validation errors via `form-field__error`. Mirror Directus validations: no lowercase in street/city/postal code (or auto-uppercase before submit — simpler approach matching the create page pattern). Use `.toUpperCase()` in the save handler rather than client-side regex validation.

13. **Update `DrawerAddressInfo.vue` — populate form on edit:** In the `watch(visible)` handler for edit mode, map `address` prop fields to form: `form.country` = `address.countryId` (need to pass country ID from parent), `form.state` = `address.regionId`, `form.street` = `address.street`, etc. The current `mapAddresses()` in `[id].vue` extracts display-friendly values but not IDs — update it to also pass `countryId` and `regionId`.

### Phase 3.5: Wire DrawerContactInfo

14. **Update `DrawerContactInfo.vue` — add props and events:** Add `businessPartnerId` prop (Number, required when creating). Add `addresses` prop (Array, default `[]`) for the address dropdown. Add `saved` emit. Keep existing `contact` prop and `update:visible` emit.

15. **Update `DrawerContactInfo.vue` — replace `jobTitle` Select with InputText:** Remove `jobTitleOptions` ref. Replace the `Select` component for Job Title with `InputText` (`v-model="form.jobTitle"`, `placeholder="Enter job title"`, `fluid`). `job_title` is a plain string in Directus (max 90 chars), not a dropdown.

16. **Update `DrawerContactInfo.vue` — replace hardcoded options with live data:** Remove hardcoded `addressOptions` and `countryOptions` arrays. Wire `addresses` prop to the address `Select` using `optionLabel` (format as `"street, city, state"`) and `optionValue` (junction ID). Wire country dropdown in phone edit form using `useCountries().fetchCountries()` (fetch once on drawer open). Use `optionLabel="name"` and `optionValue="id"` for country. Add `filter` prop to country Select for typeahead.

17. **Update `DrawerContactInfo.vue` — fix status values and add `inactiveNote` field:** Change RadioButton values from `'Active'`/`'Inactive'` to lowercase `'active'`/`'inactive'` (matching Directus schema — confirmed: `choices: [{text: "Active", value: "active"}, {text: "Inactive", value: "inactive"}]`). Update form default from `status: 'Active'` to `status: 'active'`. Add `inactiveNote: ''` to form reactive. Add a conditional `Textarea` field below the status radio buttons: `v-if="form.status === 'inactive'"` with label "Inactive Note" and required indicator. This maps to `business_partners_contacts.inactive_note` (required when status is inactive).

18. **Update `DrawerContactInfo.vue` — wire phone number state management:** Replace `defaultPhoneNumbers` with empty array default. Track phone edits with a `modifiedPhoneIds` Set. When a phone card is edited and the edit form closed, compare against original values — if changed, add to `modifiedPhoneIds`. For new phones (added via "Add Phone Number" button), add to a `newPhones` array with temp IDs. Remove `isDefault` checkbox from phone edit form (no corresponding Directus field on phone_numbers).

19. **Update `DrawerContactInfo.vue` — wire `onSave` for create mode:** When `!isEditMode`: build nested junction payload with contacts_id containing first_name, last_name, job_title, email_address, and phone_numbers.create[] array. Build each phone payload with conditional extension omission. Call `createPartnerContact()` from `useBusinessPartners()`. Handle success (toast + emit `saved` + close) and error (toast + stay open). Add `isSaving` ref for button loading state.

20. **Update `DrawerContactInfo.vue` — wire `onSave` for edit mode:** When `isEditMode`: build three sets of updates:
    - Contact record update: `updateContact(contactId, { first_name, last_name, job_title, email_address })`
    - Junction record update: `updatePartnerContact(junctionId, { status, business_partners_addresses_id, allow_transactional_email, allow_marketing_email, allow_transactional_sms, allow_marketing_sms, remarks, inactive_note })`
    - Phone updates: for each phone in `modifiedPhoneIds`, call `updatePhoneNumber(phoneId, payload)` with conditional extension omission
    - New phones: for each in `newPhones`, call `createPhoneNumber(payload)` then create the contact–phone junction via `useDirectusCrud('contacts_phone_numbers').createOne({ contacts_id: contactId, phone_numbers_id: newPhoneId })` (NOT `createPartnerPhoneNumber` — that targets the wrong junction)
    Execute contact + junction updates via `Promise.all`, then phone updates sequentially. Handle success/error same as create.

21. **Update `DrawerContactInfo.vue` — add form validation:** Required fields: firstName. Conditional: inactiveNote required when status is `'inactive'`. At least one phone number required on create. Remove `form-field__label--required` from Last Name and Email labels (both are nullable in Directus). Add `submitted` ref, `errors` reactive object, `validateForm()` function. Show validation errors via `form-field__error` spans.

22. **Update `DrawerContactInfo.vue` — populate form on edit:** In the `watch(visible)` handler for edit mode, map extended `contact` prop fields to form. Map `phoneNumbers` from the contact's phone data (with IDs preserved for update targeting). Set `form.address` to the contact's `addressJunctionId` if linked. The current `mapContacts()` needs extension — see action 25.

23. **Update `DrawerContactInfo.vue` — wire `onDelete`:** Delete the junction record via `useDirectusCrud('business_partners_contacts')` removeOne or add `removePartnerContact` to `useBusinessPartners`. Emit `saved` to refresh parent. Show confirmation dialog before delete. Toast on success/error. Note: this does NOT delete the underlying contact record — only the junction link.

### Phase 4: Parent Page Updates

> **Implementation note:** Actions 24-25 (extend `mapAddresses`/`mapContacts`) should be done *before* testing Phase 3 action 13 and Phase 3.5 action 22, since drawer edit population depends on the extended mapper output.

24. **Update `app/pages/Customers/[id].vue` — extend `mapAddresses` to include country/region IDs:** The mapped shape already includes `isBilling`, `isShipping`, `tags`, and `remarks` (lines 84-87). Add only the missing ID fields: `countryId: addressRecord.countries_id?.id`, `countryName: addressRecord.countries_id?.name`, `regionId: addressRecord.regions_id?.id`, `regionName: addressRecord.regions_id?.name`. These are needed by the drawer to populate the edit form's country/state dropdowns with correct select values.

25. **Update `app/pages/Customers/[id].vue` — extend `mapContacts` to include IDs and phone data:** Add to the mapped contact shape:
    - `contactId: contactRecord.id` (already present)
    - `addressJunctionId: junction.business_partners_addresses_id` (for address dropdown pre-selection)
    - `allowTransactionalEmail: junction.allow_transactional_email`
    - `allowMarketingEmail: junction.allow_marketing_email`
    - `allowTransactionalSms: junction.allow_transactional_sms`
    - `allowMarketingSms: junction.allow_marketing_sms`
    - `inactiveNote: junction.inactive_note || ''`
    - `phoneNumbers`: map from `contactRecord.phone_numbers` junction array — **must unwrap junction**: each entry is `{ junctionId: junction.id, id: junction.phone_numbers_id.id, type: junction.phone_numbers_id.type, number: formatPhoneNumber(junction.phone_numbers_id), rawNumber: junction.phone_numbers_id.number, extension: junction.phone_numbers_id.extension || '', smsCapable: junction.phone_numbers_id.sms_capable, countryId: junction.phone_numbers_id.countries_id?.id, sort: junction.phone_numbers_sort }` — the data arrives as `contactRecord.phone_numbers[].phone_numbers_id.*` (junction wrapping the phone record)

    The existing `DETAIL_FIELDS` in `useBusinessPartners.js` fetches nested phone data through `contacts.contacts_id.phone_numbers.phone_numbers_id.*` — verified it includes `id`, `number`, `extension`, `type`, `sms_capable`, `countries_id.phone_code`. After Phase 1 action 2, it will also include `countries_id.id` and `countries_id.name`.

26. **Update `app/pages/Customers/[id].vue` — store partnerId:** Add `const partnerId = ref(null)`. Set in `loadCustomer()`: `partnerId.value = partnerData.id`.

27. **Update `app/pages/Customers/[id].vue` — pass props to DrawerContactInfo:** Add `:business-partner-id="partnerId"`, `:addresses="addresses"`, `@saved="loadCustomer"` to the `DrawerContactInfo` component.

28. **Update `app/pages/Customers/[id].vue` — pass props to DrawerAddressInfo:** Add `:business-partner-id="partnerId"`, `@saved="loadCustomer"` to the `DrawerAddressInfo` component.

29. **Update `app/pages/Customers/[id].vue` — pass full data to drawer openers:** Update `openEditContact(contact)` and `openEditAddress(address)` to pass the full mapped objects (which now include all IDs and nested data needed for edit forms).

## Possible Blockers

- **SAP address update sync** — The SAP flow only fires on `items.create`, not `items.update`. Editing an address in Directus will NOT update it in SAP. This is a backend gap — if SAP needs address updates, a new flow must be created. This does not block frontend implementation but should be flagged to the team.

- **`street_line_2` uppercase validation with null** — Like the `extension` field in the create plan, `street_line_2` has a regex `^[^a-z]*$` and is nullable. Sending `null` may or may not trigger the regex. If it does, omit the field from the payload when empty (same pattern as `extension` fix in `useCreateBusinessPartner.js`).

- **Region dropdown race condition** — When editing, the country is set before regions are fetched. The `watch` on `form.country` will trigger a region fetch, but the `form.state` value needs to survive the fetch (not be cleared). The watch should only clear state when the user manually changes country, not on initial population. Use a flag like `isInitialLoad` to differentiate.

- **Delete address permissions** — Junction deletion requires `delete` permission on `business_partners_addresses`. If the role lacks this, the delete button will silently fail. Handle with `tryCatch` and error toast. Note: deleting a junction leaves the `addresses` record orphaned — this is acceptable (periodic cleanup).

- **SAP address deletion** — Deleting a junction in Directus does not remove the address from SAP (no delete flow exists). The SAP record persists. This is a backend concern, not a frontend blocker.

- **`useConfirm` availability** — PrimeVue's `useConfirm` requires a `ConfirmDialog` component in the DOM. Check if one exists in `default.vue` layout. If not, it needs to be added, or use a simpler `window.confirm()` for the delete confirmation.

- **SAP contact update sync** — Like addresses, the SAP contact flow only fires on `items.create`, not `items.update`. Editing contact fields in Directus will NOT sync to SAP. This is a backend gap, not a frontend blocker.

- **Phone number add to existing contact** — Adding a phone to an existing contact requires two separate API calls (create phone, create junction) rather than the single nested create used during contact creation. The SAP contact flow will NOT fire for this — SAP only gets phones during initial contact creation. This means phones added after initial creation won't appear in SAP until a backend flow is added.

- **`inactive_note` conditional requirement** — Directus requires `inactive_note` when `status` is `'inactive'` on `business_partners_contacts`. The drawer must enforce this with client-side validation. If the user switches status from inactive to active, the drawer should clear `inactive_note` to avoid submitting stale data.

- **Phone number DETAIL_FIELDS depth** — ~~Verify that `useBusinessPartners.js` DETAIL_FIELDS fetches phone number data deep enough.~~ **RESOLVED:** Verified. DETAIL_FIELDS includes `type`, `number`, `extension`, `sms_capable`, `countries_id.phone_code`. Phase 1 action 2 adds the missing `countries_id.id` and `countries_id.name`.

- **`phone_numbers_sort` ordering** — The `contacts_phone_numbers` junction has a `phone_numbers_sort` integer field for ordering phone cards. When adding new phones to an existing contact, pass `phone_numbers_sort` to maintain card order. When mapping phones for display, sort by this field. Not blocking but affects UX if ignored.

- **Remarks field format** — `business_partners_contacts.remarks` uses Directus WYSIWYG interface (HTML text). The drawer currently uses a plain `Textarea`. Switching to a rich text editor is out of scope — plain text in `Textarea` works but HTML tags from existing data may show. Consider stripping tags on display or accepting this limitation.

## Verified Schema Claims

| Claim | Verification Method | Key Finding |
|---|---|---|
| SAP address flow is blocking filter on `items.create` | `mcp__directus__flows` read — flow `d8c73b5b`, scope `items.create`, collections `business_partners_addresses` | Blocking filter, reads nested `payload.addresses_id.*` |
| SAP flow reads country/region by ID from nested payload | Flow operations: `read_country` reads `$trigger.payload.addresses_id.countries_id`, `read_region` reads `$trigger.payload.addresses_id.regions_id` | Must pass integer FKs in nested object |
| `street_line_1` no lowercase | `mcp__directus__fields` read — validation regex `^[^a-z]*$`, message "Lowercase characters are not allowed" | Auto-uppercase on save |
| `city` no lowercase | `mcp__directus__fields` read — same regex | Auto-uppercase on save |
| `postal_code` no lowercase | `mcp__directus__fields` read — same regex | Auto-uppercase on save |
| `street_line_2` no lowercase | `mcp__directus__fields` read — same regex, `is_nullable: true` | Auto-uppercase when present, omit when empty |
| `regions` has `countries_id` FK | `mcp__directus__fields` read — `countries_id` integer FK, required | Filter regions by selected country |
| US regions exist (50+ states/territories) | `mcp__directus__items` read — Alabama, Alaska, etc. for `countries_id: 239` | Data confirmed |
| `business_partners_addresses` junction has billing/shipping booleans | Schema from agent exploration — `is_billing_address`, `is_shipping_address` required booleans | Map to drawer checkboxes |
| `logo_id` included in DETAIL_FIELDS | `useBusinessPartners.js` line 17 — `'logo_id'` in DETAIL_FIELDS array | Data already fetched, just not rendered |
| Avatar URL pattern | `Manufacturers/Index.vue` line 209 — `` `/directus/assets/${manufacturer.logo_id}` `` | Established project pattern |
| `useAddresses.js` already exists | File read — has `createAddress`, `updateAddress`, `fetchAddress` | No new CRUD composable needed for addresses |
| `useBusinessPartners.js` has junction CRUD | Lines 233, 244 — `createPartnerAddress`, `updatePartnerAddress` | Junction operations ready |
| No SAP flow on address update | `mcp__directus__flows` active flows list — only `items.create` scope for addresses | Edits bypass SAP (backend gap) |
| SAP contact flow is blocking filter on `items.create` | `mcp__directus__flows` read — flow `63ed0f39`, scope `items.create`, collections `business_partners_contacts` | Blocking filter, reads `$trigger.payload.contacts_id.*` and phone_numbers |
| SAP contact flow maps phone types | Flow operation analysis — general→Phone1, direct→Phone2, mobile→MobilePhone, fax→Fax | Phone type values must be lowercase in Directus |
| `contacts.job_title` is plain string | `mcp__directus__fields` read — `interface: "input"`, max_length 90 | Change drawer Select to InputText |
| `contacts.first_name` is required | `mcp__directus__fields` read — `is_nullable: false`, required: true | Validate in drawer |
| `contacts.last_name` is nullable | `mcp__directus__fields` read — `is_nullable: true` | Optional in drawer |
| `contacts.email_address` has email regex | `mcp__directus__fields` read — validation regex for email format | Client-side email format validation optional |
| `business_partners_contacts.inactive_note` conditionally required | `mcp__directus__fields` read — required when status=inactive (Directus conditional validation) | Show field and validate when inactive |
| `business_partners_contacts.remarks` is WYSIWYG HTML | `mcp__directus__fields` read — `interface: "input-rich-text-html"` | Plain Textarea acceptable for MVP |
| `business_partners_contacts` has notification booleans | Schema read — `allow_transactional_email`, `allow_marketing_email`, `allow_transactional_sms`, `allow_marketing_sms` (all with defaults) | Map to drawer checkboxes |
| `business_partners_contacts.business_partners_addresses_id` is FK | Schema read — integer FK to `business_partners_addresses` junction, nullable | Links contact to an address (optional) |
| `useContacts.js` has updateContact | File read — `updateContact(contactId, payload)` exists | No new CRUD needed |
| `usePhoneNumbers.js` has updatePhoneNumber | File read — `updatePhoneNumber(phoneId, payload)` exists | No new CRUD needed |
| ~~`useBusinessPartners.js` has createPartnerPhoneNumber~~ | ~~Line 254~~ | **CORRECTED:** `createPartnerPhoneNumber` writes to `business_partners_phone_numbers` (partner-level), NOT `contacts_phone_numbers` (contact-level). Use `useDirectusCrud('contacts_phone_numbers')` instead |
| `contacts_phone_numbers` junction schema | `mcp__directus__fields` read — fields: `id`, `contacts_id` (FK→contacts), `phone_numbers_id` (FK→phone_numbers), `phone_numbers_sort` (integer) | Correct junction for contact-level phones |
| `business_partners_contacts.status` uses lowercase values | `mcp__directus__fields` read — choices: `[{text: "Active", value: "active"}, {text: "Inactive", value: "inactive"}]` | DrawerContactInfo RadioButton values must use `'active'`/`'inactive'`, not `'Active'`/`'Inactive'` |
| `mapAddresses` already includes `isBilling`/`isShipping`/`tags` | `[id].vue` lines 84-87 | Only `countryId`, `countryName`, `regionId`, `regionName` need adding |
| DETAIL_FIELDS contact phone path missing `countries_id.id`/`.name` | `useBusinessPartners.js` line 74 — only fetches `countries_id.phone_code` | Phase 1 action 2 adds the missing fields |
| `DrawerAddressAdd.vue` exists but unused | `Glob` match + `Grep` for `DrawerAddressAdd` in `app/` returned no references | Safe to delete — action 5 |
| No SAP flow on contact update | `mcp__directus__flows` active flows list — only `items.create` scope for contacts | Edits bypass SAP (backend gap) |
