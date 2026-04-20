
-- Fix 1: Tenant-scope smart-docs uploads (require path to start with user's tenant_id)
DROP POLICY IF EXISTS "Users can upload PDFs to smart-docs" ON storage.objects;

CREATE POLICY "Tenant-scoped uploads to smart-docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'smart-docs'
  AND auth.uid() IS NOT NULL
  AND (storage.foldername(name))[1] IN (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    UNION
    SELECT p.active_tenant_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active_tenant_id IS NOT NULL
  )
);

-- Also add UPDATE policy with same tenant scoping (was missing)
DROP POLICY IF EXISTS "Users can update their tenant PDFs in smart-docs" ON storage.objects;
CREATE POLICY "Users can update their tenant PDFs in smart-docs"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'smart-docs'
  AND (storage.foldername(name))[1] IN (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    UNION
    SELECT p.active_tenant_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active_tenant_id IS NOT NULL
  )
)
WITH CHECK (
  bucket_id = 'smart-docs'
  AND (storage.foldername(name))[1] IN (
    SELECT p.tenant_id::text FROM public.profiles p WHERE p.id = auth.uid()
    UNION
    SELECT p.active_tenant_id::text FROM public.profiles p WHERE p.id = auth.uid() AND p.active_tenant_id IS NOT NULL
  )
);

-- Fix 2: Harden storage_check_document_access — require strict tenant verification
-- for pipeline_entry-based paths (path must be tenant_id/pipeline_entry_id/...).
-- Old behavior allowed bare pipeline_entry UUID as folder which enabled enumeration.
CREATE OR REPLACE FUNCTION public.storage_check_document_access(folder_name text, user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  user_tenant_id uuid;
  user_active_tenant uuid;
BEGIN
  IF user_id IS NULL OR folder_name IS NULL THEN
    RETURN false;
  END IF;

  SELECT tenant_id, active_tenant_id INTO user_tenant_id, user_active_tenant
  FROM profiles WHERE id = user_id;

  -- Only allow if first folder segment is the user's tenant_id (strict isolation).
  IF folder_name = user_tenant_id::text
     OR (user_active_tenant IS NOT NULL AND folder_name = user_active_tenant::text) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;
