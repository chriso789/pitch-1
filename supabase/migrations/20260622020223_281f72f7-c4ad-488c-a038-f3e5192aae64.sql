
-- 1. New audit table for referral subscription transitions
CREATE TABLE IF NOT EXISTS public.crm_referral_subscription_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id uuid REFERENCES public.crm_referral_company_signups(id) ON DELETE SET NULL,
  tenant_id uuid,
  company_id uuid,
  previous_status text,
  next_status text,
  stripe_event_id text,
  stripe_event_type text,
  source text NOT NULL DEFAULT 'stripe_webhook',
  paid_amount numeric,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.crm_referral_subscription_history TO authenticated;
GRANT ALL ON public.crm_referral_subscription_history TO service_role;

ALTER TABLE public.crm_referral_subscription_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members can read referral subscription history"
  ON public.crm_referral_subscription_history;
CREATE POLICY "Tenant members can read referral subscription history"
  ON public.crm_referral_subscription_history
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid()
        AND uca.tenant_id = crm_referral_subscription_history.tenant_id
        AND uca.is_active = true
    )
    OR public.has_role(auth.uid(), 'master'::public.app_role)
  );

CREATE INDEX IF NOT EXISTS idx_crm_ref_sub_hist_signup
  ON public.crm_referral_subscription_history(signup_id);
CREATE INDEX IF NOT EXISTS idx_crm_ref_sub_hist_tenant_created
  ON public.crm_referral_subscription_history(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_ref_sub_hist_stripe_event
  ON public.crm_referral_subscription_history(stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- 2. Resolution columns on stripe_webhook_events
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS related_company_id uuid,
  ADD COLUMN IF NOT EXISTS related_subscription_id text,
  ADD COLUMN IF NOT EXISTS related_signup_id uuid;

-- 3. Fast lookup indexes on tenants for the webhook resolution chain
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer
  ON public.tenants(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_subscription
  ON public.tenants(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
