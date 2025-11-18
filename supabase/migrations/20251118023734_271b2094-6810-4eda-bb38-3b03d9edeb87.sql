-- ============================================================================
-- Role-Based Access Control for Pipeline Entries
-- Restricts regional_manager, sales_manager, and project_manager roles
-- to only see their assigned entries, while maintaining full access for
-- master, corporate, and office_admin roles
-- ============================================================================

-- Create helper function to check if user has high-level role
CREATE OR REPLACE FUNCTION public.has_high_level_role(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_user_id
    AND role IN ('master', 'corporate', 'office_admin')
  )
$$;

-- Drop existing overly-permissive policy
DROP POLICY IF EXISTS "Users can view pipeline entries in their tenant" ON public.pipeline_entries;

-- Create new role-based access policy
CREATE POLICY "Role-based pipeline entry access"
ON public.pipeline_entries
FOR SELECT
TO authenticated
USING (
  -- Must be in the same tenant
  tenant_id = public.get_user_tenant_id()
  AND (
    -- High-level roles (master, corporate, office_admin) see everything
    public.has_high_level_role(auth.uid())
    OR
    -- Lower-level roles see only their assigned entries
    assigned_to = auth.uid()
    OR
    -- Or entries they created
    created_by = auth.uid()
  )
);

-- Comment on the function and policy for documentation
COMMENT ON FUNCTION public.has_high_level_role(uuid) IS 
  'Returns true if the user has a high-level role (master, corporate, office_admin) that grants full access to pipeline entries';

COMMENT ON POLICY "Role-based pipeline entry access" ON public.pipeline_entries IS 
  'High-level roles see all entries in their tenant; lower-level roles only see assigned or created entries';