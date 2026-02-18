

# Show Both Contact and Lead in Global Search Results

## Problem

The `search_contacts_and_jobs` database function contains deduplication logic (lines 89-92) that excludes Lead entries from search results when a corresponding Project record exists:

```sql
AND NOT EXISTS (
  SELECT 1 FROM projects proj 
  WHERE proj.pipeline_entry_id = pe.id
)
```

This means Nicole Walker only appears as a "Contact" in search, even though she also has a Lead/Pipeline entry the user needs to access via `/lead/:id`.

## Solution

Remove the `NOT EXISTS` deduplication clause from the Leads section of the RPC so that pipeline entries always appear in search results regardless of project conversion status. This lets users navigate to both the Contact Profile (`/contact/:id`) and the Lead Details page (`/lead/:id`).

Since leads and projects both route to `/lead/:id`, also remove the separate Projects (Jobs) section to avoid showing the same pipeline entry twice (once as "Lead" and once as "Job").

## Changes

**New migration SQL:**

1. **Remove the `NOT EXISTS` clause** from the Leads query block so all matching pipeline entries appear.
2. **Remove the Projects/Jobs `UNION ALL` block** since those entries will now appear in the Leads section. A lead that has been converted to a project will still show as a "Lead" result routing to `/lead/:id`, which is the unified page.

The updated function keeps two sections:
- **Contacts** -- returns contact records, navigates to `/contact/:id`
- **Leads** -- returns all pipeline entries (pre- and post-project), navigates to `/lead/:id`

**No frontend changes needed** -- the `CLJSearchBar.tsx` component already handles `contact` and `lead` entity types with proper routing and grouping.

## Technical Details

| Item | Detail |
|------|--------|
| Migration | New SQL migration dropping and recreating `search_contacts_and_jobs` |
| Removed | `NOT EXISTS (SELECT 1 FROM projects ...)` clause from leads query |
| Removed | Entire `UNION ALL` projects/jobs query block |
| Kept | Contacts query (unchanged) and Leads query (minus dedup filter) |

## Result

- Searching "Nicole" shows two results: **Nicole Walker (Contact)** and **Nicole Walker (Lead)**
- Clicking Contact navigates to `/contact/:id`
- Clicking Lead navigates to `/lead/:id`
- No duplicate entries since the separate Jobs section is removed
