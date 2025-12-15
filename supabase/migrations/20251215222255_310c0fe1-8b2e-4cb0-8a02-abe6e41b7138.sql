-- Fix marketing_sessions security - SELECT policy should be for authenticated users only, not public

DROP POLICY IF EXISTS "Admins can view sessions in their tenant" ON public.marketing_sessions;

-- Only authenticated admins can read marketing data
CREATE POLICY "Admins can view sessions in their tenant"
ON public.marketing_sessions
FOR SELECT
TO authenticated
USING (
  (tenant_id IS NULL AND EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('master', 'corporate', 'office_admin')
  ))
  OR tenant_id = get_user_tenant_id()
  OR EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('master', 'corporate', 'office_admin')
  )
);

-- Ensure anon cannot read
REVOKE SELECT ON public.marketing_sessions FROM anon;