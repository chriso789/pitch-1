
-- supplier_bills
CREATE TABLE IF NOT EXISTS public.supplier_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  extraction_id uuid REFERENCES public.ai_document_extractions(id) ON DELETE SET NULL,
  pipeline_entry_id uuid,
  job_id uuid,
  contact_id uuid,
  supplier_name text,
  supplier_account_number text,
  invoice_number text,
  invoice_date date,
  due_date date,
  job_name text,
  job_address text,
  subtotal numeric,
  tax numeric,
  total numeric,
  balance_due numeric,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','needs_review','approved','rejected','exported','paid','void')),
  source text NOT NULL DEFAULT 'document_extraction',
  duplicate_of uuid REFERENCES public.supplier_bills(id) ON DELETE SET NULL,
  review_status text NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review','approved','rejected','duplicate','conflict')),
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_provider text,
  external_id text,
  export_status text NOT NULL DEFAULT 'not_exported',
  export_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_bills TO authenticated;
GRANT ALL ON public.supplier_bills TO service_role;

ALTER TABLE public.supplier_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_bills tenant select"
  ON public.supplier_bills FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "supplier_bills tenant insert"
  ON public.supplier_bills FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "supplier_bills tenant update"
  ON public.supplier_bills FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "supplier_bills tenant delete"
  ON public.supplier_bills FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_supplier_bills_tenant ON public.supplier_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_document ON public.supplier_bills(document_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_extraction ON public.supplier_bills(extraction_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_pipeline ON public.supplier_bills(pipeline_entry_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_job ON public.supplier_bills(job_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_supplier ON public.supplier_bills(supplier_name);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_invoice_no ON public.supplier_bills(invoice_number);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_invoice_date ON public.supplier_bills(invoice_date);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_status ON public.supplier_bills(status);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_review_status ON public.supplier_bills(review_status);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_duplicate_of ON public.supplier_bills(duplicate_of);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_bills_tenant_supplier_invoice
  ON public.supplier_bills (tenant_id, lower(supplier_name), invoice_number)
  WHERE invoice_number IS NOT NULL AND duplicate_of IS NULL;

CREATE OR REPLACE FUNCTION public.set_updated_at_supplier_bills()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_bills_updated_at ON public.supplier_bills;
CREATE TRIGGER trg_supplier_bills_updated_at BEFORE UPDATE ON public.supplier_bills
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_supplier_bills();

-- supplier_bill_lines
CREATE TABLE IF NOT EXISTS public.supplier_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplier_bill_id uuid NOT NULL REFERENCES public.supplier_bills(id) ON DELETE CASCADE,
  line_number int,
  sku text,
  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  total_price numeric,
  material_category text,
  mapped_catalog_item_id uuid,
  cost_code text,
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_bill_lines TO authenticated;
GRANT ALL ON public.supplier_bill_lines TO service_role;

ALTER TABLE public.supplier_bill_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "supplier_bill_lines tenant select"
  ON public.supplier_bill_lines FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "supplier_bill_lines tenant insert"
  ON public.supplier_bill_lines FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "supplier_bill_lines tenant update"
  ON public.supplier_bill_lines FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE POLICY "supplier_bill_lines tenant delete"
  ON public.supplier_bill_lines FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    OR public.has_role(auth.uid(), 'master'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_tenant ON public.supplier_bill_lines(tenant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_bill ON public.supplier_bill_lines(supplier_bill_id);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_sku ON public.supplier_bill_lines(sku);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_category ON public.supplier_bill_lines(material_category);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_cost_code ON public.supplier_bill_lines(cost_code);
CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_catalog ON public.supplier_bill_lines(mapped_catalog_item_id);

NOTIFY pgrst, 'reload schema';
