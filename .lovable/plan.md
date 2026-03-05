

# Integrate Google Address Verification Across All Address Entry Points

## Current State

There are two existing address verification components:
1. **`AddressVerification`** (`src/shared/components/forms/AddressVerification.tsx`) -- Full component with street/city/state/zip fields, autocomplete on street input, and a "Verify" button that calls the Google Address Validation API. Used in **ContactForm** and **LocationManagement**.
2. **`AddressAutocomplete`** (`src/components/AddressAutocomplete.tsx`) -- Single-field autocomplete that returns parsed address components. Used in **LeadForm**.

Several forms currently use **plain text inputs** for addresses with no Google verification:

## Forms That Need Updating

| Form | File | Current Approach |
|------|------|-----------------|
| **Contact Details Tab** (edit contact) | `src/components/contact-profile/ContactDetailsTab.tsx` | Plain `<Input>` for street, city, state, zip (lines 595-651) |
| **Job Creation Dialog** | `src/components/JobCreationDialog.tsx` | Plain `<Input>` + manual autocomplete/verification logic (lines 307-318) |
| **Enhanced Lead Creation Dialog** | `src/components/EnhancedLeadCreationDialog.tsx` | Plain `<Input>` + manual autocomplete/verification logic (lines 798-800+) |
| **Company Admin Page** | `src/pages/admin/CompanyAdminPage.tsx` | Plain `<Input>` fields for company address |

Forms **already** using verification (no changes needed):
- **ContactForm** -- uses `AddressVerification`
- **LeadForm** -- uses `AddressAutocomplete`
- **LocationManagement** -- uses `AddressVerification`

## Plan

### 1. ContactDetailsTab -- Replace plain inputs with `AddressVerification`

**File: `src/components/contact-profile/ContactDetailsTab.tsx`**

- Import `AddressVerification` from `@/shared/components/forms/AddressVerification`
- Replace the 4 separate `FormField` blocks for street/city/state/zip (lines 595-651) with a single `AddressVerification` component
- Pass `initialAddress` from the current form values
- On `onAddressVerified`, update all 4 form fields (`address_street`, `address_city`, `address_state`, `address_zip`) via `form.setValue()`
- Keep the form fields in state so they still submit correctly

### 2. JobCreationDialog -- Replace plain input with `AddressVerification`

**File: `src/components/JobCreationDialog.tsx`**

- Import `AddressVerification`
- Replace the plain `<Input>` for address (line 309) and the manual autocomplete/suggestion logic with `AddressVerification`
- Remove the manual `handleAddressVerification`, `addressSuggestions`, `showAddressPicker` state and related code
- On `onAddressVerified`, store the structured address + lat/lng in `selectedAddress`
- When `useSameAddress` is checked, pass contact's address as `initialAddress`

### 3. EnhancedLeadCreationDialog -- Replace plain input with `AddressVerification`

**File: `src/components/EnhancedLeadCreationDialog.tsx`**

- Import `AddressVerification`
- Replace the plain address `<Input>` (line 798) and all manual verification logic (`handleAddressVerification`, `addressSuggestions`, `showAddressPicker`, etc.) with `AddressVerification`
- On `onAddressVerified`, update `formData.address` and store parsed components + lat/lng
- Keep the verified/manual badge logic but tie it to the verification status from the component

### 4. CompanyAdminPage -- Replace plain inputs with `AddressVerification`

**File: `src/pages/admin/CompanyAdminPage.tsx`**

- Import `AddressVerification`
- In the edit dialog, replace the plain address input fields with `AddressVerification`
- Pass `initialAddress` from the company's existing address
- On `onAddressVerified`, update `formData.address_street/city/state/zip`

Each replacement removes ~30-60 lines of manual address handling and replaces it with 10-15 lines using the shared component, ensuring consistent Google-verified addresses everywhere.

