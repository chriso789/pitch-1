ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS dsm_registration_status text,
  ADD COLUMN IF NOT EXISTS raster_candidate_check_passed boolean,
  ADD COLUMN IF NOT EXISTS candidate_coordinate_space text,
  ADD COLUMN IF NOT EXISTS dsm_candidate_check_skipped boolean;

ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS dsm_registration_status text,
  ADD COLUMN IF NOT EXISTS raster_candidate_check_passed boolean,
  ADD COLUMN IF NOT EXISTS candidate_coordinate_space text,
  ADD COLUMN IF NOT EXISTS dsm_candidate_check_skipped boolean;

ALTER TABLE public.measurement_jobs
  ADD COLUMN IF NOT EXISTS dsm_registration_status text,
  ADD COLUMN IF NOT EXISTS raster_candidate_check_passed boolean,
  ADD COLUMN IF NOT EXISTS candidate_coordinate_space text,
  ADD COLUMN IF NOT EXISTS dsm_candidate_check_skipped boolean;

NOTIFY pgrst, 'reload schema';