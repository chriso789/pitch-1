ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS failure_stage text;

