
CREATE TABLE public.inspection_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  service_type TEXT NOT NULL CHECK (service_type IN ('four_point','wind_mitigation','combo')),
  price_cents INTEGER NOT NULL DEFAULT 20000,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  year_built TEXT,
  insurance_company TEXT,
  notes TEXT,
  source TEXT DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','scheduled','completed','canceled','refunded')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded','failed')),
  payment_provider TEXT CHECK (payment_provider IN ('stripe','centz')),
  payment_link TEXT,
  payment_ref TEXT,
  amount_paid_cents INTEGER,
  paid_at TIMESTAMPTZ,
  scheduled_at TIMESTAMPTZ,
  assigned_to UUID,
  contact_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX inspection_requests_tenant_created_idx ON public.inspection_requests(tenant_id, created_at DESC);
CREATE INDEX inspection_requests_status_idx ON public.inspection_requests(tenant_id, status);
CREATE INDEX inspection_requests_payment_ref_idx ON public.inspection_requests(payment_ref);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_requests TO authenticated;
GRANT ALL ON public.inspection_requests TO service_role;

ALTER TABLE public.inspection_requests ENABLE ROW LEVEL SECURITY;

-- Staff of the tenant can view/update/delete
CREATE POLICY "Tenant staff can view inspection requests"
  ON public.inspection_requests FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT p.active_tenant_id FROM public.profiles p WHERE p.id = auth.uid()
      UNION
      SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
      UNION
      SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()
    )
  );

CREATE POLICY "Tenant staff can update inspection requests"
  ON public.inspection_requests FOR UPDATE TO authenticated
  USING (
    tenant_id IN (
      SELECT p.active_tenant_id FROM public.profiles p WHERE p.id = auth.uid()
      UNION
      SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
      UNION
      SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()
    )
  );

CREATE POLICY "Tenant staff can delete inspection requests"
  ON public.inspection_requests FOR DELETE TO authenticated
  USING (
    tenant_id IN (
      SELECT p.active_tenant_id FROM public.profiles p WHERE p.id = auth.uid()
      UNION
      SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
      UNION
      SELECT uca.tenant_id FROM public.user_company_access uca WHERE uca.user_id = auth.uid()
    )
  );

-- Inserts happen server-side via the public edge function using the service role,
-- so no anon INSERT policy is needed.

CREATE TRIGGER inspection_requests_updated_at
  BEFORE UPDATE ON public.inspection_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
