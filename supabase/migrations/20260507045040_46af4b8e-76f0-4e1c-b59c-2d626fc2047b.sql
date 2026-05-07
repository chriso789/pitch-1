
-- ========================================
-- A. material_suppliers
-- ========================================
CREATE TABLE public.material_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  supplier_name text NOT NULL,
  normalized_name text NOT NULL,
  supplier_code text,
  aliases text[] DEFAULT '{}',
  account_number text,
  status text DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id, normalized_name)
);

ALTER TABLE public.material_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.material_suppliers
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

-- ========================================
-- B. supplier_price_lists
-- ========================================
CREATE TABLE public.supplier_price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES public.material_suppliers(id) ON DELETE CASCADE,
  list_name text NOT NULL,
  source_file_url text,
  source_file_name text,
  imported_by uuid,
  effective_start_date date NOT NULL,
  effective_end_date date,
  status text DEFAULT 'active',
  notes text,
  raw_import_json jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.supplier_price_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.supplier_price_lists
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

CREATE INDEX idx_spl_supplier ON public.supplier_price_lists(company_id, supplier_id, status);

-- ========================================
-- C. supplier_price_list_items
-- ========================================
CREATE TABLE public.supplier_price_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  price_list_id uuid NOT NULL REFERENCES public.supplier_price_lists(id) ON DELETE CASCADE,
  supplier_sku text,
  manufacturer_sku text,
  item_description text NOT NULL,
  normalized_description text NOT NULL,
  category text,
  brand text,
  material_type text,
  unit_of_measure text NOT NULL,
  agreed_unit_price numeric(12,4) NOT NULL,
  agreed_price_basis text DEFAULT 'unit',
  tax_included boolean DEFAULT false,
  delivery_included boolean DEFAULT false,
  waste_factor_allowed numeric(8,4),
  min_qty numeric(12,4),
  max_qty numeric(12,4),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.supplier_price_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.supplier_price_list_items
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

CREATE INDEX idx_spli_lookup ON public.supplier_price_list_items(company_id, supplier_id, price_list_id);
CREATE INDEX idx_spli_norm_desc ON public.supplier_price_list_items(normalized_description);
CREATE INDEX idx_spli_supplier_sku ON public.supplier_price_list_items(supplier_sku);
CREATE INDEX idx_spli_mfr_sku ON public.supplier_price_list_items(manufacturer_sku);

-- ========================================
-- D. material_invoice_documents
-- ========================================
CREATE TABLE public.material_invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  supplier_id uuid REFERENCES public.material_suppliers(id),
  job_id uuid,
  uploaded_by uuid,
  source_file_url text,
  source_file_name text,
  supplier_detected_name text,
  supplier_confidence numeric(5,4),
  invoice_number text,
  invoice_date date,
  po_number text,
  order_number text,
  delivery_ticket_number text,
  account_number text,
  subtotal numeric(12,2),
  tax_total numeric(12,2),
  delivery_total numeric(12,2),
  invoice_total numeric(12,2),
  scrape_status text DEFAULT 'pending',
  audit_status text DEFAULT 'not_audited',
  raw_extraction_json jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.material_invoice_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.material_invoice_documents
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

-- ========================================
-- E. material_invoice_line_items
-- ========================================
CREATE TABLE public.material_invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  invoice_document_id uuid NOT NULL REFERENCES public.material_invoice_documents(id) ON DELETE CASCADE,
  supplier_id uuid,
  job_id uuid,
  line_number integer,
  supplier_sku text,
  manufacturer_sku text,
  item_description text NOT NULL,
  normalized_description text NOT NULL,
  category text,
  brand text,
  unit_of_measure text,
  quantity numeric(12,4) NOT NULL DEFAULT 0,
  charged_unit_price numeric(12,4),
  charged_extended_price numeric(12,2),
  tax_amount numeric(12,2),
  delivery_amount numeric(12,2),
  discount_amount numeric(12,2),
  raw_line_json jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.material_invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.material_invoice_line_items
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

-- ========================================
-- F. material_item_match_rules
-- ========================================
CREATE TABLE public.material_item_match_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  supplier_sku text,
  manufacturer_sku text,
  normalized_invoice_description text,
  price_list_item_id uuid REFERENCES public.supplier_price_list_items(id),
  match_priority integer DEFAULT 100,
  confidence numeric(5,4) DEFAULT 1,
  created_by uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.material_item_match_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.material_item_match_rules
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

-- ========================================
-- G. material_invoice_audits
-- ========================================
CREATE TABLE public.material_invoice_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  invoice_document_id uuid NOT NULL REFERENCES public.material_invoice_documents(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL,
  price_list_id uuid REFERENCES public.supplier_price_lists(id),
  audit_run_by uuid,
  invoice_date date,
  audit_status text NOT NULL,
  total_invoice_lines integer DEFAULT 0,
  matched_lines integer DEFAULT 0,
  unmatched_lines integer DEFAULT 0,
  overcharged_lines integer DEFAULT 0,
  undercharged_lines integer DEFAULT 0,
  total_expected_amount numeric(12,2) DEFAULT 0,
  total_actual_amount numeric(12,2) DEFAULT 0,
  total_overcharge_amount numeric(12,2) DEFAULT 0,
  total_undercharge_amount numeric(12,2) DEFAULT 0,
  report_file_url text,
  csv_file_url text,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.material_invoice_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.material_invoice_audits
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

-- ========================================
-- H. material_invoice_audit_lines
-- ========================================
CREATE TABLE public.material_invoice_audit_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  audit_id uuid NOT NULL REFERENCES public.material_invoice_audits(id) ON DELETE CASCADE,
  invoice_document_id uuid NOT NULL,
  invoice_line_item_id uuid REFERENCES public.material_invoice_line_items(id),
  supplier_id uuid NOT NULL,
  price_list_id uuid,
  price_list_item_id uuid,
  match_type text NOT NULL,
  match_confidence numeric(5,4),
  invoice_description text NOT NULL,
  agreed_description text,
  supplier_sku text,
  agreed_supplier_sku text,
  invoice_uom text,
  agreed_uom text,
  quantity numeric(12,4) NOT NULL,
  charged_unit_price numeric(12,4),
  agreed_unit_price numeric(12,4),
  charged_extended_price numeric(12,2),
  expected_extended_price numeric(12,2),
  price_difference_per_unit numeric(12,4),
  total_difference numeric(12,2),
  discrepancy_type text NOT NULL,
  discrepancy_status text DEFAULT 'open',
  review_note text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.material_invoice_audit_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.material_invoice_audit_lines
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

-- ========================================
-- I. material_supplier_credit_claims
-- ========================================
CREATE TABLE public.material_supplier_credit_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  supplier_id uuid NOT NULL,
  audit_id uuid REFERENCES public.material_invoice_audits(id),
  claim_number text,
  claim_status text DEFAULT 'draft',
  total_claim_amount numeric(12,2) DEFAULT 0,
  submitted_at timestamptz,
  submitted_to text,
  email_subject text,
  email_body text,
  report_file_url text,
  csv_file_url text,
  supplier_response text,
  credit_received_amount numeric(12,2) DEFAULT 0,
  credit_received_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.material_supplier_credit_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.material_supplier_credit_claims
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

-- ========================================
-- J. material_price_audit_events
-- ========================================
CREATE TABLE public.material_price_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  supplier_id uuid,
  invoice_document_id uuid,
  audit_id uuid,
  event_type text NOT NULL,
  event_message text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_by uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.material_price_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "company_isolation" ON public.material_price_audit_events
  FOR ALL USING (
    company_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid())
  );

-- ========================================
-- Helper Functions
-- ========================================

CREATE OR REPLACE FUNCTION public.normalize_supplier_name(input text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  result text;
BEGIN
  result := lower(trim(input));
  result := regexp_replace(result, '[^a-z0-9 ]', '', 'g');
  result := regexp_replace(result, '\s+', ' ', 'g');
  result := regexp_replace(result, '\s*(co|inc|llc|ltd|corp|company|distribution|dist|supply)\s*', ' ', 'g');
  result := trim(result);
  IF result LIKE '%abc%' THEN RETURN 'abc supply'; END IF;
  IF result LIKE '%srs%' THEN RETURN 'srs'; END IF;
  IF result LIKE '%qxo%' THEN RETURN 'qxo'; END IF;
  IF result LIKE '%beacon%' THEN RETURN 'beacon'; END IF;
  IF result LIKE '%gulfeagle%' OR result LIKE '%gulf eagle%' THEN RETURN 'gulfeagle'; END IF;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_material_description(input text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  result text;
BEGIN
  result := lower(trim(input));
  result := regexp_replace(result, '[^a-z0-9 /.\-]', '', 'g');
  result := regexp_replace(result, '\s+', ' ', 'g');
  result := regexp_replace(result, '(\d+)\s*-\s*(\d+)/(\d+)', '\1.\2', 'g');
  result := regexp_replace(result, '(\d+)\s+(\d+)/(\d+)', '\1.\2', 'g');
  result := trim(result);
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_supplier_price_list(
  p_company_id uuid,
  p_supplier_id uuid,
  p_invoice_date date
)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result_id uuid;
BEGIN
  SELECT id INTO result_id
  FROM public.supplier_price_lists
  WHERE company_id = p_company_id
    AND supplier_id = p_supplier_id
    AND status = 'active'
    AND effective_start_date <= p_invoice_date
    AND (effective_end_date IS NULL OR effective_end_date >= p_invoice_date)
  ORDER BY effective_start_date DESC
  LIMIT 1;
  RETURN result_id;
END;
$$;

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.update_material_audit_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_material_suppliers_updated BEFORE UPDATE ON public.material_suppliers FOR EACH ROW EXECUTE FUNCTION public.update_material_audit_updated_at();
CREATE TRIGGER trg_supplier_price_lists_updated BEFORE UPDATE ON public.supplier_price_lists FOR EACH ROW EXECUTE FUNCTION public.update_material_audit_updated_at();
CREATE TRIGGER trg_supplier_price_list_items_updated BEFORE UPDATE ON public.supplier_price_list_items FOR EACH ROW EXECUTE FUNCTION public.update_material_audit_updated_at();
CREATE TRIGGER trg_material_invoice_documents_updated BEFORE UPDATE ON public.material_invoice_documents FOR EACH ROW EXECUTE FUNCTION public.update_material_audit_updated_at();
CREATE TRIGGER trg_material_invoice_line_items_updated BEFORE UPDATE ON public.material_invoice_line_items FOR EACH ROW EXECUTE FUNCTION public.update_material_audit_updated_at();
CREATE TRIGGER trg_material_item_match_rules_updated BEFORE UPDATE ON public.material_item_match_rules FOR EACH ROW EXECUTE FUNCTION public.update_material_audit_updated_at();
CREATE TRIGGER trg_material_supplier_credit_claims_updated BEFORE UPDATE ON public.material_supplier_credit_claims FOR EACH ROW EXECUTE FUNCTION public.update_material_audit_updated_at();
