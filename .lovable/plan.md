

# Fix: Dashboard Pipeline Counts Don't Match Pipeline Board

## Root Cause

The dashboard and the pipeline board use **different filtering logic**, causing the numbers to disagree:

- **Dashboard** (`Dashboard.tsx` line 213-216): For non-admin roles, it filters pipeline entries to only those where `assigned_to` or `created_by` matches the current user. The admin roles list is `['master', 'corporate', 'office_admin']` -- notably missing `owner`.
- **Pipeline Board** (`usePipelineData.ts`): Shows ALL entries for the tenant with NO role-based filtering.

Since you're logged in as `owner`, the dashboard treats you as a non-admin and only counts entries you personally created or are assigned to (showing 2 Leads). Meanwhile the pipeline board shows all 89 Leads for the whole company.

## Fix

Two changes are needed to bring these into alignment:

### 1. Add `owner` to the dashboard admin roles list

In `src/features/dashboard/components/Dashboard.tsx` (line 213), add `owner` to the `adminRoles` array so that owners see company-wide pipeline counts on the dashboard, matching what they see on the pipeline board.

```text
Before: const adminRoles = ['master', 'corporate', 'office_admin'];
After:  const adminRoles = ['master', 'owner', 'corporate', 'office_admin'];
```

### 2. Handle the 1,000-row PostgREST default limit

The dashboard fetches `status` for every pipeline entry to count them client-side. If the tenant has more than 1,000 entries, PostgREST silently truncates the results, causing undercounts.

Replace the client-side counting approach with a database RPC function that does the aggregation server-side (no row limit):

- Create a new SQL migration with an RPC function `get_pipeline_status_counts(p_tenant_id, p_location_id, p_user_id, p_user_role)` that runs:
  ```sql
  SELECT status, count(*)::int as count
  FROM pipeline_entries
  WHERE tenant_id = p_tenant_id
    AND is_deleted = false
    AND (p_location_id IS NULL OR location_id = p_location_id)
  GROUP BY status;
  ```
- Update the dashboard query to call this RPC instead of fetching all rows and counting in JavaScript.

### Files Modified

1. **New SQL migration** -- Create `get_pipeline_status_counts` RPC function
2. **`src/features/dashboard/components/Dashboard.tsx`** -- Replace client-side count logic with RPC call and add `owner` to admin roles

