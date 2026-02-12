

## Filter Sales Rep Dropdown by Location

### Problem
The Sales Rep dropdown on the Lead Details page shows ALL reps across the entire company (both East Coast and West Coast). Patricia Stevenson is a West Coast lead (Sarasota, FL) but the dropdown shows East Coast reps like Jared Janacek, Michael Grosso, Taylor Johnston, and Uri Kaweblum alongside West Coast reps.

### Root Cause
In `src/hooks/useLeadDetails.ts`, the `fetchSalesReps` function (line 259) only filters by `tenant_id` -- it does not consider the lead's `location_id`. The Pipeline page already does location-based rep filtering correctly using `user_location_assignments`, but this pattern was never applied to the Lead Details page.

### Solution
Update `fetchSalesReps` to accept the lead's `location_id` and filter reps through the `user_location_assignments` table. Elevated roles (master, owner, corporate, office_admin) should still appear regardless of location assignment since they have cross-location visibility.

### Changes

**File: `src/hooks/useLeadDetails.ts`**

1. **Update `fetchSalesReps` signature** (line 259): Accept `locationId` as a second parameter
2. **Add location filtering logic**: 
   - Query `user_location_assignments` for the lead's `location_id` to get user IDs assigned to that location
   - Filter reps to only those assigned to the lead's location
   - Always include elevated roles (owner, corporate, office_admin) regardless of location -- these are managers with company-wide permission
   - If no `location_id` on the lead, fall back to showing all tenant reps (current behavior)
3. **Update the query call** (line 316): Pass `location_id` from the lead data to the query, and add it to the query key for proper cache invalidation

```text
Before:
  fetchSalesReps(tenantId)
  -> SELECT * FROM profiles WHERE tenant_id = X
  -> Returns ALL reps in company

After:
  fetchSalesReps(tenantId, locationId)
  -> SELECT user_id FROM user_location_assignments WHERE location_id = Y
  -> SELECT * FROM profiles WHERE tenant_id = X AND (id IN location_users OR role IN elevated_roles)
  -> Returns only location-specific reps + managers
```

### Technical Details

| Item | Detail |
|------|--------|
| File | `src/hooks/useLeadDetails.ts` |
| Function | `fetchSalesReps` (lines 258-273) |
| Query key update | Line 315: add `locationId` to cache key |
| Query call update | Line 316: pass `leadQuery.data?.location_id` |
| Elevated roles (always visible) | owner, corporate, office_admin |
| Location-bound roles (filtered) | regional_manager, sales_manager, project_manager |
| Fallback | If lead has no `location_id`, show all tenant reps (current behavior) |

