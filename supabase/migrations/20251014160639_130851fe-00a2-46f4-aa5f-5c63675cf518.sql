-- Create documents storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false);

-- RLS Policy: Users can upload documents to their tenant
CREATE POLICY "Users can upload documents to their tenant"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM pipeline_entries 
    WHERE tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  )
);

-- RLS Policy: Users can view documents in their tenant
CREATE POLICY "Users can view documents in their tenant"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM pipeline_entries 
    WHERE tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  )
);

-- RLS Policy: Users can delete documents in their tenant
CREATE POLICY "Users can delete documents in their tenant"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'documents' AND
  (storage.foldername(name))[1] IN (
    SELECT id::text FROM pipeline_entries 
    WHERE tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
  )
);