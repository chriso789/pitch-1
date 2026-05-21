
CREATE TABLE public.srs_reconciliation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  run_type TEXT NOT NULL DEFAULT 'scheduled',
  status TEXT NOT NULL DEFAULT 'running',
  orders_checked INTEGER NOT NULL DEFAULT 0,
  mismatches_found INTEGER NOT NULL DEFAULT 0,
  updates_applied INTEGER NOT NULL DEFAULT 0,
  errors_count INTEGER NOT NULL DEFAULT 0,
  results JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_srs_recon_tenant_started ON public.srs_reconciliation_runs(tenant_id, started_at DESC);

ALTER TABLE public.srs_reconciliation_runs ENABLE ROW LEVEL SECURITY;

-- Users can view reconciliation runs for tenants they belong to
CREATE POLICY "users_view_own_tenant_recon"
  ON public.srs_reconciliation_runs
  FOR SELECT
  TO authenticated
  USING (tenant_id::uuid = ANY (get_user_tenant_ids(auth.uid())));

-- Service role inserts/updates only (edge function uses service role)
