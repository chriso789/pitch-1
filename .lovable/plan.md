

## Deduplicate Search Results: Show Latest Pipeline Stage Only

### Problem
When a lead is converted to a project, the search shows **three results** for the same entity: the Contact, the Lead, AND the Job/Project. The user wants to see only the **most advanced stage** -- if a lead became a project, show only the Contact + Project, not the Lead.

### Rules
1. If a lead has been converted to a project: show **Contact + Project** (hide the lead)
2. If a lead has NOT been converted: show **Contact + Lead** (no project exists)
3. If a contact has multiple leads at different addresses, show each lead/project separately
4. Always show the Contact entry itself

### Root Cause
The `search_contacts_and_jobs` RPC function (line 60-88) returns ALL pipeline_entries as "lead" results regardless of whether a project already exists for that entry. It also returns the project separately (line 92-121). This creates duplicate results.

### Solution
Modify the SQL RPC function to **exclude leads that have a linked project**. The `projects` table has a `pipeline_entry_id` column -- if a project exists for a pipeline entry, that lead should be skipped in the Leads section.

### Change

**New migration file** -- Update `search_contacts_and_jobs` RPC:

In the **LEADS** section (pipeline_entries query), add a filter:

```sql
-- LEADS: exclude entries that have been converted to projects
AND NOT EXISTS (
  SELECT 1 FROM projects proj 
  WHERE proj.pipeline_entry_id = pe.id
)
```

This single addition ensures:
- Leads that became projects are excluded from the "Leads" group
- The project still appears in the "Jobs" group
- Leads without projects still appear normally
- Contacts with multiple leads show each one correctly (only those without projects)

### Also: Fix Job navigation route

In `CLJSearchBar.tsx` line 130, jobs currently navigate to `/project/:id` which now redirects to `/lead/:id` via the ProjectDetails redirect. Update the job route to navigate directly to `/lead/:pipeline_entry_id` using the pipeline_entry_id from the project, avoiding the redirect hop. This requires the RPC to return `pipeline_entry_id` for job results.

**Updated RPC for Jobs section:**
```sql
-- PROJECTS: return pipeline_entry_id as entity_id so navigation goes directly to /lead/:id
SELECT 
  'job'::text AS entity_type,
  pe.id AS entity_id,  -- Use pipeline_entry_id instead of project id
  ...
```

**Updated CLJSearchBar.tsx line 128-131:**
```typescript
const routes: Record<string, string> = {
  contact: `/contact/${result.entity_id}`,
  lead: `/lead/${result.entity_id}`,
  job: `/lead/${result.entity_id}`  // Now points to pipeline entry directly
};
```

### Summary of Changes

| File | Change |
|------|--------|
| New migration SQL | Add `NOT EXISTS` clause to leads query; change jobs query to return `pipeline_entry_id` as `entity_id` |
| `src/components/CLJSearchBar.tsx` | Update job route from `/project/` to `/lead/` (line 130) |

