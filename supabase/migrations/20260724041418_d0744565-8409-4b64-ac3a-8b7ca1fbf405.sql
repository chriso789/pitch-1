-- ============================================================
-- Slice 1 — Project Accounting Foundation
-- ============================================================

-- Enum: accounting readiness state machine
DO $$ BEGIN
  CREATE TYPE public.accounting_readiness_state AS ENUM (
    'pending_classification',
    'needs_mapping',
    'qbo_not_connected',
    'qbo_sync_pending',
    'qbo_sync_error',
    'ready'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.accounting_classification_source AS ENUM (
    'estimate_multi_trade',
    'estimate_single_trade',
    'blueprint_accepted_trades',
    'lead_selection',
    'single_scope_fallback',
    'manual_review'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- project_accounting_snapshots (immutable, versioned)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_accounting_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_lead_id UUID,             -- pipeline_entry_id
  source_estimate_id UUID,         -- enhanced_estimates.id
  estimate_template_id UUID,
  primary_trade_id TEXT,
  primary_trade_name_snapshot TEXT,
  primary_project_type_id TEXT,
  primary_project_type_name_snapshot TEXT,
  primary_job_type_id TEXT,
  primary_job_type_name_snapshot TEXT,
  classification_source public.accounting_classification_source NOT NULL,
  classification_version INTEGER NOT NULL DEFAULT 1,
  original_contract_value_cents BIGINT NOT NULL DEFAULT 0,
  approved_change_orders_cents BIGINT NOT NULL DEFAULT 0,
  approved_supplements_cents BIGINT NOT NULL DEFAULT 0,
  current_contract_value_cents BIGINT NOT NULL DEFAULT 0,
  invoiced_total_cents BIGINT NOT NULL DEFAULT 0,
  paid_total_cents BIGINT NOT NULL DEFAULT 0,
  outstanding_invoice_balance_cents BIGINT NOT NULL DEFAULT 0,
  uninvoiced_contract_balance_cents BIGINT NOT NULL DEFAULT 0,
  credits_total_cents BIGINT NOT NULL DEFAULT 0,
  refunds_total_cents BIGINT NOT NULL DEFAULT 0,
  accounting_variance_cents BIGINT NOT NULL DEFAULT 0,
  accounting_readiness public.accounting_readiness_state
    NOT NULL DEFAULT 'pending_classification',
  supersedes_snapshot_id UUID REFERENCES public.project_accounting_snapshots(id),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pas_project ON public.project_accounting_snapshots(project_id);
CREATE INDEX IF NOT EXISTS idx_pas_tenant  ON public.project_accounting_snapshots(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pas_current_per_project
  ON public.project_accounting_snapshots(project_id) WHERE is_current;

GRANT SELECT, INSERT ON public.project_accounting_snapshots TO authenticated;
GRANT ALL ON public.project_accounting_snapshots TO service_role;

ALTER TABLE public.project_accounting_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PAS tenant read"
  ON public.project_accounting_snapshots
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- Writes only via edge function (service role); block direct UPDATE/DELETE.
CREATE POLICY "PAS block direct update"
  ON public.project_accounting_snapshots
  FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

CREATE POLICY "PAS block direct delete"
  ON public.project_accounting_snapshots
  FOR DELETE TO authenticated
  USING (false);

-- Immutability trigger: forbid non-service_role UPDATE except is_current toggle by service_role.
CREATE OR REPLACE FUNCTION public.pas_forbid_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only allow is_current changes; everything else immutable
    IF (row_to_json(NEW)::jsonb - 'is_current') IS DISTINCT FROM (row_to_json(OLD)::jsonb - 'is_current') THEN
      RAISE EXCEPTION 'project_accounting_snapshots is immutable; create a new snapshot instead';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pas_immutable ON public.project_accounting_snapshots;
CREATE TRIGGER trg_pas_immutable
  BEFORE UPDATE ON public.project_accounting_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.pas_forbid_mutation();

-- ============================================================
-- project_scopes
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  accounting_snapshot_id UUID NOT NULL
    REFERENCES public.project_accounting_snapshots(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL,
  trade_name_snapshot TEXT,
  project_type_id TEXT,
  project_type_name_snapshot TEXT,
  job_type_id TEXT,
  job_type_name_snapshot TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  original_contract_amount_cents BIGINT NOT NULL DEFAULT 0,
  current_contract_amount_cents BIGINT NOT NULL DEFAULT 0,
  source_estimate_id UUID,
  source_estimate_section_id UUID,
  source_blueprint_trade_selection_id UUID,
  classification_source public.accounting_classification_source NOT NULL,
  classification_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ps_project ON public.project_scopes(project_id);
CREATE INDEX IF NOT EXISTS idx_ps_snapshot ON public.project_scopes(accounting_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ps_tenant ON public.project_scopes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ps_primary_per_snapshot
  ON public.project_scopes(accounting_snapshot_id) WHERE is_primary;

GRANT SELECT ON public.project_scopes TO authenticated;
GRANT ALL ON public.project_scopes TO service_role;

ALTER TABLE public.project_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_scopes tenant read"
  ON public.project_scopes
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

CREATE POLICY "project_scopes block direct writes"
  ON public.project_scopes
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ============================================================
-- projects: readiness + current snapshot pointer
-- ============================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS accounting_readiness public.accounting_readiness_state
    NOT NULL DEFAULT 'pending_classification',
  ADD COLUMN IF NOT EXISTS current_accounting_snapshot_id UUID
    REFERENCES public.project_accounting_snapshots(id);

CREATE INDEX IF NOT EXISTS idx_projects_accounting_readiness
  ON public.projects(accounting_readiness);

-- ============================================================
-- Notify PostgREST
-- ============================================================
NOTIFY pgrst, 'reload schema';