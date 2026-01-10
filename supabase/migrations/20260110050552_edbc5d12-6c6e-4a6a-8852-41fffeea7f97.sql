-- Fix RLS policies for company-logos bucket to use tenant-scoped paths
-- This allows authenticated users to upload/update/delete logos within their tenant folder

-- Drop existing problematic policies (if any)
DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view company logos" ON storage.objects;

-- Create a helper function to get user's allowed tenant IDs
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    SELECT DISTINCT unnest(ARRAY[tenant_id, active_tenant_id])
    FROM public.profiles
    WHERE id = p_user_id
    AND (tenant_id IS NOT NULL OR active_tenant_id IS NOT NULL)
  )::uuid[];
$$;

-- Public read access for company logos (logos should be publicly viewable)
CREATE POLICY "Public can view company logos"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'company-logos');

-- Authenticated users can insert logos in their tenant folder
CREATE POLICY "Tenant members can upload logos"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (
  bucket_id = 'company-logos'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids(auth.uid()))
);

-- Authenticated users can update logos in their tenant folder
CREATE POLICY "Tenant members can update logos"
ON storage.objects
FOR UPDATE
TO public
USING (
  bucket_id = 'company-logos'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids(auth.uid()))
)
WITH CHECK (
  bucket_id = 'company-logos'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids(auth.uid()))
);

-- Authenticated users can delete logos in their tenant folder
CREATE POLICY "Tenant members can delete logos"
ON storage.objects
FOR DELETE
TO public
USING (
  bucket_id = 'company-logos'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1]::uuid = ANY(public.get_user_tenant_ids(auth.uid()))
);