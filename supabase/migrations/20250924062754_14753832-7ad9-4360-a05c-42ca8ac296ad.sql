-- Fix the contacts RLS policy to allow location-based inserts
DROP POLICY IF EXISTS "Users can create contacts in their tenant" ON public.contacts;

CREATE POLICY "Users can create contacts in their tenant"
ON public.contacts
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = get_user_tenant_id() OR 
  (created_by_ghost IS NOT NULL AND 
   EXISTS (
     SELECT 1 FROM public.profiles 
     WHERE id = contacts.created_by_ghost 
     AND tenant_id = get_user_tenant_id()
   ))
);

-- Update the contacts table to include location_id in the existing RLS policies
DROP POLICY IF EXISTS "Users can view contacts in their tenant" ON public.contacts;

CREATE POLICY "Users can view contacts in their tenant"
ON public.contacts
FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id() AND (
    -- Admins and managers can see all contacts
    has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role) OR
    -- Users can see contacts from their assigned locations (if location_id is set)
    location_id IS NULL OR
    EXISTS (
      SELECT 1 FROM public.user_location_assignments ula
      WHERE ula.tenant_id = get_user_tenant_id()
      AND ula.user_id = auth.uid()
      AND ula.location_id = contacts.location_id
      AND ula.is_active = true
    )
  )
);