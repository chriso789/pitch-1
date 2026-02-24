
-- Fix 1: Increase documents bucket file size limit to 100MB
UPDATE storage.buckets 
SET file_size_limit = 104857600
WHERE id = 'documents';

-- Fix 2: Add INSERT RLS policy for measurement-reports bucket
CREATE POLICY "Authenticated users can upload measurement reports"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'measurement-reports' 
  AND auth.role() = 'authenticated'
);

-- Fix 2b: Add SELECT RLS policy for measurement-reports bucket
CREATE POLICY "Authenticated users can read measurement reports"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'measurement-reports' 
  AND auth.role() = 'authenticated'
);
