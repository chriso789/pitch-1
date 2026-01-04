-- =========================================
-- Fix estimate number uniqueness per tenant
-- =========================================

-- Drop the global unique constraint on estimate_number
ALTER TABLE enhanced_estimates 
DROP CONSTRAINT IF EXISTS enhanced_estimates_estimate_number_key;

-- Add tenant-scoped unique constraint
ALTER TABLE enhanced_estimates 
ADD CONSTRAINT enhanced_estimates_tenant_estimate_number_unique 
UNIQUE (tenant_id, estimate_number);

-- =========================================
-- Fix storage RLS policies for estimate PDFs
-- =========================================

-- Drop existing policies if they exist to recreate them properly
DROP POLICY IF EXISTS "Users can upload estimate PDFs" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can upload to documents bucket" ON storage.objects;
DROP POLICY IF EXISTS "Tenant users can view documents" ON storage.objects;

-- Create proper INSERT policy for documents bucket
CREATE POLICY "Tenant users can upload to documents bucket"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);

-- Create proper SELECT policy for documents bucket
CREATE POLICY "Tenant users can view documents"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);

-- Create UPDATE policy for documents bucket
CREATE POLICY "Tenant users can update documents"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);

-- Create DELETE policy for documents bucket
CREATE POLICY "Tenant users can delete documents"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);