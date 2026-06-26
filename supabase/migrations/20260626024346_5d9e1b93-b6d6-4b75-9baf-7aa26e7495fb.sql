
-- ===========================================================
-- CENTZ INTEGRATION — Phase 1
-- ===========================================================

CREATE TABLE IF NOT EXISTS public.centz_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  environment text NOT NULL DEFAULT 'stage' CHECK (environment IN ('stage','production')),
  api_access_token text NOT NULL,
  api_version_path text NOT NULL DEFAULT '/api/v3.1',
  agency_external_id text,
  agency_name text,
  site_enterprise_external_id text,
  site_enterprise_centz_id text,
  site_group_external_id text,
  site_group_centz_id text,
  site_external_id text,
  site_centz_id text,
  merchant_id text,
  webhook_url text,
  active boolean NOT NULL DEFAULT true,
  raw_setup_response jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, environment)
);

GRANT SELECT ON public.centz_connections TO authenticated;
GRANT ALL ON public.centz_connections TO service_role;
ALTER TABLE public.centz_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "centz_connections_master_read"
  ON public.centz_connections
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role));

-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.centz_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  pitch_id uuid,
  pipeline_entry_id uuid,
  contact_id uuid,
  site_external_id text,
  site_centz_id text,
  merchant_id text,
  external_id text NOT NULL UNIQUE,
  invoice_number text NOT NULL,
  centz_invoice_id text,
  customer_external_id text,
  customer_first_name text,
  customer_last_name text,
  customer_email text,
  customer_mobile_phone text,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  amount_decimal numeric(12,2) NOT NULL,
  taxes_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  description text,
  customer_memo text,
  internal_memo text,
  invoice_date date,
  due_date date,
  expire_at date,
  purchase_order_number text,
  status text NOT NULL DEFAULT 'draft',
  payment_link text,
  webhook_url text,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  payments jsonb NOT NULL DEFAULT '[]'::jsonb,
  notifications jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_request jsonb,
  raw_response jsonb,
  last_sync_response jsonb,
  last_synced_at timestamptz,
  paid_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_centz_invoices_tenant ON public.centz_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_centz_invoices_pitch ON public.centz_invoices(pitch_id);
CREATE INDEX IF NOT EXISTS idx_centz_invoices_status ON public.centz_invoices(status);

GRANT SELECT ON public.centz_invoices TO authenticated;
GRANT ALL ON public.centz_invoices TO service_role;
ALTER TABLE public.centz_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "centz_invoices_tenant_read"
  ON public.centz_invoices
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.user_id = auth.uid()
        AND uca.tenant_id = centz_invoices.tenant_id
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.tenant_id = centz_invoices.tenant_id OR p.active_tenant_id = centz_invoices.tenant_id)
    )
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.centz_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id text NOT NULL UNIQUE,
  event_type text NOT NULL DEFAULT 'unknown',
  invoice_external_id text,
  invoice_id uuid REFERENCES public.centz_invoices(id) ON DELETE SET NULL,
  payment_status text,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.centz_webhook_events TO service_role;
ALTER TABLE public.centz_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "centz_webhook_events_master_read"
  ON public.centz_webhook_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'master'::app_role));

-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at_centz()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS trg_centz_connections_updated_at ON public.centz_connections;
CREATE TRIGGER trg_centz_connections_updated_at
  BEFORE UPDATE ON public.centz_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_centz();

DROP TRIGGER IF EXISTS trg_centz_invoices_updated_at ON public.centz_invoices;
CREATE TRIGGER trg_centz_invoices_updated_at
  BEFORE UPDATE ON public.centz_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_centz();

NOTIFY pgrst, 'reload schema';
