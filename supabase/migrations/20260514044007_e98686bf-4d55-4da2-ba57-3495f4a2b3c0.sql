ALTER TABLE public.measurement_jobs
  ADD COLUMN IF NOT EXISTS ai_measurement_engine_version text,
  ADD COLUMN IF NOT EXISTS perimeter_contract_version text,
  ADD COLUMN IF NOT EXISTS phase0_control_flow_version text,
  ADD COLUMN IF NOT EXISTS git_commit_sha text,
  ADD COLUMN IF NOT EXISTS runtime_deployed_at timestamptz;

ALTER TABLE public.ai_measurement_jobs
  ADD COLUMN IF NOT EXISTS ai_measurement_engine_version text,
  ADD COLUMN IF NOT EXISTS perimeter_contract_version text,
  ADD COLUMN IF NOT EXISTS phase0_control_flow_version text,
  ADD COLUMN IF NOT EXISTS git_commit_sha text,
  ADD COLUMN IF NOT EXISTS runtime_deployed_at timestamptz;

ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS ai_measurement_engine_version text,
  ADD COLUMN IF NOT EXISTS perimeter_contract_version text,
  ADD COLUMN IF NOT EXISTS phase0_control_flow_version text,
  ADD COLUMN IF NOT EXISTS git_commit_sha text,
  ADD COLUMN IF NOT EXISTS runtime_deployed_at timestamptz;

NOTIFY pgrst, 'reload schema';