-- Deterministic keys for trade-engine reruns. Existing rows remain valid because
-- nullable keys do not collide; new automatic blueprint takeoff rows use them.

ALTER TABLE public.blueprint_plan_paths
  ADD COLUMN IF NOT EXISTS deterministic_key text;
ALTER TABLE public.blueprint_measurement_objects
  ADD COLUMN IF NOT EXISTS deterministic_key text;
ALTER TABLE public.blueprint_trade_specifications
  ADD COLUMN IF NOT EXISTS deterministic_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bp_plan_path_deterministic
  ON public.blueprint_plan_paths(import_session_id, deterministic_key)
  WHERE deterministic_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bp_measurement_deterministic
  ON public.blueprint_measurement_objects(import_session_id, deterministic_key)
  WHERE deterministic_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bp_trade_spec_deterministic
  ON public.blueprint_trade_specifications(import_session_id, deterministic_key)
  WHERE deterministic_key IS NOT NULL;

NOTIFY pgrst, 'reload schema';
