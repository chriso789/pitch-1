
ALTER TABLE public.abc_orders
  ADD COLUMN IF NOT EXISTS environment TEXT,
  ADD COLUMN IF NOT EXISTS payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS pricing_run_id TEXT,
  ADD COLUMN IF NOT EXISTS mapping_snapshot JSONB DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS abc_orders_tenant_env_idempotency_uniq
  ON public.abc_orders (tenant_id, environment, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.abc_order_lines
  ADD COLUMN IF NOT EXISTS approved_mapping_id TEXT,
  ADD COLUMN IF NOT EXISTS approved_pricing_run_id TEXT,
  ADD COLUMN IF NOT EXISTS line_proof JSONB DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
