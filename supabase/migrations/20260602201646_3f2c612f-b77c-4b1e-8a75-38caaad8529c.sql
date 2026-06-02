
ALTER TABLE public.abc_connections
  ADD COLUMN IF NOT EXISTS selected_ship_to_number text,
  ADD COLUMN IF NOT EXISTS selected_branch_number text,
  ADD COLUMN IF NOT EXISTS selected_ship_to_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS selected_branch_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_abc_connections_setup_complete
  ON public.abc_connections (tenant_id)
  WHERE setup_completed_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
