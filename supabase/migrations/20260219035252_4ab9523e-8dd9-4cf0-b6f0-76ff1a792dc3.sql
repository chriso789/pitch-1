
-- Create storage bucket for AI admin chat image uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-admin-uploads',
  'ai-admin-uploads',
  true,
  10485760, -- 10MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']
);

-- RLS: Anyone can read (public bucket)
CREATE POLICY "Public read access for ai-admin-uploads"
ON storage.objects FOR SELECT
USING (bucket_id = 'ai-admin-uploads');

-- RLS: Authenticated users can upload to their tenant path
CREATE POLICY "Authenticated users can upload to tenant path"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'ai-admin-uploads'
  AND auth.role() = 'authenticated'
);

-- RLS: Users can update their own uploads
CREATE POLICY "Users can update own uploads in ai-admin-uploads"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'ai-admin-uploads'
  AND auth.role() = 'authenticated'
);

-- RLS: Users can delete their own uploads
CREATE POLICY "Users can delete own uploads in ai-admin-uploads"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'ai-admin-uploads'
  AND auth.role() = 'authenticated'
);
