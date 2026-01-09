-- Fix 1: Update get_user_tenant_ids() to return ONLY active tenant (not both)
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS TABLE(tid uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Return ONLY the active tenant, not both home and active
  SELECT COALESCE(active_tenant_id, tenant_id) 
  FROM profiles 
  WHERE id = auth.uid()
$$;

-- Fix 2: Drop duplicate RLS policies on enhanced_estimates that use get_user_tenant_ids()
DROP POLICY IF EXISTS "Users can view estimates for their tenant" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can update estimates for their tenant" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can delete estimates for their tenant" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can insert estimates for their tenant" ON enhanced_estimates;

-- Fix 3: Update locations RLS - remove master bypass, use only active tenant
DROP POLICY IF EXISTS "Admins can manage accessible company locations" ON locations;
DROP POLICY IF EXISTS "Users can view locations in their tenant or accessible companie" ON locations;

-- New locations policies using ONLY active tenant
CREATE POLICY "Users can view locations in active tenant"
ON locations FOR SELECT
TO authenticated
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage locations in active tenant"
ON locations FOR ALL
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND public.has_role(auth.uid(), 'master')
)
WITH CHECK (
  tenant_id = get_user_tenant_id()
  AND public.has_role(auth.uid(), 'master')
);