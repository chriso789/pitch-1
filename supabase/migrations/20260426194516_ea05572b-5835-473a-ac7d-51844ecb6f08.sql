
-- Bridge columns for AI Measurement geometry_first_v2 pipeline

-- measurement_jobs: link to ai_measurement_jobs and source record
ALTER TABLE public.measurement_jobs
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS source_record_type text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS source_button text,
  ADD COLUMN IF NOT EXISTS ai_measurement_job_id uuid,
  ADD COLUMN IF NOT EXISTS engine_version text,
  ADD COLUMN IF NOT EXISTS geocode_location_type text;

-- ai_measurement_jobs: source linkage + raster calibration audit fields
ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS source_record_type text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS source_button text,
  ADD COLUMN IF NOT EXISTS logical_image_width integer,
  ADD COLUMN IF NOT EXISTS logical_image_height integer,
  ADD COLUMN IF NOT EXISTS actual_image_width integer,
  ADD COLUMN IF NOT EXISTS actual_image_height integer,
  ADD COLUMN IF NOT EXISTS raster_scale numeric,
  ADD COLUMN IF NOT EXISTS engine_version text,
  ADD COLUMN IF NOT EXISTS geocode_location_type text,
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- roof_measurements: bridge to ai_measurement audit + geometry report
ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS ai_measurement_job_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS source_record_type text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS source_button text,
  ADD COLUMN IF NOT EXISTS engine_version text,
  ADD COLUMN IF NOT EXISTS geometry_report_json jsonb,
  ADD COLUMN IF NOT EXISTS geometry_quality_score numeric,
  ADD COLUMN IF NOT EXISTS measurement_quality_score numeric;

-- measurement_approvals: bridge to ai_measurement + source record
ALTER TABLE public.measurement_approvals
  ADD COLUMN IF NOT EXISTS ai_measurement_job_id uuid,
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS project_id uuid,
  ADD COLUMN IF NOT EXISTS source_record_type text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid;

CREATE INDEX IF NOT EXISTS idx_measurement_jobs_ai_job
  ON public.measurement_jobs (ai_measurement_job_id);
CREATE INDEX IF NOT EXISTS idx_roof_measurements_ai_job
  ON public.roof_measurements (ai_measurement_job_id);
CREATE INDEX IF NOT EXISTS idx_ai_measurement_jobs_lead
  ON public.ai_measurement_jobs (lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_measurement_jobs_project
  ON public.ai_measurement_jobs (project_id);
