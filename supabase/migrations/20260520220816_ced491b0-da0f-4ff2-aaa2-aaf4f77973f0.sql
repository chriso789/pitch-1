-- 1. Expand delivery_method enum to preserve real shipping choice
ALTER TABLE public.srs_orders DROP CONSTRAINT IF EXISTS srs_orders_delivery_method_check;
ALTER TABLE public.srs_orders
  ADD CONSTRAINT srs_orders_delivery_method_check
  CHECK (delivery_method IN ('pickup', 'delivery', 'roof_load', 'ground_drop'));

-- Backfill prior rows where we lost the original choice in `notes`
UPDATE public.srs_orders
SET delivery_method = CASE
  WHEN notes ILIKE '%Roof Load%' THEN 'roof_load'
  WHEN notes ILIKE '%Ground Drop%' THEN 'ground_drop'
  ELSE delivery_method
END
WHERE delivery_method = 'delivery'
  AND notes IS NOT NULL
  AND (notes ILIKE '%Roof Load%' OR notes ILIKE '%Ground Drop%');

-- 2. Submit audit table — captures full request + response for every SRS submit
CREATE TABLE IF NOT EXISTS public.srs_submit_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.srs_orders(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  transaction_id text,
  request_json jsonb NOT NULL,
  response_json jsonb,
  success boolean NOT NULL DEFAULT false,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_srs_submit_audit_order
  ON public.srs_submit_audit(order_id);
CREATE INDEX IF NOT EXISTS idx_srs_submit_audit_tenant
  ON public.srs_submit_audit(tenant_id, created_at DESC);

ALTER TABLE public.srs_submit_audit ENABLE ROW LEVEL SECURITY;

-- Read policy: tenant members can view their own audit rows
CREATE POLICY "srs_submit_audit_select_tenant"
  ON public.srs_submit_audit
  FOR SELECT
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- Writes happen from edge functions via service role (bypasses RLS)
