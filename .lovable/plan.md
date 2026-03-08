

# Show Dialed Number + Contact Name in Call Log

## Problem
The call log currently shows only the contact name (e.g., "Christopher OBrien") but not the phone number that was called. Users need to see both the number and the associated contact name.

## Tenant Isolation (Already Correct)
The calls query in `CallCenterPage.tsx` already filters by `tenant_id` via `useEffectiveTenantId()`, and the `contacts` join is scoped by the foreign key `contact_id`. Each company's calls and contacts are already isolated. No changes needed here.

## UI Change: `src/pages/CallCenterPage.tsx`

In the call list item (around lines 601-619), update the display to show:
- **Primary line**: Contact name (if found) — keep as-is
- **Secondary line**: Add the dialed phone number (`to_number` for outbound, `from_number` for inbound) below or next to the contact name
- When no contact is found, show just the phone number (current behavior)

The change is roughly:
```
Christopher OBrien              →    Christopher OBrien
Mar 8, 3:26 AM · 40 seconds         +1 (770) 842-0812
                                     Mar 8, 3:26 AM · 40 seconds
```

Format the phone number for readability (e.g., `+17708420812` → `(770) 842-0812`).

## Files Modified
- `src/pages/CallCenterPage.tsx` — add phone number display to each call row

