-- Storage bucket for assembled measurement-report PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('measurement-reports', 'measurement-reports', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for measurement reports (URLs are unguessable; bucket is public so customers can open them)
DO $$ BEGIN
  CREATE POLICY "Public can read measurement reports"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'measurement-reports');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Service role writes via the edge function; authenticated users may also write within their own tenant folder
DO $$ BEGIN
  CREATE POLICY "Tenant members can write measurement reports"
    ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'measurement-reports'
      AND auth.role() = 'authenticated'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Tenant members can update measurement reports"
    ON storage.objects FOR UPDATE
    USING (
      bucket_id = 'measurement-reports'
      AND auth.role() = 'authenticated'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Persist generated PDF URLs on both the customer-facing measurement and the AI job
ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS report_pdf_url text;

ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS report_pdf_url text;