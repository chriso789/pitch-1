ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS terminal_debug_payload jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_measurement_jobs_terminal_debug_stage
  ON public.ai_measurement_jobs ((terminal_debug_payload->>'cpu_budget_stage'))
  WHERE terminal_debug_payload IS NOT NULL;

NOTIFY pgrst, 'reload schema';