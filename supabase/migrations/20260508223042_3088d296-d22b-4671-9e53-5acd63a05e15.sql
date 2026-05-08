-- Ensure private training bucket exists for AI measurement training
INSERT INTO storage.buckets (id, name, public)
VALUES ('unet-training-data', 'unet-training-data', false)
ON CONFLICT (id) DO NOTHING;

-- Service role writes from edge functions; admins/master can read for training pipeline
DO $$ BEGIN
  CREATE POLICY "Training bucket: authenticated read"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'unet-training-data');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
