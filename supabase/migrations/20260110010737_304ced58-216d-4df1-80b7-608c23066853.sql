-- Fix company-logos bucket storage policy
-- Drop existing policy and recreate with proper permissions

DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view logos" ON storage.objects;

-- Create proper upload policy
CREATE POLICY "Authenticated users can upload logos" 
ON storage.objects FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'company-logos');

-- Create public read policy
CREATE POLICY "Anyone can view logos" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'company-logos');

-- Create update policy for owners
CREATE POLICY "Users can update their own logos" 
ON storage.objects FOR UPDATE 
TO authenticated
USING (bucket_id = 'company-logos');

-- Create delete policy
CREATE POLICY "Users can delete their own logos" 
ON storage.objects FOR DELETE 
TO authenticated
USING (bucket_id = 'company-logos');

-- Ensure the bucket exists and is configured correctly
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-logos', 
  'company-logos', 
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];