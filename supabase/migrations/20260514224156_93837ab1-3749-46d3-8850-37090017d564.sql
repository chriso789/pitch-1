-- Route provenance columns on the three measurement tables.
-- Phase 3 version values intentionally live inside geometry_report_json
-- (not as DB columns) to avoid schema-cache drift.

ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS created_by_function text,
  ADD COLUMN IF NOT EXISTS created_by_component text,
  ADD COLUMN IF NOT EXISTS solver_entrypoint text,
  ADD COLUMN IF NOT EXISTS report_renderer_version text,
  ADD COLUMN IF NOT EXISTS canonical_measurement_route boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS route_audit_version text;

ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS created_by_function text,
  ADD COLUMN IF NOT EXISTS created_by_component text,
  ADD COLUMN IF NOT EXISTS solver_entrypoint text,
  ADD COLUMN IF NOT EXISTS report_renderer_version text,
  ADD COLUMN IF NOT EXISTS canonical_measurement_route boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS route_audit_version text;

ALTER TABLE public.measurement_jobs
  ADD COLUMN IF NOT EXISTS created_by_function text,
  ADD COLUMN IF NOT EXISTS created_by_component text,
  ADD COLUMN IF NOT EXISTS solver_entrypoint text,
  ADD COLUMN IF NOT EXISTS report_renderer_version text,
  ADD COLUMN IF NOT EXISTS canonical_measurement_route boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS route_audit_version text;

CREATE INDEX IF NOT EXISTS roof_measurements_route_provenance_idx
  ON public.roof_measurements (created_by_function, created_at DESC);

CREATE INDEX IF NOT EXISTS roof_measurements_canonical_route_idx
  ON public.roof_measurements (canonical_measurement_route, created_at DESC);

NOTIFY pgrst, 'reload schema';