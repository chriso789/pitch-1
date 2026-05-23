-- Backend Maintenance Center — Phase 1 (read-only audit)
-- Two new tables, master-only RLS. No changes to existing tables or policies.

CREATE TABLE IF NOT EXISTS public.system_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL CHECK (module IN (
    'health_doctor','edge_functions','tenant_isolation','rls_security','cleanup_preview'
  )),
  triggered_by uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','partial','error')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms integer,
  error_message text
);

CREATE TABLE IF NOT EXISTS public.system_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.system_audit_runs(id) ON DELETE CASCADE,
  finding_key text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  title text NOT NULL,
  detail text,
  evidence jsonb,
  recommended_action text,
  risk_explanation text,
  company_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_audit_runs_module_started
  ON public.system_audit_runs (module, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_audit_findings_run_severity
  ON public.system_audit_findings (run_id, severity);

CREATE INDEX IF NOT EXISTS idx_system_audit_findings_category_severity
  ON public.system_audit_findings (category, severity);

ALTER TABLE public.system_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_audit_findings ENABLE ROW LEVEL SECURITY;

-- Master-only read. Writes only happen via service role inside the edge functions
-- (no client INSERT/UPDATE/DELETE policy is granted on purpose).
DROP POLICY IF EXISTS "master read system_audit_runs" ON public.system_audit_runs;
CREATE POLICY "master read system_audit_runs"
  ON public.system_audit_runs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::public.app_role));

DROP POLICY IF EXISTS "master read system_audit_findings" ON public.system_audit_findings;
CREATE POLICY "master read system_audit_findings"
  ON public.system_audit_findings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::public.app_role));

COMMENT ON TABLE public.system_audit_runs IS
  'Backend Maintenance Center: one row per audit run (Health Doctor, Edge Functions, Tenant Isolation, RLS Security, Cleanup Preview). Master-only read.';
COMMENT ON TABLE public.system_audit_findings IS
  'Backend Maintenance Center: individual findings produced by each run. Master-only read. evidence is JSONB capped at 50 rows.';