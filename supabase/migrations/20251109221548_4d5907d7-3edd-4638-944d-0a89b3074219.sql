-- Create storage bucket for measurement visualizations
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'measurement-visualizations',
  'measurement-visualizations',
  true,
  10485760, -- 10MB limit
  ARRAY['image/png', 'image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Create policy to allow authenticated users to upload
CREATE POLICY "Authenticated users can upload visualizations"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'measurement-visualizations');

-- Create policy to allow public read access
CREATE POLICY "Public can view visualizations"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'measurement-visualizations');

-- Create policy to allow authenticated users to update their visualizations
CREATE POLICY "Authenticated users can update visualizations"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'measurement-visualizations');

-- Create policy to allow authenticated users to delete visualizations
CREATE POLICY "Authenticated users can delete visualizations"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'measurement-visualizations');