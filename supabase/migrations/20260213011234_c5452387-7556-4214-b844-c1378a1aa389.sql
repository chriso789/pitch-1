
-- ========================================
-- Table 1: batchleads_usage (cost tracking)
-- ========================================
CREATE TABLE IF NOT EXISTS public.batchleads_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  storm_event_id text NOT NULL,
  polygon_id text,
  normalized_address_key text,
  cost numeric NOT NULL DEFAULT 0.15,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.batchleads_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for batchleads_usage"
  ON public.batchleads_usage FOR ALL
  USING (tenant_id = (SELECT COALESCE(p.active_tenant_id, p.tenant_id) FROM public.profiles p WHERE p.id = auth.uid()));

-- ========================================
-- Table 2: storm_events (storm metadata)
-- ========================================
CREATE TABLE IF NOT EXISTS public.storm_events (
  id text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text,
  start_at timestamptz,
  end_at timestamptz,
  hazard_type text,
  max_wind_mph int,
  hail_max_in numeric,
  hail_prob numeric,
  wind_prob numeric,
  polygon_geojson jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.storm_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for storm_events"
  ON public.storm_events FOR ALL
  USING (tenant_id = (SELECT COALESCE(p.active_tenant_id, p.tenant_id) FROM public.profiles p WHERE p.id = auth.uid()));

-- ========================================
-- Table 3: storm_property_intel (scores)
-- ========================================
CREATE TABLE IF NOT EXISTS public.storm_property_intel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  storm_event_id text NOT NULL,
  property_id uuid,
  normalized_address_key text NOT NULL,
  property_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  damage_score int NOT NULL DEFAULT 0,
  equity_score int NOT NULL DEFAULT 0,
  claim_likelihood_score int NOT NULL DEFAULT 0,
  damage_factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  equity_factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  claim_factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority_score int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS storm_property_intel_uniq
  ON public.storm_property_intel(tenant_id, storm_event_id, normalized_address_key);

CREATE INDEX IF NOT EXISTS storm_property_intel_priority
  ON public.storm_property_intel(tenant_id, storm_event_id, priority_score DESC);

ALTER TABLE public.storm_property_intel ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for storm_property_intel"
  ON public.storm_property_intel FOR ALL
  USING (tenant_id = (SELECT COALESCE(p.active_tenant_id, p.tenant_id) FROM public.profiles p WHERE p.id = auth.uid()));

-- ========================================
-- Table 4: canvass_routes (optimized routes)
-- ========================================
CREATE TABLE IF NOT EXISTS public.canvass_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  storm_event_id text NOT NULL,
  user_id uuid,
  name text,
  start_lat double precision,
  start_lng double precision,
  planned_stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.canvass_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for canvass_routes"
  ON public.canvass_routes FOR ALL
  USING (tenant_id = (SELECT COALESCE(p.active_tenant_id, p.tenant_id) FROM public.profiles p WHERE p.id = auth.uid()));
