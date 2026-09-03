-- Blueprint Importer v2 — persisted trade takeoff synthesis.
CREATE TABLE IF NOT EXISTS public.blueprint_trade_takeoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_session_id UUID NOT NULL REFERENCES public.blueprint_import_sessions(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  trade_id TEXT NOT NULL,
  support_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'needs_review',
  template_key TEXT,
  template_compatible BOOLEAN NOT NULL DEFAULT false,
  template_block_reason TEXT,
  measurements JSONB NOT NULL DEFAULT '[]'::jsonb,
  material_specs JSONB NOT NULL DEFAULT '[]'::jsonb,
  explicit_brands JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_measurement_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  missing_required_measurement_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  calculations JSONB NOT NULL DEFAULT '{}'::jsonb,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_measurement_ids UUID[] NOT NULL DEFAULT '{}',
  source_plan_path_ids UUID[] NOT NULL DEFAULT '{}',
  deterministic_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT bp_takeoff_trade_support_chk CHECK (support_status IN ('mvp_supported','measurement_object_only','future_supported','unsupported')),
  CONSTRAINT bp_takeoff_status_chk CHECK (status IN ('ready','needs_review','manual_only','blocked')),
  CONSTRAINT bp_takeoff_session_trade_uniq UNIQUE (import_session_id, trade_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprint_trade_takeoffs TO authenticated;
GRANT ALL ON public.blueprint_trade_takeoffs TO service_role;
ALTER TABLE public.blueprint_trade_takeoffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blueprint_trade_takeoffs tenant all" ON public.blueprint_trade_takeoffs
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE INDEX IF NOT EXISTS idx_bp_takeoff_session ON public.blueprint_trade_takeoffs(import_session_id);
CREATE INDEX IF NOT EXISTS idx_bp_takeoff_tenant_trade ON public.blueprint_trade_takeoffs(tenant_id, trade_id);
CREATE INDEX IF NOT EXISTS idx_bp_takeoff_status ON public.blueprint_trade_takeoffs(status);
