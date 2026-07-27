# Plan: Wire Customer Create Page to Directus Backend

**Created:** 2026-03-13
**Status:** Approved
**Task:** Replace hardcoded mock data in `Customers/Create.vue` with live Directus API calls for creating a new customer (business partner), initial contact, phone number, and logo image.

---

## High Level Plan

The `Customers/Create.vue` page currently has a fully built UI with form validation, but its `handleSave()` function only validates and navigates — no data is persisted to Directus. The dropdown options for "Customer Group" and "Country" are hardcoded string arrays instead of being fetched from the backend. The profile avatar area is a static placeholder with no upload capability.

**No layout or visual design changes will be made.** The existing page structure, components, styling, and visual design are established by the UI designer and remain untouched. All changes are functional wiring: swapping hardcoded data for live API data, enabling the existing avatar placeholder to accept file uploads, implementing the save function, and adding error states. The Select dropdowns will look and behave identically — only the internal `v-model` binding changes from display strings to integer IDs (PrimeVue's `optionLabel` prop handles display). **State-dependent behavior changes** are introduced: after partial success, partner-level inputs are disabled, the logo input is locked, and the Cancel button changes to navigate to the saved customer. These are functional necessities of the retry model, not design changes, but they do affect the user experience and should be QA'd.

**Code abstraction:** The save logic will live in a new **orchestration composable** `useCreateBusinessPartner()`, not inline in the page. Rationale:
- `Suppliers/Create.vue` has a nearly identical form and will need the same orchestration (just `relationship_type='supplier'`)
- Drawer components will eventually need similar create/update patterns
- The nested Directus creation payload (contact + phone number in one request) is complex enough to warrant abstraction
- Single-responsibility composables (`useBusinessPartners`, `useContacts`) stay focused on CRUD; the orchestration composable sequences them

**SAP integration insight:** Two active blocking filter flows intercept `items.create` events:

1. **`[SAP] business_partners | POST`** — Creates the partner in SAP and writes back `sap_id` (CardCode) to the payload before Directus saves. The response from `createBusinessPartner()` includes `sap_id`.

2. **`[SAP] business_partners_contacts | PATCH`** — Triggers on `business_partners_contacts` junction creation. Reads the **full nested contact object** from `$trigger.payload.contacts_id` and phone numbers from `contact.phone_numbers.create[].phone_numbers_id`. This means the junction record **must** use Directus nested creation syntax — passing the contact as an inline object so the SAP flow can access the full payload.

**Logo upload:** This is the first file upload in the project. The `business_partners` collection has a `logo_id` field (uuid FK to `directus_files`). The approach is: user clicks the avatar placeholder → native file input opens → file is uploaded to Directus via `uploadFiles(FormData)` → the returned file ID is stored in form state → included in the `createBusinessPartner` payload. Upload happens immediately on file select (before save), so the user sees a preview.

## Low Level Description

### Code Architecture

```
New files:
  app/composables/useCountries.js          — fetch countries (CRUD wrapper)
  app/composables/useFiles.js              — upload/delete files via Directus SDK
  app/composables/useCreateBusinessPartner.js — orchestration composable

Modified files:
  app/pages/Customers/Create.vue           — wire form to orchestration composable
```

The orchestration composable (`useCreateBusinessPartner`) accepts a form data object, `relationshipType` string, and an optional `existingPartner` object (for retry after partial failure). It handles:
1. Business partner creation (skipped if `existingPartner` is provided — retry scenario)
2. Partner-contact junction creation with nested contact + phone
3. Error handling at each step with retry-aware state
4. Returns `{ data, error, partialSuccess }` shape

File upload is **not** part of the orchestration composable — it happens in the page on file select (immediate upload for preview). The composable receives the already-uploaded file ID in `formData.logoFileId`.

On partial failure (partner created, contact failed), the composable returns the full partner object (including `sap_id`) and the page stores it. When the user hits Save again, the page passes the stored partner object back to the composable, which skips step 1 and retries only step 2. On retry success, the stored `sap_id` is available for redirect. The user never loses their form data and never leaves the page until everything succeeds.

This composable calls into existing single-responsibility composables (`useBusinessPartners`, `useBusinessPartnerGroups`) — it does not duplicate their CRUD logic. `useFiles` is used directly by the page for logo upload, not by the orchestration composable.

### Reference Data Fetching (on mount)

**Business Partner Groups:**
- Use `useBusinessPartnerGroups().fetchBusinessPartnerGroups({ relationshipType: 'customer' })` — already exists
- Returns array of `{ id, name, relationship_type }` — confirmed 15 customer groups exist
- `Select` uses `optionLabel="name"` and `optionValue="id"` — **no visual change**, only `v-model` stores an integer ID internally instead of a display string
- Current hardcoded array removed

**Countries:**
- New `useCountries` composable wrapping `useDirectusCrud('countries')`
- Fetch all countries with fields `['id', 'name', 'code', 'phone_code']`, sorted by `name`, limit `-1`
- Confirmed 245+ countries with phone codes exist in Directus
- `Select` uses `optionValue="id"` and a formatting function for `optionLabel` to display `"United States (+1)"` — **no visual change** to dropdown appearance
- Add `filter` prop to `Select` for typeahead search (245 countries needs search UX)
- Current hardcoded array removed

**Failure handling:** If either fetch fails or returns empty, show an inline error message (PrimeVue `Message` component, `severity="error"`) and disable the save button. The form remains visible but unusable until reference data loads successfully. A retry button allows re-fetching.

### Form Model — No Layout Changes

The `form` reactive object stays identical. Two fields change what they store internally:

| Form Field | What User Sees | What `v-model` Stores | Directus Target |
|---|---|---|---|
| `customerGroup` | Group name in dropdown | integer ID (was: label string) | `business_partners.business_partner_groups_id` |
| `country` | Country name in dropdown | integer ID (was: label string) | `phone_numbers.countries_id` |

All other fields remain unchanged. The UI is not modified — PrimeVue `Select` with `optionLabel`/`optionValue` props handles the display↔value separation.

New form field added:
| `logoFile` | n/a (not displayed) | File object or null | uploaded → `business_partners.logo_id` |

### Logo Upload

**Implementation approach — upload on file select:**
1. A hidden `<input type="file" accept="image/*">` is triggered by clicking the existing avatar placeholder
2. On file select: if `existingPartner` is set (partial success state), **ignore the file select** — the logo is already saved with the partner and cannot be changed from this page (the user can update it from the detail page later). Otherwise, if `form.logoFileId` already has a value (user is replacing a previous selection before first save), delete the previous file via `useFiles().removeFile(form.logoFileId)` first. Then upload the new file via `useFiles().uploadFile(file)` → returns `{ id, ... }` from Directus
3. Store the file ID in `form.logoFileId` and create a local preview URL via `URL.createObjectURL(file)`. Revoke the previous object URL if one exists.
4. On save: include `logo_id: form.logoFileId` in the business partner payload. Set `saveCompleted = true` before navigating.
5. On cancel/navigate away (`onBeforeUnmount`): delete the uploaded file **only if all three conditions are true**: `form.logoFileId` is set, `saveCompleted` is false, and `existingPartner` is null. If either `saveCompleted` or `existingPartner` is truthy, the file is attached to a saved partner record and must not be deleted.

**Page-level state for cleanup:**
```javascript
const saveCompleted = ref(false)

onBeforeUnmount(() => {
  if (form.logoFileId && !saveCompleted.value && !existingPartner.value) {
    removeFile(form.logoFileId)
  }
})
```

**New composable `useFiles.js`:**
```javascript
import { uploadFiles, deleteFile } from '@directus/sdk'
// useDirectus is auto-imported by Nuxt; tryCatch is auto-imported from app/utils/

export function useFiles() {
  const directus = useDirectus()

  async function uploadFile(file) {
    const formData = new FormData()
    formData.append('file', file)
    return await tryCatch(directus.request(uploadFiles(formData)))
  }

  async function removeFile(fileId) {
    return await tryCatch(directus.request(deleteFile(fileId)))
  }

  return { uploadFile, removeFile }
}
```

### Directus Validation Constraints (from schema — verified via MCP)

Mirror server-side validations client-side to prevent SAP flow failures:

1. **`business_partners.name`** — regex `^[^a-z]*$` → no lowercase. Auto-uppercase on save via `.toUpperCase()`. SAP stores names uppercase; Directus validation message: "Lowercase characters are not allowed".
2. **`business_partners.website`** — regex `^https?:\/\/((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(\/[^\s]*)?$` → must include protocol. Validate client-side when non-empty.
3. **`phone_numbers.number`** — regex `^[\d\s-]{4,20}$` → digits, spaces, dashes only, 4-20 chars.
4. **`phone_numbers.extension`** — regex `^[0-9]{1,10}$` → digits only, 1-10 chars.
5. **`contacts.email_address`** — server-side regex for valid email. Form already validates this.

### Save Operation — 2-Step with Partial Success Handling

The orchestration composable handles this sequence:

**Step 1: Create business partner**

```javascript
const partnerPayload = {
  name: formData.companyName.toUpperCase(),
  relationship_type: relationshipType,  // 'customer' or 'supplier'
  status: 'active',
  business_partner_groups_id: formData.customerGroup,  // integer FK
  website: formData.website || null,
  is_national_account: formData.isNationalAccount,
  logo_id: formData.logoFileId || null,  // uuid FK from file upload
}
```

SAP flow assigns `sap_id` before DB save. Response includes `sap_id`.

**Step 2: Create partner-contact junction with nested contact + phone number**

```javascript
const contactPayload = {
  business_partners_id: newPartner.id,
  status: 'active',
  contacts_id: {
    first_name: formData.firstName,
    last_name: formData.lastName || null,  // defensive fallback; form validation ensures non-empty
    job_title: formData.jobTitle || null,
    email_address: formData.emailAddress || null,
    phone_numbers: {
      create: [{
        phone_numbers_id: {
          number: formData.phoneNumber,
          extension: formData.extension || null,
          type: formData.phoneType,
          sms_capable: formData.smsCapable,
          countries_id: formData.country,  // integer FK
        }
      }]
    }
  }
}
```

**Why nested creation is required (not optional):**
The SAP flow code accesses `payload.contacts_id.first_name` and `contact.phone_numbers.create[].phone_numbers_id` directly. If the contact were created separately and linked by ID, the SAP flow would receive an integer instead of the full object — it would fail.

### Partial Success Strategy — Option B (Stay on Page + Retry Step 2)

A business partner without contacts is a **valid state** in both Directus and SAP. The orchestration composable returns:

```javascript
// All success
{ data: { partner, junction }, error: null, partialSuccess: false }

// Step 1 fails (nothing created)
{ data: null, error: partnerError, partialSuccess: false }

// Step 1 succeeds, Step 2 fails (partner exists, no contact)
{ data: { partner, junction: null }, error: contactError, partialSuccess: true }
```

The page handles each case:
- **Full success:** Success toast → navigate to `/customers/${partner.sap_id}`
- **Step 1 failure:** Error toast "Failed to create customer" with `error.message` → stay on page, form data preserved
- **Partial success (step 2 fails):** Warning toast "Customer created but contact could not be saved. Click Save to retry." → **stay on page**, store full `partner` object (including `sap_id`) in a local ref (`existingPartner`). **All partner-level inputs are disabled** (company name, customer group, website, national account, logo) — these fields are already persisted and the retry path skips step 1. Only contact-level fields remain editable (name, job title, email, phone). **Cancel button relabeled** to "Go to Customer" and navigates to `/customers/${existingPartner.sap_id}` (or `/customers` fallback) — the partner already exists, so "cancel" is no longer accurate. When the user clicks Save again, the page passes `existingPartner` to the composable, which retries only step 2. On retry success, `existingPartner.sap_id` is used for redirect.

### Redirect After Success

```javascript
// partner comes from composable result (fresh create) or existingPartner ref (retry)
const sapId = partner.sap_id
if (sapId) {
  navigateTo(`/customers/${sapId}`)
} else {
  navigateTo('/customers')
}
```

On fresh create, `partner` is the full Directus response (includes `sap_id`). On retry, `partner` is the stored `existingPartner` ref which also has `sap_id` (stored from the original step 1 response). Fallback to `/customers` only if `sap_id` is absent (SAP flow didn't run).

### Orchestration Composable Shape

```javascript
// app/composables/useCreateBusinessPartner.js

export function useCreateBusinessPartner() {
  const { createBusinessPartner, createPartnerContact } = useBusinessPartners()

  async function executeCreate(formData, relationshipType = 'customer', existingPartner = null) {
    let partner = null

    // Step 1: Create business partner (skip if retrying after partial failure)
    if (existingPartner) {
      partner = existingPartner
    } else {
      const { data: newPartner, error: partnerError } = await createBusinessPartner({
        name: formData.companyName.toUpperCase(),
        relationship_type: relationshipType,
        status: 'active',
        business_partner_groups_id: formData.customerGroup,
        website: formData.website || null,
        is_national_account: formData.isNationalAccount ?? false,
        logo_id: formData.logoFileId || null,
      })

      if (partnerError) {
        return { data: null, error: partnerError, partialSuccess: false }
      }
      partner = newPartner
    }

    // Step 2: Create contact + phone via nested junction
    const { data: junction, error: contactError } = await createPartnerContact({
      business_partners_id: partner.id,
      status: 'active',
      contacts_id: {
        first_name: formData.firstName,
        last_name: formData.lastName || null,
        job_title: formData.jobTitle || null,
        email_address: formData.emailAddress || null,
        phone_numbers: {
          create: [{
            phone_numbers_id: {
              number: formData.phoneNumber,
              extension: formData.extension || null,
              type: formData.phoneType,
              sms_capable: formData.smsCapable,
              countries_id: formData.country,
            }
          }]
        }
      }
    })

    if (contactError) {
      return { data: { partner, junction: null }, error: contactError, partialSuccess: true }
    }

    return { data: { partner, junction }, error: null, partialSuccess: false }
  }

  return { executeCreate }
}
```

### Junction Table Fields (Verified via MCP)

**`contacts_phone_numbers`** — `id` (PK auto-increment), `contacts_id` (int FK → contacts), `phone_numbers_id` (int FK → phone_numbers), `phone_numbers_sort` (int, nullable).

**`business_partners_contacts`** — `id` (PK auto-increment), `business_partners_id` (int FK), `contacts_id` (int FK), `status` (varchar, required, default 'active'), `business_partners_addresses_id` (int FK, nullable), notification booleans (defaults: transactional email/sms=true, marketing email/sms=false), `inactive_note` (nullable), `remarks` (nullable), `sap_id` (int, readonly — set by SAP flow), `shopify_id` (int, readonly).

## Specific Actions

### Phase 0: Prerequisites

The logged-in app user's Directus role needs specific permissions. These are **environment prerequisites**, not code changes — verify before implementation.

**Required (blocks implementation if missing):**

| Collection | Permission | Used By |
|---|---|---|
| `business_partner_groups` | `read` | Reference data dropdown |
| `countries` | `read` | Reference data dropdown |
| `business_partners` | `create` | Step 1: create partner |
| `business_partners_contacts` | `create` | Step 2: create junction |
| `contacts` | `create` | Step 2: nested contact creation |
| `phone_numbers` | `create` | Step 2: nested phone creation |
| `contacts_phone_numbers` | `create` | Step 2: nested junction creation |
| `directus_files` | `create` | Logo upload |

**Optional (verified at environment level in Phase 1 — does not block implementation):**

| Collection | Permission | Used By | If Missing |
|---|---|---|---|
| `directus_files` | `delete` | Logo cleanup on cancel/reselection/unmount | Orphaned files accumulate. Periodic Directus cleanup handles them. |
| `business_partners_contacts` | `read`, `delete` | Result B pre-retry cleanup | Cleanup skipped; step 2 attempted anyway. If duplicate junction rejected, user directed to detail page. |

**Product decision: cleanup is best-effort.** Logo deletion and pre-retry junction cleanup are housekeeping operations — their failure must never block the user's primary workflow (saving a customer). This is a deliberate design choice, not just a permission fallback.

**Runtime handling:** All cleanup calls use `tryCatch`. On error, the calling code logs and continues — but with differentiated severity:
- **403 (permission denied):** `console.warn` — expected in environments where optional delete permissions are absent. No user-facing message.
- **Other errors (5xx, network, malformed):** `console.error` — unexpected operational failure. Still non-blocking (cleanup is best-effort), but logged at error level for observability. These indicate a system issue worth investigating, not an accepted environment constraint.

No feature flags or permission-detection code. The `tryCatch` `{ error }` response naturally provides the error object for severity classification.

### Phase 1: Verification (stop/go gate — must pass before Phase 2)

1. **Verify Directus role permissions** — Confirm the app user's role has all **required** permissions from Phase 0. Use Directus admin panel or MCP to inspect the role policy. Missing required permissions must be granted before proceeding. Also check optional delete permissions and note which are present — no code changes needed either way, since cleanup is best-effort by design (403 logged as `warn`, other errors as `error`, neither blocks the workflow).

2. **Verify nested create success path** — Via MCP `items` tool or curl, create a `business_partners_contacts` record with nested `contacts_id` object containing `phone_numbers: { create: [...] }`. Confirm: (a) all nested records created, (b) SAP flow receives full payload, (c) response includes created IDs.

3. **Verify nested create failure path** — Force a failure during `createPartnerContact` (e.g., invalid data that triggers SAP flow rejection). Inspect `contacts`, `phone_numbers`, `contacts_phone_numbers`, and `business_partners_contacts` tables. Classify residue:
   - **Result A — atomic failure (no orphans in any table):** Step 2 retry is safe. Proceed to Phase 2 as written.
   - **Result B — orphan records left behind:** Proceed to Phase 2 with pre-retry cleanup (see step 6). The cleanup strategy differs by residue type:
     - **`business_partners_contacts` junction exists:** Delete it before retry (step 6 cleanup logic handles this).
     - **Orphan `contacts`, `phone_numbers`, `contacts_phone_numbers` without a junction:** These are inert — no FK back to the partner, no data integrity risk, no duplicate risk on retry (step 2 creates entirely new records). **Accepted as benign.** Periodic Directus cleanup can remove them. They do NOT block the retry.
   - **Stop condition:** The only result that would block Phase 2 is if orphan records cause a **uniqueness constraint violation** or **SAP duplicate** on retry. If Phase 1 reveals that, the retry model must be reconsidered before proceeding.

### Phase 2: Implementation

4. **Create `app/composables/useCountries.js`** — CRUD wrapper for `countries` collection. Single function `fetchCountries()`. Fields: `['id', 'name', 'code', 'phone_code']`. Sort: `['name']`. Limit: `-1`. Pattern: identical to `useBusinessPartnerGroups.js`.

5. **Create `app/composables/useFiles.js`** — File upload/delete wrapper using `@directus/sdk` `uploadFiles` and `deleteFile`. Two functions: `uploadFile(file)` returns `{ data, error }` with Directus file object; `removeFile(fileId)` deletes an uploaded file. Uses `tryCatch` pattern. This is the first file upload implementation in the project.

6. **Create `app/composables/useCreateBusinessPartner.js`** — Orchestration composable. Single function `executeCreate(formData, relationshipType, existingPartner = null)` that handles the 2-step create sequence with partial success awareness. When `existingPartner` is provided (retry scenario), skips step 1 and retries only step 2 using `existingPartner.id`. Returns `{ data, error, partialSuccess }` where `data.partner` is the full partner object (including `sap_id`). Calls `useBusinessPartners().createBusinessPartner()` and `useBusinessPartners().createPartnerContact()`. Reusable for both Customer and Supplier create pages.
   - **If Phase 1 Result B:** Add pre-retry cleanup inside `executeCreate` when `existingPartner` is provided. Use a dedicated `useDirectusCrud('business_partners_contacts')` instance (instantiated inside this composable) to query for orphan junctions:
     1. `fetchMany({ filter: { business_partners_id: { _eq: existingPartner.id } }, fields: ['id', 'contacts_id'] })` — find any junction records for this partner.
     2. If records exist, delete each junction via `removeOne(junctionId)`. The orphaned `contacts` and `phone_numbers` records are left in place — they are not linked to anything and pose no data integrity risk. Directus cascading or periodic cleanup can handle them. Deleting only the junction is sufficient because step 2 creates a fresh junction + contact + phone number via nested creation.
     3. After cleanup, proceed with the normal step 2 `createPartnerContact` call.

7. **Update `app/pages/Customers/Create.vue` — wire reference data:**
   - Replace hardcoded `customerGroupOptions` array with `ref([])`, populate via `fetchBusinessPartnerGroups({ relationshipType: 'customer' })` on mount.
   - Replace hardcoded `countryOptions` array with `ref([])`, populate via `fetchCountries()` on mount.
   - Fetch both in parallel via `Promise.all` in `onMounted`.
   - Add `optionLabel="name"` and `optionValue="id"` to Customer Group `Select`.
   - Add `optionValue="id"` and formatting function for `optionLabel` to Country `Select`. Add `filter` prop for typeahead.
   - Add error handling: if either fetch fails, show `Message` component with error and disable save.

8. **Update `app/pages/Customers/Create.vue` — add logo upload:**
   - Add hidden `<input type="file" accept="image/*">` ref.
   - Wire avatar placeholder click to trigger the file input.
   - On file select: if `existingPartner` is set, ignore (logo locked after partial success). Otherwise, if `form.logoFileId` already exists (re-selection), call `removeFile()` on the previous file first. Then call `uploadFile(file)`, store returned file ID in `form.logoFileId`, create preview via `URL.createObjectURL` (revoke previous URL). Disable the avatar click handler when `existingPartner` is set.
   - Display preview image in avatar area (replacing the placeholder icon).
   - Add `saveCompleted` ref (initially `false`). Set to `true` in `handleSave` before navigating on full success.
   - On unmount or cancel (`onBeforeUnmount`): call `removeFile()` only if `form.logoFileId` is set AND `saveCompleted` is false AND `existingPartner` is null. Otherwise the file is attached to a saved partner — do not delete.

9. **Update `app/pages/Customers/Create.vue` — wire `handleSave()` to orchestration composable:**
   - Add `isSaving` ref and `existingPartner` ref (initially `null`).
   - Call `useCreateBusinessPartner().executeCreate(form, 'customer', existingPartner.value)`.
   - Handle three result cases:
     - **Full success:** Success toast → navigate to `/customers/${partner.sap_id}` (fall back to `/customers` if `sap_id` absent).
     - **Step 1 failure:** Error toast "Failed to create customer" → stay on page, form data preserved.
     - **Partial success (step 2 fails):** Warning toast "Customer created but contact could not be saved. Click Save to retry." → stay on page, set `existingPartner.value = partner` (full object with `sap_id`). Disable all partner-level inputs via `:disabled="!!existingPartner"`. Contact-level fields remain editable. Relabel Cancel button to "Go to Customer" (via `BaseActionButtons` cancel label prop or conditional text) — navigates to `/customers/${existingPartner.sap_id}` or `/customers` fallback. On next Save click, composable skips step 1 and retries only step 2. On retry success, uses `existingPartner.value.sap_id` for redirect.
   - Wire `isSaving` to `BaseActionButtons` `:save-loading` and `:save-disabled`.
   - Do NOT add `<Toast />` — already rendered in `default.vue` layout (line 24).

10. **Update `app/pages/Customers/Create.vue` — add server-matching validation:**
   - Auto-uppercase company name on submit (`.toUpperCase()` in composable, not on input — user types naturally).
   - Website validation: when non-empty, must match `^https?:\/\/`.
   - Phone number validation: must match `^[\d\s-]{4,20}$`.

11. **Update `app/pages/Customers/Create.vue` — change phone type default:**
    - Change `form.phoneType` from `'direct'` to `'general'` to match Directus default. The extension field in the UI is contextually relevant for general phone numbers.

## Possible Blockers

- **SAP flow failure UX** — SAP flows are blocking filters. If SAP API is unreachable, the Directus create operation fails entirely and returns a Directus error. The error message may be opaque (generic 500). The frontend should show a user-friendly fallback: "Failed to create customer. Please try again or contact support."

- **SAP salesperson code** — The SAP flow reads `sap_salespersoncode` from the current Directus user. If the user doesn't have this field set, the SAP request may fail. This is a data dependency, not a frontend concern, but worth noting for debugging.

- **Nested create failure atomicity** — The retry model assumes step 2 failure leaves no orphan records. This is verified in Phase 1 (steps 2–3). If Directus leaves partial records, the chosen mitigation is pre-retry cleanup (step 6, Result B path) — delete orphan `business_partners_contacts` junction records via `useDirectusCrud` before retrying. Orphaned `contacts`/`phone_numbers` records are left for periodic cleanup (no integrity risk).

- **File upload cleanup** — If the user uploads a logo, then navigates away without saving, the uploaded file is orphaned in Directus. The `onBeforeUnmount` cleanup handles this for in-app navigation, but a browser tab close would leave the orphan. This is acceptable — orphaned files can be cleaned up periodically via a Directus flow or manual cleanup.

- **Country dropdown size** — 245+ countries. The `filter` prop on PrimeVue `Select` enables typeahead search which mitigates this, but verify the UX is acceptable with the designer.

## Verified Evidence (MCP Session)

The following claims in this plan were verified during the planning session via Directus MCP server queries. These are not assumptions.

| Claim | Verification Method | Key Finding |
|---|---|---|
| SAP flow assigns `sap_id` on partner create | `mcp__directus__flows` read — flow `56fd14aa`, operation `exec_bq0ml` sets `payload.sap_id = retrieve_sap_id.CardCode` | Blocking filter, returns `$last` |
| SAP contact flow reads nested payload | `mcp__directus__flows` read — flow `63ed0f39`, operation `build_body` accesses `payload.contacts_id.first_name` and `contact.phone_numbers.create` | Must use nested creation |
| `business_partners.name` no lowercase | `mcp__directus__fields` read — validation regex `^[^a-z]*$`, message "Lowercase characters are not allowed" | Auto-uppercase on save |
| `contacts_phone_numbers` junction fields | `mcp__directus__fields` read — `contacts_id` (int FK), `phone_numbers_id` (int FK) | Standard junction |
| `business_partners_contacts` junction fields | `mcp__directus__fields` read — includes `status` (required, default 'active'), `sap_id` (readonly) | SAP flow writes sap_id |
| Customer groups exist (15 records) | `mcp__directus__items` read — 15 groups returned with `relationship_type='customer'` | Data confirmed |
| Countries exist (245+ records) | `mcp__directus__items` read — returned with `id`, `name`, `code`, `phone_code` | Data confirmed |
| `phone_numbers.type` default is `'general'` | `mcp__directus__fields` read — `default_value: "general"` | Form default should match |
| `contacts.last_name` is nullable | `mcp__directus__fields` read — `is_nullable: true` | Form requires it; `\|\| null` is defensive fallback only |
| `<Toast />` in default layout | `app/layouts/default.vue` line 24 | Do NOT add duplicate |