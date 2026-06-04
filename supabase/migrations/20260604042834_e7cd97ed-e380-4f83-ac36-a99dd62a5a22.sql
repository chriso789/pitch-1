-- =====================================================================
-- Phase 3: Measurement Artifact Envelope persistence (additive)
-- =====================================================================

-- ---------------------------------------------------------------------
-- mskill_artifacts: add envelope-native columns (all nullable so existing
-- writeSkillArtifact callers keep working unchanged).
-- ---------------------------------------------------------------------
ALTER TABLE public.mskill_artifacts
  ADD COLUMN IF NOT EXISTS artifact_id UUID,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS envelope_version INTEGER,
  ADD COLUMN IF NOT EXISTS parent_artifact_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS stage TEXT,
  ADD COLUMN IF NOT EXISTS source_skill TEXT,
  ADD COLUMN IF NOT EXISTS producer_kind TEXT,
  ADD COLUMN IF NOT EXISTS producer JSONB,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS coordinate_frame JSONB,
  ADD COLUMN IF NOT EXISTS units JSONB,
  ADD COLUMN IF NOT EXISTS geometry JSONB,
  ADD COLUMN IF NOT EXISTS data JSONB,
  ADD COLUMN IF NOT EXISTS quality JSONB,
  ADD COLUMN IF NOT EXISTS validation JSONB,
  ADD COLUMN IF NOT EXISTS lineage JSONB,
  ADD COLUMN IF NOT EXISTS display JSONB,
  ADD COLUMN IF NOT EXISTS storage_block JSONB,
  ADD COLUMN IF NOT EXISTS validation_status TEXT,
  ADD COLUMN IF NOT EXISTS validation_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS export_allowed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_allowed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS envelope JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Unique artifact_id when present (nullable allowed for legacy rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_mskill_artifacts_artifact_id
  ON public.mskill_artifacts(artifact_id)
  WHERE artifact_id IS NOT NULL;

-- Searchable indexes
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_stage          ON public.mskill_artifacts(stage);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_status         ON public.mskill_artifacts(status);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_validation     ON public.mskill_artifacts(validation_status);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_source_skill   ON public.mskill_artifacts(source_skill);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_export_allowed ON public.mskill_artifacts(export_allowed) WHERE export_allowed = true;
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_report_allowed ON public.mskill_artifacts(report_allowed) WHERE report_allowed = true;
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_parents        ON public.mskill_artifacts USING GIN (parent_artifact_ids);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_envelope_gin   ON public.mskill_artifacts USING GIN (envelope);

-- CHECK constraints aligned with envelope enums. Allow NULL for legacy rows.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mskill_artifacts_status_chk') THEN
    ALTER TABLE public.mskill_artifacts ADD CONSTRAINT mskill_artifacts_status_chk
      CHECK (status IS NULL OR status IN (
        'created','partial','complete','validation_pending',
        'validated','rejected','exportable','reportable','failed'
      ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mskill_artifacts_validation_status_chk') THEN
    ALTER TABLE public.mskill_artifacts ADD CONSTRAINT mskill_artifacts_validation_status_chk
      CHECK (validation_status IS NULL OR validation_status IN ('pending','passed','failed','skipped'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mskill_artifacts_producer_kind_chk') THEN
    ALTER TABLE public.mskill_artifacts ADD CONSTRAINT mskill_artifacts_producer_kind_chk
      CHECK (producer_kind IS NULL OR producer_kind IN ('worker','control_plane','external'));
  END IF;
END$$;

-- updated_at trigger (reuse existing touch function from mskill base migration).
DROP TRIGGER IF EXISTS trg_mskill_artifacts_touch ON public.mskill_artifacts;
CREATE TRIGGER trg_mskill_artifacts_touch BEFORE UPDATE ON public.mskill_artifacts
  FOR EACH ROW EXECUTE FUNCTION public.mskill_touch_updated_at();

-- ---------------------------------------------------------------------
-- mskill_artifact_issues: canonical warnings / errors / blockers.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mskill_artifact_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  mskill_run_id UUID REFERENCES public.mskill_runs(id) ON DELETE CASCADE,
  artifact_id UUID,
  mskill_artifact_id UUID REFERENCES public.mskill_artifacts(id) ON DELETE CASCADE,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','error','blocker')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  source_skill TEXT,
  blocking BOOLEAN NOT NULL DEFAULT false,
  suggested_fix TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mskill_artifact_issues_job        ON public.mskill_artifact_issues(mskill_job_id);
CREATE INDEX IF NOT EXISTS idx_mskill_artifact_issues_artifact   ON public.mskill_artifact_issues(mskill_artifact_id);
CREATE INDEX IF NOT EXISTS idx_mskill_artifact_issues_artifactid ON public.mskill_artifact_issues(artifact_id);
CREATE INDEX IF NOT EXISTS idx_mskill_artifact_issues_severity   ON public.mskill_artifact_issues(severity);
CREATE INDEX IF NOT EXISTS idx_mskill_artifact_issues_blocking   ON public.mskill_artifact_issues(blocking) WHERE blocking = true;
CREATE INDEX IF NOT EXISTS idx_mskill_artifact_issues_code       ON public.mskill_artifact_issues(code);
CREATE INDEX IF NOT EXISTS idx_mskill_artifact_issues_skill      ON public.mskill_artifact_issues(source_skill);

GRANT SELECT, INSERT, UPDATE ON public.mskill_artifact_issues TO authenticated;
GRANT ALL ON public.mskill_artifact_issues TO service_role;

ALTER TABLE public.mskill_artifact_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mskill_artifact_issues_tenant_all" ON public.mskill_artifact_issues FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

NOTIFY pgrst, 'reload schema';
