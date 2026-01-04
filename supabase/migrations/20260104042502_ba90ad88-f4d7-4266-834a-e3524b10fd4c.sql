-- Fix cross-tenant contact visibility leak
-- Drop the overly permissive policy that allows seeing contacts assigned to user regardless of tenant
DROP POLICY IF EXISTS "Users can view contacts assigned to them" ON public.contacts;

-- Drop and recreate the location-based select policy to enforce tenant isolation
DROP POLICY IF EXISTS "contacts_location_select" ON public.contacts;

-- Create strengthened policy that ALWAYS enforces tenant isolation
CREATE POLICY "contacts_tenant_and_location_select" ON public.contacts
FOR SELECT TO authenticated
USING (
  -- MUST be in user's active tenant
  tenant_id = get_user_tenant_id()
  AND (
    -- Full location access (admins/managers)
    user_has_full_location_access()
    -- OR assigned to this user
    OR assigned_to = auth.uid()
    -- OR created by this user
    OR created_by = auth.uid()
    -- OR in user's assigned locations
    OR location_id = ANY(get_user_location_ids())
    -- OR no location assigned (visible to all in tenant)
    OR location_id IS NULL
  )
);