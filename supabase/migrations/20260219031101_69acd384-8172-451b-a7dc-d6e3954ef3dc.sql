
-- Create storage bucket for call recordings
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for voicemail drops
INSERT INTO storage.buckets (id, name, public)
VALUES ('voicemail-drops', 'voicemail-drops', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for call-recordings bucket
CREATE POLICY "Tenant members can read their call recordings"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'call-recordings'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM public.profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);

CREATE POLICY "Authenticated users can upload call recordings"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'call-recordings'
  AND auth.uid() IS NOT NULL
);

-- RLS policies for voicemail-drops bucket
CREATE POLICY "Tenant members can read their voicemail drops"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'voicemail-drops'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM public.profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);

CREATE POLICY "Authenticated users can upload voicemail drops"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'voicemail-drops'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "Tenant members can delete their voicemail drops"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'voicemail-drops'
  AND (storage.foldername(name))[1] IN (
    SELECT tenant_id::text FROM public.profiles WHERE id = auth.uid()
    UNION
    SELECT active_tenant_id::text FROM public.profiles WHERE id = auth.uid() AND active_tenant_id IS NOT NULL
  )
);
