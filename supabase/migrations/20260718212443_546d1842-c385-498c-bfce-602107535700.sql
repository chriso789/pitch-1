
-- RoofTrace AI: perimeter-first tracing workbench tables
-- Additive; does not touch existing measurement tables.

-- ============ enums ============
DO $$ BEGIN
  CREATE TYPE public.roof_trace_perimeter_status AS ENUM
    ('pending','proposed','needs_review','accepted','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roof_trace_result_state AS ENUM
    ('queued','acquiring','calibrating','tracing_perimeter','tracing_topology','needs_review','ready','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roof_trace_revision_state AS ENUM ('draft','approved','superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roof_trace_job_type AS ENUM
    ('acquire','calibrate','perimeter','topology','pitch','report');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.roof_trace_job_status AS ENUM
    ('queued','running','succeeded','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.measurement_draft_status AS ENUM ('ready','applied','superseded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ roof_trace_sessions ============
CREATE TABLE public.roof_trace_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NULL,
  created_by uuid NOT NULL,
  address text,
  lat double precision,
  lng double precision,
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  calibration jsonb NOT NULL DEFAULT '{}'::jsonb,
  perimeter_status public.roof_trace_perimeter_status NOT NULL DEFAULT 'pending',
  result_state public.roof_trace_result_state NOT NULL DEFAULT 'queued',
  current_revision integer NOT NULL DEFAULT 0,
  approved_revision integer NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_roof_trace_sessions_tenant ON public.roof_trace_sessions(tenant_id, created_at DESC);
CREATE INDEX idx_roof_trace_sessions_job ON public.roof_trace_sessions(job_id) WHERE job_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_trace_sessions TO authenticated;
GRANT ALL ON public.roof_trace_sessions TO service_role;
ALTER TABLE public.roof_trace_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roof_trace_sessions tenant read"
  ON public.roof_trace_sessions FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "roof_trace_sessions tenant write"
  ON public.roof_trace_sessions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "roof_trace_sessions tenant update"
  ON public.roof_trace_sessions FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "roof_trace_sessions tenant delete"
  ON public.roof_trace_sessions FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());

-- ============ roof_trace_revisions ============
CREATE TABLE public.roof_trace_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.roof_trace_sessions(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  state public.roof_trace_revision_state NOT NULL DEFAULT 'draft',
  geometry jsonb NOT NULL,
  perimeter_gate_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  author_id uuid NOT NULL,
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, revision)
);
CREATE INDEX idx_roof_trace_revisions_tenant ON public.roof_trace_revisions(tenant_id, created_at DESC);
CREATE INDEX idx_roof_trace_revisions_session ON public.roof_trace_revisions(session_id, revision DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_trace_revisions TO authenticated;
GRANT ALL ON public.roof_trace_revisions TO service_role;
ALTER TABLE public.roof_trace_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roof_trace_revisions tenant read"
  ON public.roof_trace_revisions FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "roof_trace_revisions tenant write"
  ON public.roof_trace_revisions FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "roof_trace_revisions tenant update"
  ON public.roof_trace_revisions FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ============ roof_trace_jobs ============
CREATE TABLE public.roof_trace_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.roof_trace_sessions(id) ON DELETE CASCADE,
  type public.roof_trace_job_type NOT NULL,
  status public.roof_trace_job_status NOT NULL DEFAULT 'queued',
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_roof_trace_jobs_session ON public.roof_trace_jobs(session_id, created_at DESC);
CREATE INDEX idx_roof_trace_jobs_tenant_status ON public.roof_trace_jobs(tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_trace_jobs TO authenticated;
GRANT ALL ON public.roof_trace_jobs TO service_role;
ALTER TABLE public.roof_trace_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roof_trace_jobs tenant read"
  ON public.roof_trace_jobs FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "roof_trace_jobs tenant write"
  ON public.roof_trace_jobs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "roof_trace_jobs tenant update"
  ON public.roof_trace_jobs FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ============ measurement_drafts ============
CREATE TABLE public.measurement_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES public.roof_trace_sessions(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES public.roof_trace_revisions(id) ON DELETE CASCADE,
  job_id uuid NULL,
  status public.measurement_draft_status NOT NULL DEFAULT 'ready',
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  linear_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  facets jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_measurement_drafts_tenant ON public.measurement_drafts(tenant_id, created_at DESC);
CREATE INDEX idx_measurement_drafts_session ON public.measurement_drafts(session_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.measurement_drafts TO authenticated;
GRANT ALL ON public.measurement_drafts TO service_role;
ALTER TABLE public.measurement_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "measurement_drafts tenant read"
  ON public.measurement_drafts FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());
CREATE POLICY "measurement_drafts tenant write"
  ON public.measurement_drafts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());
CREATE POLICY "measurement_drafts tenant update"
  ON public.measurement_drafts FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.tg_roof_trace_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER tg_roof_trace_sessions_updated
  BEFORE UPDATE ON public.roof_trace_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_roof_trace_touch_updated_at();
CREATE TRIGGER tg_roof_trace_jobs_updated
  BEFORE UPDATE ON public.roof_trace_jobs
  FOR EACH ROW EXECUTE FUNCTION public.tg_roof_trace_touch_updated_at();
CREATE TRIGGER tg_measurement_drafts_updated
  BEFORE UPDATE ON public.measurement_drafts
  FOR EACH ROW EXECUTE FUNCTION public.tg_roof_trace_touch_updated_at();
