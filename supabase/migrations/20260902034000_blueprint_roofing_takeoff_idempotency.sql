-- Deterministic keys for trade-engine reruns. Existing rows remain valid because
-- PostgreSQL UNIQUE constraints allow multiple NULL deterministic_key values.
-- Automatic blueprint takeoff rows always populate deterministic_key.

ALTER TABLE public.blueprint_plan_paths
  ADD COLUMN IF NOT EXISTS deterministic_key text;
ALTER TABLE public.blueprint_measurement_objects
  ADD COLUMN IF NOT EXISTS deterministic_key text;
ALTER TABLE public.blueprint_trade_specifications
  ADD COLUMN IF NOT EXISTS deterministic_key text;

DO $$ BEGIN
  ALTER TABLE public.blueprint_plan_paths
    ADD CONSTRAINT uq_bp_plan_path_deterministic UNIQUE (import_session_id, deterministic_key);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.blueprint_measurement_objects
    ADD CONSTRAINT uq_bp_measurement_deterministic UNIQUE (import_session_id, deterministic_key);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.blueprint_trade_specifications
    ADD CONSTRAINT uq_bp_trade_spec_deterministic UNIQUE (import_session_id, deterministic_key);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

NOTIFY pgrst, 'reload schema';
