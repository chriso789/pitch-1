
-- 1) Per-tenant scoring config
CREATE TABLE IF NOT EXISTS public.storm_intel_tenant_config (
  tenant_id uuid PRIMARY KEY,
  default_ppsf numeric NOT NULL DEFAULT 220,
  w_damage numeric NOT NULL DEFAULT 0.30,
  w_equity numeric NOT NULL DEFAULT 0.15,
  w_claim numeric NOT NULL DEFAULT 0.55,
  claim_w_damage numeric NOT NULL DEFAULT 0.55,
  claim_w_equity numeric NOT NULL DEFAULT 0.20,
  claim_absentee_bonus int NOT NULL DEFAULT 10,
  claim_homestead_low_damage_penalty int NOT NULL DEFAULT 8,
  claim_homestead_high_damage_bonus int NOT NULL DEFAULT 6,
  hail_points_per_inch numeric NOT NULL DEFAULT 18,
  hail_cap int NOT NULL DEFAULT 45,
  wind_points_per_3mph numeric NOT NULL DEFAULT 1,
  wind_cap int NOT NULL DEFAULT 35,
  age_points_per_2yrs numeric NOT NULL DEFAULT 1,
  age_cap int NOT NULL DEFAULT 20,
  min_priority_to_route int NOT NULL DEFAULT 60,
  min_confidence_for_public_only int NOT NULL DEFAULT 70,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.storm_intel_tenant_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for storm_intel_tenant_config"
  ON public.storm_intel_tenant_config FOR ALL
  USING (tenant_id = (SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()));

-- 2) Per-county config
CREATE TABLE IF NOT EXISTS public.storm_intel_county_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  state text NOT NULL,
  county text NOT NULL,
  zip text,
  ppsf numeric NOT NULL,
  ltv_recent numeric NOT NULL DEFAULT 0.9,
  ltv_5yr numeric NOT NULL DEFAULT 0.8,
  ltv_10yr numeric NOT NULL DEFAULT 0.7,
  ltv_older numeric NOT NULL DEFAULT 0.6,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, state, county, zip)
);

ALTER TABLE public.storm_intel_county_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for storm_intel_county_config"
  ON public.storm_intel_county_config FOR ALL
  USING (tenant_id = (SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()));

-- 3) Canvass areas (manager-drawn polygons)
CREATE TABLE IF NOT EXISTS public.canvass_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  polygon_geojson jsonb NOT NULL,
  color text DEFAULT '#3b82f6',
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.canvass_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for canvass_areas"
  ON public.canvass_areas FOR ALL
  USING (tenant_id = (SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()));

-- 4) Area assignments
CREATE TABLE IF NOT EXISTS public.canvass_area_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  area_id uuid NOT NULL REFERENCES public.canvass_areas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  is_active boolean DEFAULT true,
  assigned_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, area_id, user_id)
);

ALTER TABLE public.canvass_area_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for canvass_area_assignments"
  ON public.canvass_area_assignments FOR ALL
  USING (tenant_id = (SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()));

-- 5) Area property membership (precomputed)
CREATE TABLE IF NOT EXISTS public.canvass_area_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  area_id uuid NOT NULL REFERENCES public.canvass_areas(id) ON DELETE CASCADE,
  property_id uuid NOT NULL,
  lat double precision,
  lng double precision,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, area_id, property_id)
);

CREATE INDEX IF NOT EXISTS canvass_area_properties_area_idx ON public.canvass_area_properties(tenant_id, area_id);

ALTER TABLE public.canvass_area_properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for canvass_area_properties"
  ON public.canvass_area_properties FOR ALL
  USING (tenant_id = (SELECT COALESCE(active_tenant_id, tenant_id) FROM public.profiles WHERE id = auth.uid()));

-- 6) Live counter view
CREATE OR REPLACE VIEW public.canvass_area_stats
WITH (security_invoker = true) AS
SELECT
  ap.tenant_id,
  ap.area_id,
  count(*)::int AS total_properties,
  count(DISTINCT v.property_id)::int AS contacted_properties
FROM public.canvass_area_properties ap
LEFT JOIN public.canvassiq_visits v
  ON v.property_id = ap.property_id
  AND v.tenant_id = ap.tenant_id
GROUP BY ap.tenant_id, ap.area_id;
