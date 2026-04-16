-- Create private storage bucket for U-Net training data exports
INSERT INTO storage.buckets (id, name, public)
VALUES ('unet-training-data', 'unet-training-data', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Master/owner can read unet training data"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'unet-training-data'
  AND (
    public.has_role(auth.uid(), 'master'::app_role)
    OR public.has_role(auth.uid(), 'owner'::app_role)
  )
);

CREATE POLICY "Master/owner can write unet training data"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'unet-training-data'
  AND (
    public.has_role(auth.uid(), 'master'::app_role)
    OR public.has_role(auth.uid(), 'owner'::app_role)
  )
);

CREATE POLICY "Master/owner can update unet training data"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'unet-training-data'
  AND (
    public.has_role(auth.uid(), 'master'::app_role)
    OR public.has_role(auth.uid(), 'owner'::app_role)
  )
);

CREATE POLICY "Master/owner can delete unet training data"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'unet-training-data'
  AND (
    public.has_role(auth.uid(), 'master'::app_role)
    OR public.has_role(auth.uid(), 'owner'::app_role)
  )
);