

# Diagnosis: Contacts Not Found in List Builder

## Root Cause

This is **not a code bug** — it's a tenant context issue. You are currently browsing as **"Roof Kings Coatings"** (tenant `71fc0c5c`), which only has **3 contacts total** (and only 1 with a phone number: Jared Janacek). The contact "Chris O" exists under **"O'Brien Contracting"** (tenant `14de934e`).

The list builder correctly queries contacts scoped to the active tenant via `.eq('tenant_id', tenantId)`.

## What to Do

**Immediate fix:** Switch your active company back to "O'Brien Contracting" using the tenant switcher in the sidebar, then open the list builder again. Your contacts will appear.

## Optional UX Improvement

To prevent this confusion in the future, add a visible tenant/company indicator inside the List Builder dialog header so the user always knows which company's contacts they're browsing.

### Change

| File | Change |
|---|---|
| `src/components/call-center/CallCenterListBuilder.tsx` | Add a small badge or label below the dialog title showing the current company name (from user metadata or tenant context) so it's obvious which company's contacts are being listed |

This is a minor 1-line UI addition — the core functionality is working correctly.

