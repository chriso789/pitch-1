ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signature_image_path TEXT,
  ADD COLUMN IF NOT EXISTS signature_updated_at TIMESTAMPTZ;

-- Storage bucket policies for user-signatures (bucket created via tool separately).
-- Path convention: {auth.uid()}/signature.png

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_signatures_select_own') THEN
    CREATE POLICY "user_signatures_select_own" ON storage.objects FOR SELECT
      USING (bucket_id = 'user-signatures' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_signatures_insert_own') THEN
    CREATE POLICY "user_signatures_insert_own" ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'user-signatures' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_signatures_update_own') THEN
    CREATE POLICY "user_signatures_update_own" ON storage.objects FOR UPDATE
      USING (bucket_id = 'user-signatures' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'user_signatures_delete_own') THEN
    CREATE POLICY "user_signatures_delete_own" ON storage.objects FOR DELETE
      USING (bucket_id = 'user-signatures' AND auth.uid()::text = (storage.foldername(name))[1]);
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';