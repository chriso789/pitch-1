-- Ensure call-recordings bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- RLS: allow authenticated users to read recordings
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read call recordings"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'call-recordings');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS: allow service role inserts
DO $$ BEGIN
  CREATE POLICY "Service role can insert call recordings"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'call-recordings');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;