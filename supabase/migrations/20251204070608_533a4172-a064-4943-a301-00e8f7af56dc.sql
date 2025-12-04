-- Create company-logos bucket for storing company logo images
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policy: Allow authenticated users to upload logos
CREATE POLICY "Authenticated users can upload logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'company-logos');

-- RLS policy: Allow public read access for logos (they need to be visible)
CREATE POLICY "Public can view logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'company-logos');

-- RLS policy: Allow authenticated users to delete logos
CREATE POLICY "Users can delete logos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'company-logos');