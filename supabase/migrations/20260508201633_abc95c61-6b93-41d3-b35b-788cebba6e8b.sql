
ALTER TABLE public.project_cost_invoices
  ADD COLUMN IF NOT EXISTS duplicate_of UUID REFERENCES public.project_cost_invoices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_cost_invoices_dupe_lookup
  ON public.project_cost_invoices (tenant_id, lower(coalesce(vendor_name,'')), lower(coalesce(invoice_number,'')))
  WHERE invoice_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.project_cost_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES public.project_cost_invoices(id) ON DELETE CASCADE,
  project_id UUID,
  pipeline_entry_id UUID,
  vendor_name TEXT,
  line_number INTEGER,
  description TEXT NOT NULL,
  normalized_description TEXT,
  quantity NUMERIC,
  unit_price NUMERIC,
  line_total NUMERIC,
  brand TEXT,
  color TEXT,
  style TEXT,
  material_category TEXT,
  unit_of_measure TEXT,
  sku TEXT,
  raw_json JSONB,
  search_text tsvector GENERATED ALWAYS AS (
    to_tsvector('simple',
      coalesce(description,'') || ' ' ||
      coalesce(brand,'') || ' ' ||
      coalesce(color,'') || ' ' ||
      coalesce(style,'') || ' ' ||
      coalesce(material_category,'') || ' ' ||
      coalesce(vendor_name,'')
    )
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pcili_tenant ON public.project_cost_invoice_line_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pcili_invoice ON public.project_cost_invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pcili_project ON public.project_cost_invoice_line_items(project_id);
CREATE INDEX IF NOT EXISTS idx_pcili_color ON public.project_cost_invoice_line_items(tenant_id, lower(color));
CREATE INDEX IF NOT EXISTS idx_pcili_style ON public.project_cost_invoice_line_items(tenant_id, lower(style));
CREATE INDEX IF NOT EXISTS idx_pcili_brand ON public.project_cost_invoice_line_items(tenant_id, lower(brand));
CREATE INDEX IF NOT EXISTS idx_pcili_search ON public.project_cost_invoice_line_items USING GIN(search_text);

ALTER TABLE public.project_cost_invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view invoice line items"
  ON public.project_cost_invoice_line_items FOR SELECT
  USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Tenant members insert invoice line items"
  ON public.project_cost_invoice_line_items FOR INSERT
  WITH CHECK (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Tenant members update invoice line items"
  ON public.project_cost_invoice_line_items FOR UPDATE
  USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE POLICY "Tenant members delete invoice line items"
  ON public.project_cost_invoice_line_items FOR DELETE
  USING (tenant_id IN (SELECT profiles.tenant_id FROM profiles WHERE profiles.id = auth.uid()));

CREATE TRIGGER trg_pcili_updated_at
  BEFORE UPDATE ON public.project_cost_invoice_line_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
