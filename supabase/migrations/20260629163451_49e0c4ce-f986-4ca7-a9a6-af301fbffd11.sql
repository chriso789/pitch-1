
CREATE TABLE IF NOT EXISTS public.platform_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'supplier',
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sandbox_mode BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'operational',
  docs_url TEXT,
  notes TEXT,
  connections_table TEXT,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.platform_integrations TO authenticated;
GRANT ALL ON public.platform_integrations TO service_role;

ALTER TABLE public.platform_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Masters can view platform integrations"
  ON public.platform_integrations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'master'));

CREATE POLICY "Masters can insert platform integrations"
  ON public.platform_integrations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'master'));

CREATE POLICY "Masters can update platform integrations"
  ON public.platform_integrations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'master'))
  WITH CHECK (public.has_role(auth.uid(), 'master'));

CREATE POLICY "Masters can delete platform integrations"
  ON public.platform_integrations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'master'));

CREATE TRIGGER trg_platform_integrations_updated
  BEFORE UPDATE ON public.platform_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.platform_integrations (slug, name, category, description, enabled, sandbox_mode, status, connections_table, docs_url)
VALUES
  ('abc_supply',  'ABC Supply',        'supplier',   'Roofing & exterior building products — orders, pricing, webhooks.', true, false, 'operational', 'abc_connections', 'https://www.abcsupply.com'),
  ('srs',         'SRS Distribution',  'supplier',   'Roofing distributor — orders, invoices, webhook events.',          true, false, 'operational', 'srs_connections', 'https://www.srsdistribution.com'),
  ('quickbooks',  'QuickBooks Online', 'accounting', 'Customers, invoices, payments, sync errors.',                       true, false, 'operational', 'qbo_connections', 'https://developer.intuit.com/'),
  ('centz',       'Centz Payments',    'payments',   'Centz card-fee processor — per-tenant connection.',                 true, false, 'operational', 'centz_connections', 'https://centz.com')
ON CONFLICT (slug) DO NOTHING;
