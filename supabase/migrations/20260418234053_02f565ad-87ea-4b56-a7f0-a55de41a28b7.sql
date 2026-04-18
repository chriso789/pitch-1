
ALTER TABLE public.roof_training_sessions
  ADD COLUMN IF NOT EXISTS last_failure_reason text,
  ADD COLUMN IF NOT EXISTS last_failure_stage text,
  ADD COLUMN IF NOT EXISTS imagery_sources_attempted text[];

ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS last_failure_reason text,
  ADD COLUMN IF NOT EXISTS last_failure_stage text,
  ADD COLUMN IF NOT EXISTS imagery_sources_attempted text[];

CREATE INDEX IF NOT EXISTS idx_training_sessions_failure_reason
  ON public.roof_training_sessions(last_failure_reason)
  WHERE last_failure_reason IS NOT NULL;
