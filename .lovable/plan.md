

# Restore Location Filtering on Contacts in Global Search

## Problem

The previous migration removed the `location_id` filter from the Contacts section of `search_contacts_and_jobs`. The user has clarified that **both contacts and leads are location-specific** — East Coast and West Coast should not see each other's contacts or leads.

## Solution

Add the `p_location_id` filter back to the Contacts query block, matching the same pattern used in the Leads section.

## Changes

**Database migration: Update `search_contacts_and_jobs` function**

Add the location filter back to the Contacts WHERE clause (after line 41):

```text
Before:
  WHERE c.tenant_id = p_tenant_id
    AND c.is_deleted = false
    AND (...)

After:
  WHERE c.tenant_id = p_tenant_id
    AND c.is_deleted = false
    AND (
      p_location_id IS NULL
      OR c.location_id = p_location_id
      OR (c.location_id IS NULL AND c.created_by = auth.uid())
    )
    AND (...)
```

This is the same three-way check used in the Leads section:
- If no location is selected (`p_location_id IS NULL`), show all
- If a location is selected, show contacts matching that location
- Fallback: show contacts with no location if the current user created them

## Technical Details

| Item | Detail |
|------|--------|
| Migration | `CREATE OR REPLACE FUNCTION search_contacts_and_jobs` |
| Contacts section | Re-add `location_id` filter |
| Leads section | No changes (already location-scoped) |
| Frontend | No changes needed |

## Result

- Searching from East Coast shows only East Coast contacts and leads
- Searching from West Coast shows only West Coast contacts and leads
- "All Locations" mode (no location selected) shows everything within the tenant
