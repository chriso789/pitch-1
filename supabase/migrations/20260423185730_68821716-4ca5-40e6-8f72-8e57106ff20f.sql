-- New table: pitch notes per page
CREATE TABLE IF NOT EXISTS public.plan_pitch_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  page_id uuid NOT NULL REFERENCES public.plan_pages(id) ON DELETE CASCADE,
  pitch_text text NOT NULL,
  normalized_rise numeric,
  normalized_run numeric,
  target_region_json jsonb,
  confidence numeric,
  is_reviewed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_pitch_notes_tenant ON public.plan_pitch_notes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_pitch_notes_page ON public.plan_pitch_notes(page_id);
ALTER TABLE public.plan_pitch_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_pitch_notes tenant all" ON public.plan_pitch_notes;
CREATE POLICY "plan_pitch_notes tenant all" ON public.plan_pitch_notes
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
DROP TRIGGER IF EXISTS plan_pitch_notes_touch ON public.plan_pitch_notes;
CREATE TRIGGER plan_pitch_notes_touch BEFORE UPDATE ON public.plan_pitch_notes
  FOR EACH ROW EXECUTE FUNCTION public.plan_touch_updated_at();

-- New table: parse jobs queue
CREATE TABLE IF NOT EXISTS public.plan_parse_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.plan_documents(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_text text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plan_parse_jobs_tenant ON public.plan_parse_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plan_parse_jobs_doc ON public.plan_parse_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_plan_parse_jobs_status ON public.plan_parse_jobs(status);
ALTER TABLE public.plan_parse_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_parse_jobs tenant all" ON public.plan_parse_jobs;
CREATE POLICY "plan_parse_jobs tenant all" ON public.plan_parse_jobs
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- Optional fields on plan_pages
ALTER TABLE public.plan_pages ADD COLUMN IF NOT EXISTS page_title text;
ALTER TABLE public.plan_pages ADD COLUMN IF NOT EXISTS parse_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.plan_pages ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending';

-- Optional fields on plan_detail_refs
ALTER TABLE public.plan_detail_refs ADD COLUMN IF NOT EXISTS target_detail_id text;
ALTER TABLE public.plan_detail_refs ADD COLUMN IF NOT EXISTS target_region_json jsonb;
ALTER TABLE public.plan_detail_refs ADD COLUMN IF NOT EXISTS link_status text NOT NULL DEFAULT 'unlinked';

-- Optional worker-format columns on plan_geometry (existing schema uses geometry_class enum + points)
ALTER TABLE public.plan_geometry ADD COLUMN IF NOT EXISTS geometry_type text;
ALTER TABLE public.plan_geometry ADD COLUMN IF NOT EXISTS class_name text;
ALTER TABLE public.plan_geometry ADD COLUMN IF NOT EXISTS points_json jsonb;
ALTER TABLE public.plan_geometry ADD COLUMN IF NOT EXISTS metadata_json jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.plan_geometry ADD COLUMN IF NOT EXISTS is_reviewed boolean NOT NULL DEFAULT false;

-- Additional storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('blueprint-pages', 'blueprint-pages', false),
  ('blueprint-debug', 'blueprint-debug', false),
  ('blueprint-exports', 'blueprint-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Tenant-scoped policies for the new buckets
DO $$
DECLARE b text;
BEGIN
  FOREACH b IN ARRAY ARRAY['blueprint-pages','blueprint-debug','blueprint-exports']
  LOOP
    EXECUTE format($f$DROP POLICY IF EXISTS "%s tenant read" ON storage.objects$f$, b);
    EXECUTE format($f$CREATE POLICY "%s tenant read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = %L AND (storage.foldername(name))[1]::uuid = public.get_user_tenant_id())$f$, b, b);
    EXECUTE format($f$DROP POLICY IF EXISTS "%s tenant insert" ON storage.objects$f$, b);
    EXECUTE format($f$CREATE POLICY "%s tenant insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = %L AND (storage.foldername(name))[1]::uuid = public.get_user_tenant_id())$f$, b, b);
    EXECUTE format($f$DROP POLICY IF EXISTS "%s tenant update" ON storage.objects$f$, b);
    EXECUTE format($f$CREATE POLICY "%s tenant update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = %L AND (storage.foldername(name))[1]::uuid = public.get_user_tenant_id())$f$, b, b);
    EXECUTE format($f$DROP POLICY IF EXISTS "%s tenant delete" ON storage.objects$f$, b);
    EXECUTE format($f$CREATE POLICY "%s tenant delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = %L AND (storage.foldername(name))[1]::uuid = public.get_user_tenant_id())$f$, b, b);
  END LOOP;
END $$;