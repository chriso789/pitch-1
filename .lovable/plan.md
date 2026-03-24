

## Plan: Lock Down Cross-Tenant Data Leakage in Pipeline

### Root Cause

The **Pipeline page** (`src/features/pipeline/components/Pipeline.tsx`) does NOT include an explicit `tenant_id` filter on its `pipeline_entries` query (line 240-277). It relies entirely on the `get_user_tenant_id()` RLS function. By contrast, the **Contacts page** already has `.eq('tenant_id', effectiveTenantId)` (line 428).

The `effectiveTenantId` is already computed at line 204 in Pipeline.tsx but is only used for reps and locations queries — not for the main pipeline query. This means any RLS timing issue, caching, or stale session can leak data across tenants.

Additionally, the realtime subscription (line 125-142) subscribes to ALL `pipeline_entries` changes globally without any tenant filter, meaning changes from other tenants trigger refetches.

### Changes

#### 1. `src/features/pipeline/components/Pipeline.tsx` — Add explicit tenant filter

- **Pipeline query** (line 260): Add `.eq('tenant_id', effectiveTenantId)` right after `.eq('is_deleted', false)`. Belt-and-suspenders with RLS.
- **Realtime subscription** (line 125-142): Add `filter: 'tenant_id=eq.{effectiveTenantId}'` to the postgres_changes subscription so only the current tenant's changes trigger refetches. Also make the channel name tenant-specific and add `effectiveTenantId` to the useEffect dependency array.
- **Early return**: If `effectiveTenantId` is null/undefined, skip fetching entirely (don't show stale data).

#### 2. `src/hooks/usePipelineData.ts` — Add tenant filter

- The `fetchPipelineEntries` function (line 38-41) also queries `pipeline_entries` without an explicit tenant filter. Add `.eq('tenant_id', tenantId)` parameter.

#### 3. `src/features/dashboard/components/TaskDashboard.tsx` — Verify tenant scoping

- Check if `pipeline_entries` join query at line 59 needs explicit tenant filtering (currently scoped by `assigned_to` user ID which limits exposure, but should still add belt-and-suspenders).

### Technical Details

The key fix in Pipeline.tsx (the most impactful change):

```text
Pipeline query:
  BEFORE:  .eq('is_deleted', false)  // relies on RLS alone
  AFTER:   .eq('is_deleted', false).eq('tenant_id', effectiveTenantId)

Realtime channel:
  BEFORE:  event: '*', table: 'pipeline_entries'  // all tenants
  AFTER:   event: '*', table: 'pipeline_entries',
           filter: `tenant_id=eq.${effectiveTenantId}`
```

This is the same pattern already used successfully in `EnhancedClientList.tsx` for contacts.

