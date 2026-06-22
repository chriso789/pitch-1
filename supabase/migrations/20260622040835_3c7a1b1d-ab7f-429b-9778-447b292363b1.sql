
-- Per-layer evidence diagnostics on both measurement job tables
ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS evidence_sources_used jsonb,
  ADD COLUMN IF NOT EXISTS footprint_source_tier text,
  ADD COLUMN IF NOT EXISTS evidence_acquisition_log jsonb;

ALTER TABLE public.measurement_jobs
  ADD COLUMN IF NOT EXISTS evidence_sources_used jsonb,
  ADD COLUMN IF NOT EXISTS footprint_source_tier text,
  ADD COLUMN IF NOT EXISTS evidence_acquisition_log jsonb;

-- Optional per-tenant orthophoto provider credentials
CREATE TABLE IF NOT EXISTS public.tenant_imagery_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('nearmap', 'vexcel')),
  api_key_secret_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  min_resolution_m_per_px numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_imagery_providers TO authenticated;
GRANT ALL ON public.tenant_imagery_providers TO service_role;

ALTER TABLE public.tenant_imagery_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Masters and tenant owners can read imagery providers"
  ON public.tenant_imagery_providers FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master'::app_role)
    OR tenant_id = public.get_user_tenant_id(auth.uid())
  );

CREATE POLICY "Masters and tenant owners can write imagery providers"
  ON public.tenant_imagery_providers FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'master'::app_role)
    OR (
      tenant_id = public.get_user_tenant_id(auth.uid())
      AND public.has_role(auth.uid(), 'owner'::app_role)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'master'::app_role)
    OR (
      tenant_id = public.get_user_tenant_id(auth.uid())
      AND public.has_role(auth.uid(), 'owner'::app_role)
    )
  );

CREATE TRIGGER tenant_imagery_providers_updated_at
  BEFORE UPDATE ON public.tenant_imagery_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
