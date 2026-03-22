

# Fix Lead Source Settings for Roof Kings

## Root Cause

Two issues blocking Jared from adding lead sources:

1. **RLS policy too restrictive**: The `lead_sources` table write policy only allows `admin`, `manager`, or `master` roles. Jared's role at Roof Kings is `owner`, which was added to the `app_role` enum later but never included in this policy. The policy silently rejects his inserts.

2. **Wrong tenant_id in client code**: `LeadSources.tsx` pulls `tenant_id` from `user_metadata.tenant_id`, which may be undefined or stale. Should use the profile's tenant_id via `useEffectiveTenantId` hook instead.

## Plan

### 1. Fix RLS policy to include `owner` role
**Migration SQL**:

```sql
DROP POLICY "Admins can manage lead sources in their tenant" ON public.lead_sources;
CREATE POLICY "Admins can manage lead sources in their tenant" 
ON public.lead_sources 
FOR ALL
USING (
  (tenant_id = get_user_tenant_id()) 
  AND (
    has_role('admin'::app_role) 
    OR has_role('manager'::app_role) 
    OR has_role('master'::app_role) 
    OR has_role('owner'::app_role)
  )
)
WITH CHECK (
  (tenant_id = get_user_tenant_id()) 
  AND (
    has_role('admin'::app_role) 
    OR has_role('manager'::app_role) 
    OR has_role('master'::app_role) 
    OR has_role('owner'::app_role)
  )
);
```

### 2. Fix tenant_id resolution in LeadSources component
**File**: `src/features/leads/components/LeadSources.tsx`

Replace the unreliable `user_metadata.tenant_id` lookup (line 104) with the `useEffectiveTenantId` hook, and pass it in the payload for inserts. Remove it from update payloads (tenant_id shouldn't change on update).

| File | Change |
|------|--------|
| Migration SQL | Add `owner` role to `lead_sources` write policy |
| `src/features/leads/components/LeadSources.tsx` | Use `useEffectiveTenantId()` for tenant_id |

