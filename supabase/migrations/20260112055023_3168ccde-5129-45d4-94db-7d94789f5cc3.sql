-- Add missing UPDATE policy for smartdoc-assets bucket
-- This fixes the RLS error when downloading/accessing files

CREATE POLICY "Authenticated users can update smartdoc-assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'smartdoc-assets')
WITH CHECK (bucket_id = 'smartdoc-assets');