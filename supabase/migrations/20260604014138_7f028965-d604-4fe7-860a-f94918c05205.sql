
-- Extend mskill_roof_edge_candidates with the roof-perimeter-candidate fields
-- described in docs/measurement-conflict-lock.md and the user spec. We keep
-- the existing table to avoid breaking the existing executor + export, and
-- expose a logical alias view `roof_perimeter_candidates` so the UI can refer
-- to the new terminology.

ALTER TABLE public.mskill_roof_edge_candidates
  ADD COLUMN IF NOT EXISTS eave_offset_ft double precision,
  ADD COLUMN IF NOT EXISTS rake_offset_ft double precision,
  ADD COLUMN IF NOT EXISTS uniform_offset_ft double precision,
  ADD COLUMN IF NOT EXISTS effective_offset_ft double precision,
  ADD COLUMN IF NOT EXISTS base_building_footprint_geojson jsonb,
  ADD COLUMN IF NOT EXISTS roof_perimeter_geojson jsonb,
  ADD COLUMN IF NOT EXISTS delta_perimeter_ft double precision,
  ADD COLUMN IF NOT EXISTS validation_source text,
  ADD COLUMN IF NOT EXISTS porch_extension_detected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lanai_extension_detected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS attached_patios_detected boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Widen the allowed source_type values used by the new generator. We do this
-- with a soft constraint via comment rather than a CHECK so existing rows
-- (auto_buffer_candidate) remain valid.
COMMENT ON COLUMN public.mskill_roof_edge_candidates.source_type IS
  'one of: auto_offset_candidate | uniform_offset | adaptive_offset | roof_surface_refined | ai_detected | user_verified | auto_buffer_candidate (legacy)';

COMMENT ON COLUMN public.mskill_roof_edge_candidates.validation_source IS
  'one of: footprint_only | imagery_visual | dsm_surface | point_cloud_surface | user_verified';

-- updated_at trigger (idempotent)
CREATE OR REPLACE FUNCTION public.tg_mskill_roof_edge_candidates_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS mskill_roof_edge_candidates_touch ON public.mskill_roof_edge_candidates;
CREATE TRIGGER mskill_roof_edge_candidates_touch
BEFORE UPDATE ON public.mskill_roof_edge_candidates
FOR EACH ROW EXECUTE FUNCTION public.tg_mskill_roof_edge_candidates_touch();

-- Logical alias view: roof_perimeter_candidates
-- This is the name the new UI + GeoJSON export use. It is a 1:1 view over the
-- existing rows so we do not duplicate storage.
CREATE OR REPLACE VIEW public.roof_perimeter_candidates AS
SELECT
  id,
  tenant_id,
  mskill_request_id        AS measurement_request_id,
  mskill_job_id            AS measurement_job_id,
  building_footprint_id,
  request_hash,
  source_type,
  eave_offset_ft,
  rake_offset_ft,
  uniform_offset_ft,
  COALESCE(effective_offset_ft, offset_ft) AS effective_offset_ft,
  offset_ft,
  COALESCE(base_building_footprint_geojson, geometry_geojson) AS base_building_footprint_geojson,
  COALESCE(roof_perimeter_geojson, geometry_geojson)          AS roof_perimeter_geojson,
  area_sqft,
  perimeter_ft,
  area_delta_sqft         AS delta_area_sqft,
  delta_perimeter_ft,
  confidence,
  is_selected,
  status,
  validation_source,
  porch_extension_detected,
  lanai_extension_detected,
  attached_patios_detected,
  metadata,
  created_at,
  updated_at
FROM public.mskill_roof_edge_candidates;

GRANT SELECT ON public.roof_perimeter_candidates TO authenticated;
GRANT SELECT ON public.roof_perimeter_candidates TO service_role;

NOTIFY pgrst, 'reload schema';
