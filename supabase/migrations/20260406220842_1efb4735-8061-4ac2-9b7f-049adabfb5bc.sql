
-- Create payment_links table
CREATE TABLE public.payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.project_invoices(id) ON DELETE SET NULL,
  pipeline_entry_id UUID REFERENCES public.pipeline_entries(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
  stripe_payment_link_id TEXT,
  stripe_payment_link_url TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add stripe URL column to project_invoices
ALTER TABLE public.project_invoices 
  ADD COLUMN IF NOT EXISTS stripe_payment_link_url TEXT;

-- Enable RLS
ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view payment links in their tenant
CREATE POLICY "Users can view own tenant payment links"
  ON public.payment_links
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (
    SELECT COALESCE(p.active_tenant_id, p.tenant_id) FROM public.profiles p WHERE p.id = auth.uid()
  ));

-- RLS: Users can insert payment links in their tenant
CREATE POLICY "Users can create payment links"
  ON public.payment_links
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id IN (
    SELECT COALESCE(p.active_tenant_id, p.tenant_id) FROM public.profiles p WHERE p.id = auth.uid()
  ));

-- RLS: Service role full access for webhooks
CREATE POLICY "Service role full access to payment_links"
  ON public.payment_links
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Index for lookups
CREATE INDEX idx_payment_links_tenant_id ON public.payment_links(tenant_id);
CREATE INDEX idx_payment_links_invoice_id ON public.payment_links(invoice_id);
CREATE INDEX idx_payment_links_stripe_id ON public.payment_links(stripe_payment_link_id);
