-- Update get_user_tenant_id() to support multi-company switching
-- This function is used by ALL RLS policies, so updating it enables multi-company support everywhere

CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_tenant_id UUID;
  v_primary_tenant_id UUID;
BEGIN
  -- Get both active_tenant_id and primary tenant_id
  SELECT active_tenant_id, tenant_id 
  INTO v_active_tenant_id, v_primary_tenant_id
  FROM profiles 
  WHERE id = auth.uid();
  
  -- Return active tenant if set, otherwise fall back to primary tenant
  RETURN COALESCE(v_active_tenant_id, v_primary_tenant_id);
END;
$$;

COMMENT ON FUNCTION get_user_tenant_id() IS 
'Returns the active tenant for multi-company users, falls back to primary tenant_id for backward compatibility. Used by all RLS policies.';