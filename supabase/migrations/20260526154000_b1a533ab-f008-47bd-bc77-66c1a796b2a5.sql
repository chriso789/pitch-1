
-- ============================================================
-- Infrastructure Cost Tracking & Profitability System
-- Platform-admin-only. Uses tenant_id (the project's canonical
-- company identifier) rather than a separate company_id column.
-- ============================================================

-- Helper: platform admin gate (master role).
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'master'::app_role);
$$;

-- ------------------------------------------------------------
-- 1. provider_costs
-- ------------------------------------------------------------
CREATE TABLE public.provider_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_type text NOT NULL,
  unit text NOT NULL,
  cost_per_unit numeric NOT NULL DEFAULT 0,
  markup_percent numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.provider_costs TO authenticated;
GRANT ALL ON public.provider_costs TO service_role;

ALTER TABLE public.provider_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read provider_costs"
  ON public.provider_costs FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

CREATE POLICY "platform admins write provider_costs"
  ON public.provider_costs FOR ALL
  TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- Seed
INSERT INTO public.provider_costs (provider, event_type, unit, cost_per_unit) VALUES
  ('openai',     'ai_tokens_input',  'token',      0.0000005),
  ('openai',     'ai_tokens_output', 'token',      0.000002),
  ('openai',     'ai_generation',    'request',    0.01),
  ('telnyx',     'sms_outbound',     'message',    0.0075),
  ('telnyx',     'sms_inbound',      'message',    0.004),
  ('telnyx',     'voice_minute',     'minute',     0.02),
  ('supabase',   'edge_invocation',  'invocation', 0.000002),
  ('supabase',   'storage_mb',       'mb',         0.000025),
  ('supabase',   'bandwidth_mb',     'mb',         0.00009),
  ('mapbox',     'map_load',         'load',       0.0007),
  ('firecrawl',  'scrape_credit',    'credit',     0.01),
  ('serpapi',    'search',           'search',     0.015),
  ('roofr',      'roof_report',      'report',     18.00),
  ('eagleview',  'roof_report',      'report',     45.00),
  ('elevenlabs', 'voice_character',  'character',  0.00003),
  ('runway',     'video_generation', 'second',     0.15),
  ('lovable',    'ai_prompt',        'prompt',     0.05),
  ('cloudflare', 'bandwidth_gb',     'gb',         0.08)
ON CONFLICT (provider, event_type) DO NOTHING;

-- ------------------------------------------------------------
-- 2. usage_events
-- ------------------------------------------------------------
CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  user_id uuid,
  provider text NOT NULL,
  event_type text NOT NULL,
  feature_area text,
  quantity numeric NOT NULL DEFAULT 1,
  unit text,
  unit_cost numeric NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  billable_amount numeric NOT NULL DEFAULT 0,
  request_id text,
  edge_function text,
  status text NOT NULL DEFAULT 'success',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_events_tenant ON public.usage_events(tenant_id);
CREATE INDEX idx_usage_events_user ON public.usage_events(user_id);
CREATE INDEX idx_usage_events_provider ON public.usage_events(provider);
CREATE INDEX idx_usage_events_event_type ON public.usage_events(event_type);
CREATE INDEX idx_usage_events_feature_area ON public.usage_events(feature_area);
CREATE INDEX idx_usage_events_created_at ON public.usage_events(created_at DESC);
CREATE INDEX idx_usage_events_tenant_month ON public.usage_events(tenant_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read usage_events"
  ON public.usage_events FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- Inserts only via service role (edge functions). No client insert path.

-- ------------------------------------------------------------
-- 3. company_usage_limits  (keyed by tenant_id)
-- ------------------------------------------------------------
CREATE TABLE public.company_usage_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_name text NOT NULL DEFAULT 'basic_50',
  monthly_price numeric NOT NULL DEFAULT 50,
  sms_monthly_limit integer NOT NULL DEFAULT 250,
  ai_prompt_monthly_limit integer NOT NULL DEFAULT 100,
  ai_token_monthly_limit integer NOT NULL DEFAULT 100000,
  storage_mb_limit integer NOT NULL DEFAULT 5120,
  map_load_monthly_limit integer NOT NULL DEFAULT 1000,
  scrape_monthly_limit integer NOT NULL DEFAULT 25,
  roof_report_monthly_limit integer NOT NULL DEFAULT 0,
  voice_minute_monthly_limit integer NOT NULL DEFAULT 0,
  hard_stop_enabled boolean NOT NULL DEFAULT true,
  warning_threshold_percent integer NOT NULL DEFAULT 80,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_usage_limits TO authenticated;
GRANT ALL ON public.company_usage_limits TO service_role;

ALTER TABLE public.company_usage_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins manage company_usage_limits"
  ON public.company_usage_limits FOR ALL
  TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- Backfill default plan for every existing tenant
INSERT INTO public.company_usage_limits (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. company_usage_monthly_rollups
-- ------------------------------------------------------------
CREATE TABLE public.company_usage_monthly_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  month text NOT NULL,
  revenue numeric NOT NULL DEFAULT 0,
  total_estimated_cost numeric NOT NULL DEFAULT 0,
  gross_profit numeric NOT NULL DEFAULT 0,
  gross_margin_percent numeric NOT NULL DEFAULT 0,
  sms_count integer NOT NULL DEFAULT 0,
  ai_prompt_count integer NOT NULL DEFAULT 0,
  ai_token_count integer NOT NULL DEFAULT 0,
  voice_minutes numeric NOT NULL DEFAULT 0,
  map_loads integer NOT NULL DEFAULT 0,
  storage_mb numeric NOT NULL DEFAULT 0,
  scrape_count integer NOT NULL DEFAULT 0,
  roof_report_count integer NOT NULL DEFAULT 0,
  event_count integer NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_usage_monthly_rollups TO authenticated;
GRANT ALL ON public.company_usage_monthly_rollups TO service_role;

ALTER TABLE public.company_usage_monthly_rollups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read company rollups"
  ON public.company_usage_monthly_rollups FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- ------------------------------------------------------------
-- 5. user_usage_monthly_rollups
-- ------------------------------------------------------------
CREATE TABLE public.user_usage_monthly_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  month text NOT NULL,
  total_estimated_cost numeric NOT NULL DEFAULT 0,
  event_count integer NOT NULL DEFAULT 0,
  sms_count integer NOT NULL DEFAULT 0,
  ai_prompt_count integer NOT NULL DEFAULT 0,
  ai_token_count integer NOT NULL DEFAULT 0,
  voice_minutes numeric NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_usage_monthly_rollups TO authenticated;
GRANT ALL ON public.user_usage_monthly_rollups TO service_role;

ALTER TABLE public.user_usage_monthly_rollups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform admins read user rollups"
  ON public.user_usage_monthly_rollups FOR SELECT
  TO authenticated
  USING (public.is_platform_admin(auth.uid()));

-- updated_at triggers (reuse existing helper)
CREATE TRIGGER trg_provider_costs_updated_at
  BEFORE UPDATE ON public.provider_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_company_usage_limits_updated_at
  BEFORE UPDATE ON public.company_usage_limits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_company_usage_monthly_rollups_updated_at
  BEFORE UPDATE ON public.company_usage_monthly_rollups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_user_usage_monthly_rollups_updated_at
  BEFORE UPDATE ON public.user_usage_monthly_rollups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

NOTIFY pgrst, 'reload schema';
