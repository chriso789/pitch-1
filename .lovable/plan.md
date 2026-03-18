

# Fix: Projects Should Appear in Search Results

## Investigation Findings

1. **Murphy's pipeline entry is soft-deleted** (`is_deleted = true`) with status `'lead'` — there is no active project for Murphy. The entry was deleted at some point, which is why it doesn't appear in search.

2. **Separate bug**: The `search_contacts_and_jobs` RPC function never returns `entity_type = 'job'`. All pipeline entries are returned as `'lead'` regardless of their status. The CLJSearchBar UI has a "Jobs" group that will never populate.

## Changes

### 1. Update `search_contacts_and_jobs` RPC to categorize jobs separately

Split the LEADS union into two: one for actual leads (non-project statuses) and one for jobs (status = 'project'). The job entries will return `entity_type = 'job'` so they appear in the Jobs group in the search dropdown.

```sql
-- Replace the single LEADS block with two blocks:

-- LEADS (non-project pipeline entries)
SELECT 'lead'::text AS entity_type, ...
FROM pipeline_entries pe
WHERE ... AND pe.status != 'project'

UNION ALL

-- JOBS (pipeline entries with status = 'project')
SELECT 'job'::text AS entity_type, ...
FROM pipeline_entries pe
WHERE ... AND pe.status = 'project'
```

### 2. Also search `lead_name` field

The RPC doesn't currently search the `lead_name` column on `pipeline_entries`. Add it to the search conditions so entries with a custom lead name are findable.

### 3. Regarding Murphy specifically

Murphy's pipeline entry is **soft-deleted**. Options:
- Restore it (set `is_deleted = false`) if the deletion was unintentional
- Create a new lead for Murphy

This is a data issue, not a code bug. I'll note this for you but the code fix above ensures future projects appear correctly in search.

## Files Changed

| File | Change |
|------|--------|
| New migration SQL | Update `search_contacts_and_jobs` RPC to split leads vs jobs and search `lead_name` |

