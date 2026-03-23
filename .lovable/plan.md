

## Plan: Fix Pipeline Stages Settings to Use Active Tenant ID

### Problem

The `PipelineStageManager` settings component uses `profile.tenant_id` (the user's home tenant) for all queries and inserts. When a user switches to another company (e.g., Tristate), the settings page still queries the home tenant's stages — showing "No pipeline stages configured" even though Tristate has stages in the database.

The same bug exists in the insert path (line 147), so creating a stage while viewing Tristate would incorrectly create it under the home tenant.

### Fix

**File: `src/components/settings/PipelineStageManager.tsx`**

1. Import `useEffectiveTenantId` hook
2. Replace all `profile.tenant_id` references with the effective tenant ID:
   - **Line 301/307**: `fetchStages` query filter — use effective tenant ID
   - **Line 147**: Insert new stage — use effective tenant ID
3. Update the `useEffect` dependency to re-fetch when effective tenant changes

This is a 3-line change pattern — swap the tenant source. No schema or structural changes needed.

### Files to Change

1. `src/components/settings/PipelineStageManager.tsx` — use `useEffectiveTenantId()` instead of `profile.tenant_id`

