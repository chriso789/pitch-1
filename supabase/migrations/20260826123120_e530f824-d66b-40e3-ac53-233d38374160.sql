ALTER TABLE public.pipeline_stages
  ADD COLUMN IF NOT EXISTS is_payout_point boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_stages_one_payout_point_per_tenant
  ON public.pipeline_stages (tenant_id)
  WHERE is_payout_point;

NOTIFY pgrst, 'reload schema';