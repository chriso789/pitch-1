-- Make smartdoc-assets bucket public to bypass RLS issues with createSignedUrl()
-- This allows using getPublicUrl() which doesn't require database writes

UPDATE storage.buckets 
SET public = true 
WHERE id = 'smartdoc-assets';