-- Add RLS policies for smartdoc-assets bucket
-- Allow authenticated users to upload to smartdoc-assets
CREATE POLICY "Authenticated users can upload to smartdoc-assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'smartdoc-assets' AND auth.uid() IS NOT NULL);

-- Allow authenticated users to read from smartdoc-assets
CREATE POLICY "Authenticated users can read smartdoc-assets"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'smartdoc-assets');

-- Allow authenticated users to delete from smartdoc-assets
CREATE POLICY "Authenticated users can delete smartdoc-assets"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'smartdoc-assets');