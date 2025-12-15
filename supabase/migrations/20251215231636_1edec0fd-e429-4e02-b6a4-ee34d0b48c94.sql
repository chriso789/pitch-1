-- Fix demo_requests security - Remove public access policy

-- Drop the overly permissive policy that allows public access
DROP POLICY IF EXISTS "Service role can manage demo_requests" ON public.demo_requests;

-- Create policy for authenticated master/corporate admins only (they manage sales leads)
CREATE POLICY "Admins can manage demo requests"
ON public.demo_requests
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('master', 'corporate', 'office_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.role IN ('master', 'corporate', 'office_admin')
  )
);

-- Allow anonymous users to INSERT demo requests (for the demo request form on landing page)
-- but they cannot read/update/delete any data
CREATE POLICY "Anyone can submit demo request"
ON public.demo_requests
FOR INSERT
TO anon
WITH CHECK (true);

-- Revoke SELECT from anon to prevent data scraping
REVOKE SELECT, UPDATE, DELETE ON public.demo_requests FROM anon;