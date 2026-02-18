

# Make Contacts Location-Independent in Global Search

## Problem

Currently, the `search_contacts_and_jobs` SQL function filters **both** contacts and leads by `location_id`. The user wants:

- **Contacts** -- shared across the organization, visible regardless of selected location
- **Leads** -- location-scoped, so East Coast and West Coast cannot see each other's leads

## Solution

Remove the `location_id` filter from the **Contacts** section of the SQL function while keeping it on the **Leads** section.

## Changes

**Database migration: Update `search_contacts_and_jobs` function**

Remove lines 31-34 from the Contacts query:

```text
Before (Contacts WHERE clause):
  WHERE c.tenant_id = p_tenant_id
    AND c.is_deleted = false
    AND (
      p_location_id IS NULL
      OR c.location_id = p_location_id
      OR (c.location_id IS NULL AND c.created_by = auth.uid())
    )
    AND (...)

After (Contacts WHERE clause):
  WHERE c.tenant_id = p_tenant_id
    AND c.is_deleted = false
    AND (...)
```

The Leads section remains unchanged -- it keeps the `p_location_id` filter so leads are properly isolated by location.

## Technical Details

| Item | Detail |
|------|--------|
| Migration | `CREATE OR REPLACE FUNCTION search_contacts_and_jobs` |
| Contacts section | Remove `location_id` filter (lines 31-34) |
| Leads section | Keep `location_id` filter unchanged (lines 64-68) |
| Frontend | No changes -- `CLJSearchBar.tsx` already passes `currentLocationId` correctly |

## Result

- Searching "Nicole" from East Coast shows: **Nicole Walker (Contact)** + only her East Coast lead(s)
- Searching "Nicole" from West Coast shows: **Nicole Walker (Contact)** + only her West Coast lead(s)
- Contacts are always visible regardless of location selection
- Leads remain properly isolated by location

