
ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS result_state text;

CREATE INDEX IF NOT EXISTS idx_ai_measurement_jobs_result_state
  ON public.ai_measurement_jobs(result_state);
