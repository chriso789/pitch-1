
-- =====================================================================
-- PITCH Measure — Internal Skill Pipeline (schema + seed)
-- Prefix: mskill_  (avoids collision with existing measurement_jobs/building_footprints)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.mskill_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =====================================================================
-- mskill_requests
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  created_by UUID,
  input_address TEXT NOT NULL,
  normalized_address TEXT,
  google_place_id TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  county TEXT,
  geocode_location_type TEXT,
  partial_match BOOLEAN DEFAULT false,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  status_reason TEXT,
  contact_id UUID,
  lead_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_requests_tenant ON public.mskill_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mskill_requests_hash ON public.mskill_requests(request_hash);
CREATE INDEX IF NOT EXISTS idx_mskill_requests_status ON public.mskill_requests(status);
GRANT SELECT, INSERT, UPDATE ON public.mskill_requests TO authenticated;
GRANT ALL ON public.mskill_requests TO service_role;
ALTER TABLE public.mskill_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_requests_tenant_all" ON public.mskill_requests FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));
CREATE TRIGGER trg_mskill_requests_touch BEFORE UPDATE ON public.mskill_requests
  FOR EACH ROW EXECUTE FUNCTION public.mskill_touch_updated_at();

-- =====================================================================
-- mskill_registry
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  execution_target TEXT NOT NULL CHECK (execution_target IN ('control_plane','internal_worker','hybrid')),
  pipeline_order INT NOT NULL,
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  required_inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  produced_outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  strength TEXT,
  pass_gate JSONB DEFAULT '{}'::jsonb,
  worker_endpoint TEXT,
  version TEXT NOT NULL DEFAULT 'v1',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_registry_order ON public.mskill_registry(pipeline_order);
GRANT SELECT ON public.mskill_registry TO authenticated, anon;
GRANT ALL ON public.mskill_registry TO service_role;
ALTER TABLE public.mskill_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_registry_read" ON public.mskill_registry FOR SELECT USING (true);

-- =====================================================================
-- mskill_jobs
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID NOT NULL REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  current_skill_key TEXT,
  blocked_reason TEXT,
  bridge_status TEXT NOT NULL DEFAULT 'not_written',
  target_roof_measurement_id UUID,
  created_by UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_jobs_tenant ON public.mskill_jobs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mskill_jobs_request ON public.mskill_jobs(mskill_request_id);
CREATE INDEX IF NOT EXISTS idx_mskill_jobs_hash ON public.mskill_jobs(request_hash);
GRANT SELECT, INSERT, UPDATE ON public.mskill_jobs TO authenticated;
GRANT ALL ON public.mskill_jobs TO service_role;
ALTER TABLE public.mskill_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_jobs_tenant_all" ON public.mskill_jobs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));
CREATE TRIGGER trg_mskill_jobs_touch BEFORE UPDATE ON public.mskill_jobs
  FOR EACH ROW EXECUTE FUNCTION public.mskill_touch_updated_at();

-- =====================================================================
-- mskill_runs
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID NOT NULL REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  skill_key TEXT NOT NULL,
  skill_version TEXT,
  execution_target TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','queued','running','requires_internal_worker','completed','failed','blocked','skipped')),
  input_payload JSONB DEFAULT '{}'::jsonb,
  output_payload JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  blocking_reason TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INT,
  worker_id UUID,
  worker_job_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_runs_job ON public.mskill_runs(mskill_job_id);
CREATE INDEX IF NOT EXISTS idx_mskill_runs_request ON public.mskill_runs(mskill_request_id);
CREATE INDEX IF NOT EXISTS idx_mskill_runs_hash_skill ON public.mskill_runs(request_hash, skill_key);
CREATE INDEX IF NOT EXISTS idx_mskill_runs_status ON public.mskill_runs(status);
GRANT SELECT, INSERT, UPDATE ON public.mskill_runs TO authenticated;
GRANT ALL ON public.mskill_runs TO service_role;
ALTER TABLE public.mskill_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_runs_tenant_all" ON public.mskill_runs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));
CREATE TRIGGER trg_mskill_runs_touch BEFORE UPDATE ON public.mskill_runs
  FOR EACH ROW EXECUTE FUNCTION public.mskill_touch_updated_at();

-- =====================================================================
-- mskill_artifacts
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID NOT NULL REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  mskill_run_id UUID NOT NULL REFERENCES public.mskill_runs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  storage_path TEXT,
  source_url TEXT,
  byte_size BIGINT,
  metadata JSONB DEFAULT '{}'::jsonb,
  is_stale BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_run ON public.mskill_artifacts(mskill_run_id);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_job ON public.mskill_artifacts(mskill_job_id);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_type ON public.mskill_artifacts(artifact_type);
CREATE INDEX IF NOT EXISTS idx_mskill_artifacts_hash ON public.mskill_artifacts(request_hash);
GRANT SELECT, INSERT, UPDATE ON public.mskill_artifacts TO authenticated;
GRANT ALL ON public.mskill_artifacts TO service_role;
ALTER TABLE public.mskill_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_artifacts_tenant_all" ON public.mskill_artifacts FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

-- =====================================================================
-- provider catalog
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_provider_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  scope TEXT NOT NULL,
  base_url TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  requires_paid_toggle BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mskill_provider_sources TO authenticated, anon;
GRANT ALL ON public.mskill_provider_sources TO service_role;
ALTER TABLE public.mskill_provider_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_provider_sources_read" ON public.mskill_provider_sources FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.mskill_provider_coverage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL REFERENCES public.mskill_provider_sources(provider_key) ON DELETE CASCADE,
  county TEXT,
  state TEXT,
  coverage_geojson JSONB,
  data_year INT,
  resolution_m DOUBLE PRECISION,
  asset_type TEXT,
  source_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_pcov_provider ON public.mskill_provider_coverage(provider_key);
CREATE INDEX IF NOT EXISTS idx_mskill_pcov_county ON public.mskill_provider_coverage(county, state);
GRANT SELECT ON public.mskill_provider_coverage TO authenticated, anon;
GRANT ALL ON public.mskill_provider_coverage TO service_role;
ALTER TABLE public.mskill_provider_coverage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_pcov_read" ON public.mskill_provider_coverage FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.mskill_provider_sync_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key TEXT NOT NULL,
  sync_status TEXT NOT NULL,
  message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mskill_provider_sync_logs TO authenticated;
GRANT ALL ON public.mskill_provider_sync_logs TO service_role;
ALTER TABLE public.mskill_provider_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_psl_read_auth" ON public.mskill_provider_sync_logs FOR SELECT TO authenticated USING (true);

-- =====================================================================
-- parcels / footprints / roof_edge_candidates (mskill-scoped)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_parcels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID NOT NULL REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  provider_key TEXT,
  external_id TEXT,
  county TEXT,
  situs_address TEXT,
  owner_name TEXT,
  geometry_geojson JSONB NOT NULL,
  address_match BOOLEAN,
  parcel_needs_review BOOLEAN DEFAULT false,
  confidence DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_parcels_request ON public.mskill_parcels(mskill_request_id);
GRANT SELECT, INSERT, UPDATE ON public.mskill_parcels TO authenticated;
GRANT ALL ON public.mskill_parcels TO service_role;
ALTER TABLE public.mskill_parcels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_parcels_tenant_all" ON public.mskill_parcels FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_building_footprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID NOT NULL REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  parcel_id UUID REFERENCES public.mskill_parcels(id) ON DELETE SET NULL,
  request_hash TEXT NOT NULL,
  provider_key TEXT,
  geometry_geojson JSONB NOT NULL,
  area_sqft DOUBLE PRECISION,
  confidence DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_fp_request ON public.mskill_building_footprints(mskill_request_id);
GRANT SELECT, INSERT, UPDATE ON public.mskill_building_footprints TO authenticated;
GRANT ALL ON public.mskill_building_footprints TO service_role;
ALTER TABLE public.mskill_building_footprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_fp_tenant_all" ON public.mskill_building_footprints FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_roof_edge_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID NOT NULL REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  building_footprint_id UUID REFERENCES public.mskill_building_footprints(id) ON DELETE SET NULL,
  request_hash TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'auto_buffer_candidate',
  offset_ft DOUBLE PRECISION NOT NULL,
  geometry_geojson JSONB NOT NULL,
  area_sqft DOUBLE PRECISION,
  perimeter_ft DOUBLE PRECISION,
  area_delta_sqft DOUBLE PRECISION,
  confidence DOUBLE PRECISION,
  is_selected BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'proposed',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_rec_job ON public.mskill_roof_edge_candidates(mskill_job_id);
GRANT SELECT, INSERT, UPDATE ON public.mskill_roof_edge_candidates TO authenticated;
GRANT ALL ON public.mskill_roof_edge_candidates TO service_role;
ALTER TABLE public.mskill_roof_edge_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_rec_tenant_all" ON public.mskill_roof_edge_candidates FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

-- =====================================================================
-- lidar discovery
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_lidar_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID NOT NULL REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  aoi_geojson JSONB NOT NULL,
  buffer_ft DOUBLE PRECISION,
  provider_key TEXT,
  coverage_metadata JSONB DEFAULT '{}'::jsonb,
  has_coverage BOOLEAN,
  data_year INT,
  resolution_m DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_lwin_job ON public.mskill_lidar_windows(mskill_job_id);
GRANT SELECT, INSERT, UPDATE ON public.mskill_lidar_windows TO authenticated;
GRANT ALL ON public.mskill_lidar_windows TO service_role;
ALTER TABLE public.mskill_lidar_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_lwin_tenant_all" ON public.mskill_lidar_windows FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_lidar_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_lidar_window_id UUID NOT NULL REFERENCES public.mskill_lidar_windows(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  source_url TEXT,
  file_format TEXT,
  supports_roof_geometry BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mskill_lidar_assets TO authenticated;
GRANT ALL ON public.mskill_lidar_assets TO service_role;
ALTER TABLE public.mskill_lidar_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_lassets_tenant_all" ON public.mskill_lidar_assets FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_elevation_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  mskill_lidar_window_id UUID REFERENCES public.mskill_lidar_windows(id) ON DELETE SET NULL,
  request_hash TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  provider_key TEXT,
  source_url TEXT,
  storage_path TEXT,
  supports_roof_geometry BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mskill_elevation_assets TO authenticated;
GRANT ALL ON public.mskill_elevation_assets TO service_role;
ALTER TABLE public.mskill_elevation_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_elev_tenant_all" ON public.mskill_elevation_assets FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

-- =====================================================================
-- roof surface
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_roof_surface_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  provider_key TEXT,
  source_url TEXT,
  storage_path TEXT,
  file_format TEXT,
  byte_size BIGINT,
  requires_internal_worker BOOLEAN NOT NULL DEFAULT false,
  blocking_reason TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mskill_roof_surface_assets TO authenticated;
GRANT ALL ON public.mskill_roof_surface_assets TO service_role;
ALTER TABLE public.mskill_roof_surface_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_rsa_tenant_all" ON public.mskill_roof_surface_assets FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_surface_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  mskill_roof_surface_asset_id UUID REFERENCES public.mskill_roof_surface_assets(id) ON DELETE SET NULL,
  request_hash TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  worker_id UUID,
  worker_job_ref TEXT,
  input_payload JSONB DEFAULT '{}'::jsonb,
  output_payload JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mskill_surface_processing_jobs TO authenticated;
GRANT ALL ON public.mskill_surface_processing_jobs TO service_role;
ALTER TABLE public.mskill_surface_processing_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_spj_tenant_all" ON public.mskill_surface_processing_jobs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_point_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  point_count BIGINT,
  point_density DOUBLE PRECISION,
  bounds_geojson JSONB,
  crs TEXT,
  storage_path TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mskill_point_jobs TO authenticated;
GRANT ALL ON public.mskill_point_jobs TO service_role;
ALTER TABLE public.mskill_point_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_pj_tenant_all" ON public.mskill_point_jobs FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

-- =====================================================================
-- fitted geometry
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_plane_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  facet_index INT,
  polygon_geojson JSONB,
  plane_normal JSONB,
  plane_equation JSONB,
  plane_rmse DOUBLE PRECISION,
  pitch_rise_over_12 DOUBLE PRECISION,
  pitch_degrees DOUBLE PRECISION,
  area_2d_sqft DOUBLE PRECISION,
  area_slope_sqft DOUBLE PRECISION,
  confidence DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mskill_plane_candidates TO authenticated;
GRANT ALL ON public.mskill_plane_candidates TO service_role;
ALTER TABLE public.mskill_plane_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_planes_tenant_all" ON public.mskill_plane_candidates FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  segment_type TEXT NOT NULL CHECK (segment_type IN ('ridge','hip','valley','eave','rake')),
  start_point JSONB,
  end_point JSONB,
  length_ft DOUBLE PRECISION,
  confidence DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_segments_job_type ON public.mskill_segments(mskill_job_id, segment_type);
GRANT SELECT, INSERT, UPDATE ON public.mskill_segments TO authenticated;
GRANT ALL ON public.mskill_segments TO service_role;
ALTER TABLE public.mskill_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_segs_tenant_all" ON public.mskill_segments FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_geometry_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_job_id UUID NOT NULL UNIQUE REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  has_parcel BOOLEAN DEFAULT false,
  has_footprint BOOLEAN DEFAULT false,
  has_roof_edge BOOLEAN DEFAULT false,
  has_lidar_coverage BOOLEAN DEFAULT false,
  has_dsm BOOLEAN DEFAULT false,
  has_dtm BOOLEAN DEFAULT false,
  has_chm BOOLEAN DEFAULT false,
  has_roof_points BOOLEAN DEFAULT false,
  has_planes BOOLEAN DEFAULT false,
  has_segments BOOLEAN DEFAULT false,
  has_pitch BOOLEAN DEFAULT false,
  has_area BOOLEAN DEFAULT false,
  validation_status TEXT,
  confidence_score DOUBLE PRECISION,
  ready_for_bridge BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mskill_geometry_status TO authenticated;
GRANT ALL ON public.mskill_geometry_status TO service_role;
ALTER TABLE public.mskill_geometry_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_geo_tenant_all" ON public.mskill_geometry_status FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));
CREATE TRIGGER trg_mskill_geo_touch BEFORE UPDATE ON public.mskill_geometry_status
  FOR EACH ROW EXECUTE FUNCTION public.mskill_touch_updated_at();

-- =====================================================================
-- report artifacts + workers + bridges
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.mskill_report_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  storage_path TEXT,
  source_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mskill_report_artifacts TO authenticated;
GRANT ALL ON public.mskill_report_artifacts TO service_role;
ALTER TABLE public.mskill_report_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_ra_tenant_all" ON public.mskill_report_artifacts FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.mskill_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  capabilities JSONB DEFAULT '[]'::jsonb,
  is_online BOOLEAN NOT NULL DEFAULT false,
  last_health_check TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mskill_workers TO authenticated;
GRANT ALL ON public.mskill_workers TO service_role;
ALTER TABLE public.mskill_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_workers_read" ON public.mskill_workers FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.mskill_pipeline_bridges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  mskill_request_id UUID NOT NULL REFERENCES public.mskill_requests(id) ON DELETE CASCADE,
  mskill_job_id UUID NOT NULL REFERENCES public.mskill_jobs(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  source_pipeline TEXT NOT NULL DEFAULT 'mskill_runs',
  target_table TEXT NOT NULL DEFAULT 'roof_measurements',
  target_record_id UUID,
  bridge_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (bridge_status IN ('pending','written','failed','blocked')),
  validation_status TEXT,
  confidence_score DOUBLE PRECISION,
  exported_payload JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mskill_bridges_job ON public.mskill_pipeline_bridges(mskill_job_id);
CREATE INDEX IF NOT EXISTS idx_mskill_bridges_target ON public.mskill_pipeline_bridges(target_record_id);
GRANT SELECT, INSERT, UPDATE ON public.mskill_pipeline_bridges TO authenticated;
GRANT ALL ON public.mskill_pipeline_bridges TO service_role;
ALTER TABLE public.mskill_pipeline_bridges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mskill_bridges_tenant_all" ON public.mskill_pipeline_bridges FOR ALL TO authenticated
  USING (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()));
CREATE TRIGGER trg_mskill_bridges_touch BEFORE UPDATE ON public.mskill_pipeline_bridges
  FOR EACH ROW EXECUTE FUNCTION public.mskill_touch_updated_at();

-- =====================================================================
-- SEED: 24 skills
-- =====================================================================
INSERT INTO public.mskill_registry
  (skill_key, display_name, category, execution_target, pipeline_order, dependencies, worker_endpoint, strength)
VALUES
  ('geocode_address','Geocode Address','address','control_plane',1,'{}'::text[],NULL,'Entry point. Anchors the request to a real address, place_id, lat/lon, county.'),
  ('resolve_parcel','Resolve Parcel','parcel','control_plane',2,ARRAY['geocode_address'],NULL,'Stops the system from selecting the wrong neighbor property.'),
  ('resolve_building_footprint','Resolve Building Footprint','footprint','control_plane',3,ARRAY['resolve_parcel'],NULL,'Identifies the structure inside the parcel (wall-line anchor).'),
  ('create_roof_edge_candidates','Create Roof Edge Candidates','footprint','control_plane',4,ARRAY['resolve_building_footprint'],NULL,'Builds eave/rake candidate offsets from the wall-line footprint.'),
  ('discover_lidar_coverage','Discover LiDAR Coverage','lidar','control_plane',5,ARRAY['create_roof_edge_candidates'],NULL,'Determines provider coverage for the AOI (metadata only).'),
  ('discover_elevation_assets','Discover Elevation Assets','lidar','control_plane',6,ARRAY['discover_lidar_coverage'],NULL,'Classifies real asset types; prevents DEM from being mislabeled as DSM.'),
  ('acquire_dem_dtm','Acquire DEM/DTM','elevation','hybrid',7,ARRAY['discover_elevation_assets'],NULL,'Bare-earth terrain context; useful for height normalization, not roof planes.'),
  ('acquire_roof_surface_asset','Acquire Roof Surface Asset','elevation','control_plane',8,ARRAY['discover_elevation_assets'],NULL,'Finds the actual roof-surface-capable data source (DSM or point cloud).'),
  ('clip_point_cloud','Clip Point Cloud','compute','internal_worker',9,ARRAY['acquire_roof_surface_asset'],'/skills/clip-point-cloud','Turns large public LiDAR into a small property-specific working dataset.'),
  ('generate_dsm','Generate DSM','compute','internal_worker',10,ARRAY['clip_point_cloud'],'/skills/generate-dsm','Creates first-return surface model. Not the same as DEM.'),
  ('generate_dtm','Generate DTM','compute','internal_worker',11,ARRAY['clip_point_cloud'],'/skills/generate-dtm','Creates ground model for height-above-ground comparison.'),
  ('generate_chm','Generate CHM','compute','internal_worker',12,ARRAY['generate_dsm','generate_dtm'],'/skills/generate-chm','Creates height-above-ground (DSM - DTM) to isolate roof from ground/vegetation.'),
  ('isolate_roof_points','Isolate Roof Points','compute','internal_worker',13,ARRAY['generate_chm','create_roof_edge_candidates'],'/skills/isolate-roof-points','Separates roof surface from trees, ground, vents, noise.'),
  ('fit_roof_planes','Fit Roof Planes','geometry','internal_worker',14,ARRAY['isolate_roof_points'],'/skills/fit-roof-planes','Fits planes to roof surface points — facets begin here.'),
  ('detect_ridges','Detect Ridges','geometry','internal_worker',15,ARRAY['fit_roof_planes'],'/skills/detect-ridges','High intersection lines where planes meet and drain away.'),
  ('detect_hips','Detect Hips','geometry','internal_worker',16,ARRAY['fit_roof_planes'],'/skills/detect-hips','Sloped exterior plane intersections.'),
  ('detect_valleys','Detect Valleys','geometry','internal_worker',17,ARRAY['fit_roof_planes'],'/skills/detect-valleys','Low interior drainage lines where planes slope toward each other.'),
  ('detect_eaves','Detect Eaves','geometry','hybrid',18,ARRAY['fit_roof_planes','create_roof_edge_candidates'],'/skills/detect-eaves','Perimeter roof-edge (not wall) lower lines.'),
  ('detect_rakes','Detect Rakes','geometry','hybrid',19,ARRAY['fit_roof_planes','create_roof_edge_candidates'],'/skills/detect-rakes','Sloped gable perimeter edges.'),
  ('calculate_pitch','Calculate Pitch','geometry','internal_worker',20,ARRAY['fit_roof_planes'],'/skills/calculate-pitch','Plane normals → pitch (rise over 12) per facet.'),
  ('calculate_roof_area','Calculate Roof Area','geometry','hybrid',21,ARRAY['fit_roof_planes','calculate_pitch'],'/skills/calculate-roof-area','Slope-adjusted roof area (not footprint area).'),
  ('validate_geometry','Validate Geometry','validation','hybrid',22,ARRAY['calculate_roof_area','detect_ridges','detect_hips','detect_valleys','detect_eaves','detect_rakes'],NULL,'Prevents bad reports. Confidence + critical-failure gate.'),
  ('export_geojson','Export GeoJSON','export','control_plane',23,ARRAY['validate_geometry'],NULL,'Machine-readable measurement data for downstream PITCH integration.'),
  ('export_report','Export Report','export','hybrid',24,ARRAY['validate_geometry','export_geojson'],NULL,'Final contractor-facing roof measurement report. Only after validation.')
ON CONFLICT (skill_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  category = EXCLUDED.category,
  execution_target = EXCLUDED.execution_target,
  pipeline_order = EXCLUDED.pipeline_order,
  dependencies = EXCLUDED.dependencies,
  worker_endpoint = EXCLUDED.worker_endpoint,
  strength = EXCLUDED.strength,
  updated_at = now();

INSERT INTO public.mskill_provider_sources (provider_key, display_name, category, scope, is_enabled, requires_paid_toggle, metadata)
VALUES
  ('google_geocode','Google Geocoding','geocode','global',true,false,'{}'::jsonb),
  ('usgs_3dep','USGS 3DEP','elevation','national',true,false,'{"asset_types":["DEM","DTM"]}'::jsonb),
  ('noaa_digital_coast','NOAA Digital Coast','lidar','national',true,false,'{"asset_types":["point_cloud","DEM"]}'::jsonb),
  ('labins','LABINS (FL)','lidar','state',true,false,'{"state":"FL"}'::jsonb),
  ('osm_buildings','OSM Buildings','footprint','global',true,false,'{}'::jsonb),
  ('ms_buildings','Microsoft Building Footprints','footprint','national',true,false,'{}'::jsonb)
ON CONFLICT (provider_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
