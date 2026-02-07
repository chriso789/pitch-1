
# Plan: Fix RLS Policies for Pipeline Stages Table

## Problem Identified

The Pipeline Stage Manager is failing to save new stages because the `pipeline_stages` table is missing the required RLS policies.

**Console Error:**
```
"new row violates row-level security policy for table \"pipeline_stages\""
```

**Current State:**
| Policy | Status |
|--------|--------|
| SELECT | ✅ Exists - `Users can view pipeline stages in their tenant` |
| INSERT | ❌ Missing |
| UPDATE | ❌ Missing |
| DELETE | ❌ Missing |

## Solution

Add RLS policies for INSERT, UPDATE, and DELETE operations that:
1. Only allow users within the same tenant
2. Restrict modification access to manager-level roles (admin, corporate, office_admin, etc.)

## Database Migration

```sql
-- Policy: Allow managers to INSERT new stages in their tenant
CREATE POLICY "Managers can create pipeline stages"
ON public.pipeline_stages
FOR INSERT
WITH CHECK (
  tenant_id = get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
);

-- Policy: Allow managers to UPDATE stages in their tenant
CREATE POLICY "Managers can update pipeline stages"
ON public.pipeline_stages
FOR UPDATE
USING (
  tenant_id = get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
)
WITH CHECK (
  tenant_id = get_user_tenant_id()
);

-- Policy: Allow managers to DELETE stages in their tenant
CREATE POLICY "Managers can delete pipeline stages"
ON public.pipeline_stages
FOR DELETE
USING (
  tenant_id = get_user_tenant_id()
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager')
  )
);
```

## How It Works

| Operation | Who Can Perform |
|-----------|----------------|
| View stages | All authenticated users in the tenant |
| Add stages | Managers only (master, owner, corporate, office_admin, regional_manager, sales_manager) |
| Edit stages | Managers only |
| Delete stages | Managers only |

## Files to Modify

| Type | Change |
|------|--------|
| Database Migration | Add 3 RLS policies (INSERT, UPDATE, DELETE) |

After this migration, the Pipeline Stage Manager will work correctly for users with manager roles.
