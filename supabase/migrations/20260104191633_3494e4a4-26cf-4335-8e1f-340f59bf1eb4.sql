-- COMPLETE FIX: Storage RLS for documents bucket
-- 1. First create the helper function
CREATE OR REPLACE FUNCTION public.storage_check_document_access(folder_name text, user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_tenant_id uuid;
  user_active_tenant uuid;
BEGIN
  IF user_id IS NULL THEN
    RETURN false;
  END IF;
  
  SELECT tenant_id, active_tenant_id INTO user_tenant_id, user_active_tenant
  FROM profiles WHERE id = user_id;
  
  IF folder_name = user_tenant_id::text OR folder_name = user_active_tenant::text THEN
    RETURN true;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM pipeline_entries pe
    WHERE pe.id::text = folder_name
    AND (pe.tenant_id = user_tenant_id OR pe.tenant_id = user_active_tenant)
  ) THEN
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;

-- 2. Drop ALL existing document-related policies (all known names)
DO $$
BEGIN
  -- Try to drop each policy, ignore if it doesn't exist
  EXECUTE 'DROP POLICY IF EXISTS "Users can view documents in their tenant" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Users can upload documents to their tenant" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Users can update documents in their tenant" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Users can delete documents in their tenant" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Tenant users can view documents" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Tenant users can upload documents" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Tenant users can update documents" ON storage.objects';
  EXECUTE 'DROP POLICY IF EXISTS "Tenant users can delete documents" ON storage.objects';
END $$;

-- 3. Create the new policies
CREATE POLICY "doc_select_policy"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents' 
  AND public.storage_check_document_access((storage.foldername(name))[1], auth.uid())
);

CREATE POLICY "doc_insert_policy"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND public.storage_check_document_access((storage.foldername(name))[1], auth.uid())
);

CREATE POLICY "doc_update_policy"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'documents'
  AND public.storage_check_document_access((storage.foldername(name))[1], auth.uid())
);

CREATE POLICY "doc_delete_policy"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'documents'
  AND public.storage_check_document_access((storage.foldername(name))[1], auth.uid())
);