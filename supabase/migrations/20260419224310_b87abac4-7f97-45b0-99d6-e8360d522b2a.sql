CREATE TABLE public.tenant_stripe_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  stripe_account_id TEXT NOT NULL UNIQUE,
  account_type TEXT NOT NULL DEFAULT 'express',
  country TEXT DEFAULT 'US',
  default_currency TEXT DEFAULT 'usd',
  charges_enabled BOOLEAN DEFAULT false,
  payouts_enabled BOOLEAN DEFAULT false,
  details_submitted BOOLEAN DEFAULT false,
  onboarding_complete BOOLEAN DEFAULT false,
  requirements_due JSONB DEFAULT '[]'::jsonb,
  requirements_pending JSONB DEFAULT '[]'::jsonb,
  business_profile JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tenant_stripe_accounts_tenant ON public.tenant_stripe_accounts(tenant_id);
CREATE INDEX idx_tenant_stripe_accounts_account ON public.tenant_stripe_accounts(stripe_account_id);

ALTER TABLE public.tenant_stripe_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant billing managers can view stripe account"
  ON public.tenant_stripe_accounts
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'owner'::app_role)
      OR public.has_role(auth.uid(), 'corporate'::app_role)
      OR public.has_role(auth.uid(), 'office_admin'::app_role)
      OR public.has_role(auth.uid(), 'master'::app_role)
    )
  );

CREATE POLICY "Tenant billing managers can insert stripe account"
  ON public.tenant_stripe_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'owner'::app_role)
      OR public.has_role(auth.uid(), 'corporate'::app_role)
      OR public.has_role(auth.uid(), 'office_admin'::app_role)
      OR public.has_role(auth.uid(), 'master'::app_role)
    )
  );

CREATE POLICY "Tenant billing managers can update stripe account"
  ON public.tenant_stripe_accounts
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'owner'::app_role)
      OR public.has_role(auth.uid(), 'corporate'::app_role)
      OR public.has_role(auth.uid(), 'office_admin'::app_role)
      OR public.has_role(auth.uid(), 'master'::app_role)
    )
  );

CREATE TRIGGER update_tenant_stripe_accounts_updated_at
  BEFORE UPDATE ON public.tenant_stripe_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();