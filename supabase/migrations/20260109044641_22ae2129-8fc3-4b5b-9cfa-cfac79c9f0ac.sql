-- Fix RLS policies for enhanced_estimates table
-- This resolves the "new row violates row-level security policy" error

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can insert own enhanced_estimates" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can view own tenant enhanced_estimates" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can update own tenant enhanced_estimates" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can delete own tenant enhanced_estimates" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can insert estimates for their tenant" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can view estimates for their tenant" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can update estimates for their tenant" ON enhanced_estimates;
DROP POLICY IF EXISTS "Users can delete estimates for their tenant" ON enhanced_estimates;

-- Create helper function to get user's tenant_id (avoids recursion)
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids()
RETURNS TABLE(tid uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid()
  UNION
  SELECT active_tenant_id FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
$$;

-- Create comprehensive RLS policies for enhanced_estimates
CREATE POLICY "Users can insert estimates for their tenant"
ON enhanced_estimates
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id IN (SELECT tid FROM public.get_user_tenant_ids())
);

CREATE POLICY "Users can view estimates for their tenant"
ON enhanced_estimates
FOR SELECT
TO authenticated
USING (
  tenant_id IN (SELECT tid FROM public.get_user_tenant_ids())
);

CREATE POLICY "Users can update estimates for their tenant"
ON enhanced_estimates
FOR UPDATE
TO authenticated
USING (
  tenant_id IN (SELECT tid FROM public.get_user_tenant_ids())
);

CREATE POLICY "Users can delete estimates for their tenant"
ON enhanced_estimates
FOR DELETE
TO authenticated
USING (
  tenant_id IN (SELECT tid FROM public.get_user_tenant_ids())
);

-- Add trigger to auto-set tenant_id if not provided
CREATE OR REPLACE FUNCTION set_estimate_tenant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    SELECT COALESCE(active_tenant_id, tenant_id) INTO NEW.tenant_id
    FROM profiles
    WHERE id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS ensure_estimate_tenant_id ON enhanced_estimates;
CREATE TRIGGER ensure_estimate_tenant_id
  BEFORE INSERT ON enhanced_estimates
  FOR EACH ROW
  EXECUTE FUNCTION set_estimate_tenant_id();