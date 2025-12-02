-- Create storage bucket for roof reports
INSERT INTO storage.buckets (id, name, public)
VALUES ('roof-reports', 'roof-reports', true)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies for the roof-reports bucket
CREATE POLICY "Authenticated users can upload reports"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'roof-reports');

CREATE POLICY "Anyone can view reports"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'roof-reports');

CREATE POLICY "Authenticated users can update their reports"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'roof-reports');

CREATE POLICY "Authenticated users can delete their reports"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'roof-reports');