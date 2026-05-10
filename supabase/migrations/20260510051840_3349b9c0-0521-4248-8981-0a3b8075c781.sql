
CREATE TABLE public.scraped_invoice_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'billtrust_invoice_central',
  external_id TEXT,
  vendor_name TEXT NOT NULL,
  invoice_number TEXT,
  invoice_date DATE,
  total_amount NUMERIC(12,2),
  subtotal NUMERIC(12,2),
  tax_amount NUMERIC(12,2),
  po_number TEXT,
  ship_to_address TEXT,
  ship_to_city TEXT,
  ship_to_state TEXT,
  ship_to_zip TEXT,
  line_items JSONB DEFAULT '[]'::jsonb,
  pdf_storage_path TEXT,
  pdf_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','attached','dismissed','duplicate','error')),
  suggestions JSONB DEFAULT '[]'::jsonb,
  attached_project_cost_invoice_id UUID REFERENCES public.project_cost_invoices(id) ON DELETE SET NULL,
  attached_project_id UUID,
  attached_by UUID,
  attached_at TIMESTAMPTZ,
  dismissed_by UUID,
  dismissed_at TIMESTAMPTZ,
  dismissed_reason TEXT,
  raw_payload JSONB,
  scraped_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source, external_id)
);

CREATE INDEX idx_scraped_invoice_inbox_tenant_status ON public.scraped_invoice_inbox(tenant_id, status, scraped_at DESC);
CREATE INDEX idx_scraped_invoice_inbox_po ON public.scraped_invoice_inbox(tenant_id, po_number) WHERE po_number IS NOT NULL;

ALTER TABLE public.scraped_invoice_inbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view inbox"
  ON public.scraped_invoice_inbox FOR SELECT
  USING (tenant_id = public.get_user_active_tenant_id());

CREATE POLICY "Tenant members can update inbox"
  ON public.scraped_invoice_inbox FOR UPDATE
  USING (tenant_id = public.get_user_active_tenant_id());

CREATE POLICY "Tenant managers can delete inbox"
  ON public.scraped_invoice_inbox FOR DELETE
  USING (
    tenant_id = public.get_user_active_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
      AND p.role IN ('master','owner','corporate','office_admin','regional_manager','sales_manager')
    )
  );

CREATE TRIGGER trg_scraped_invoice_inbox_updated_at
  BEFORE UPDATE ON public.scraped_invoice_inbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public)
VALUES ('scraped-invoices', 'scraped-invoices', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Tenant members read scraped invoices"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'scraped-invoices'
    AND (storage.foldername(name))[1] = public.get_user_active_tenant_id()::text
  );
