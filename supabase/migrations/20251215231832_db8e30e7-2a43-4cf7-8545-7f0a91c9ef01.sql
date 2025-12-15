-- Fix tracking_events security - Remove public role access

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Admins can view events in their tenant" ON public.tracking_events;
DROP POLICY IF EXISTS "Public can insert tracking events" ON public.tracking_events;
DROP POLICY IF EXISTS "Service role can manage all events" ON public.tracking_events;

-- Allow anonymous users to INSERT tracking events (for marketing site analytics)
-- but they cannot read any data
CREATE POLICY "Anon can insert tracking events"
ON public.tracking_events
FOR INSERT
TO anon
WITH CHECK (channel = 'MARKETING_SITE'::text);

-- Authenticated admins can view tracking data in their tenant
CREATE POLICY "Admins can view tracking events"
ON public.tracking_events
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

-- Authenticated users can insert their own tracking events
CREATE POLICY "Authenticated users can insert tracking events"
ON public.tracking_events
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Revoke SELECT from anon to prevent data scraping
REVOKE SELECT, UPDATE, DELETE ON public.tracking_events FROM anon;