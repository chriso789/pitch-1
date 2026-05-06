ALTER TABLE public.roof_measurements
  ADD COLUMN IF NOT EXISTS geometry_source text DEFAULT 'heuristic_estimate',
  ADD COLUMN IF NOT EXISTS dsm_contract_debug jsonb;