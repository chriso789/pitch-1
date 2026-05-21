
ALTER TABLE public.scope_compare_results
  ADD COLUMN IF NOT EXISTS included_in_supplement boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS reviewer_status text DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS reviewer_note text;

CREATE INDEX IF NOT EXISTS idx_scope_compare_results_reviewer
  ON public.scope_compare_results(compare_run_id, reviewer_status, included_in_supplement);

ALTER TABLE public.insurance_scope_line_items
  ADD COLUMN IF NOT EXISTS normalized_key text,
  ADD COLUMN IF NOT EXISTS canonical_group text,
  ADD COLUMN IF NOT EXISTS trade_group text,
  ADD COLUMN IF NOT EXISTS action_type text,
  ADD COLUMN IF NOT EXISTS parse_confidence numeric,
  ADD COLUMN IF NOT EXISTS match_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_isli_normalized_key
  ON public.insurance_scope_line_items(document_id, normalized_key);
CREATE INDEX IF NOT EXISTS idx_isli_match_fingerprint
  ON public.insurance_scope_line_items(match_fingerprint);

ALTER TABLE public.supplement_reports
  ADD COLUMN IF NOT EXISTS compare_run_id uuid REFERENCES public.scope_compare_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS report_status text DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS report_title text DEFAULT 'Supplement Scope Difference Report',
  ADD COLUMN IF NOT EXISTS property_address text,
  ADD COLUMN IF NOT EXISTS insured_name text,
  ADD COLUMN IF NOT EXISTS claim_number text,
  ADD COLUMN IF NOT EXISTS carrier_name text,
  ADD COLUMN IF NOT EXISTS contractor_name text,
  ADD COLUMN IF NOT EXISTS carrier_document_id uuid,
  ADD COLUMN IF NOT EXISTS contractor_document_id uuid,
  ADD COLUMN IF NOT EXISTS carrier_total_rcv numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS contractor_total_rcv numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplement_difference_rcv numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS included_items_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS excluded_items_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS missing_items_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quantity_delta_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_delta_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_delta_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_json jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS report_markdown text,
  ADD COLUMN IF NOT EXISTS report_html text,
  ADD COLUMN IF NOT EXISTS report_pdf_storage_path text;

CREATE INDEX IF NOT EXISTS idx_supplement_reports_compare_run
  ON public.supplement_reports(compare_run_id);
CREATE INDEX IF NOT EXISTS idx_supplement_reports_tenant
  ON public.supplement_reports(tenant_id);

CREATE TABLE IF NOT EXISTS public.supplement_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplement_report_id uuid NOT NULL REFERENCES public.supplement_reports(id) ON DELETE CASCADE,
  compare_result_id uuid REFERENCES public.scope_compare_results(id) ON DELETE SET NULL,
  item_order integer DEFAULT 0,
  section text,
  issue_type text NOT NULL,
  severity text DEFAULT 'info',
  included boolean DEFAULT true,
  carrier_description text,
  contractor_description text,
  description_for_report text,
  quantity numeric,
  unit text,
  carrier_quantity numeric,
  contractor_quantity numeric,
  quantity_delta numeric,
  carrier_unit_price numeric,
  contractor_unit_price numeric,
  unit_price_delta numeric,
  carrier_total_rcv numeric,
  contractor_total_rcv numeric,
  total_rcv_delta numeric,
  tax_delta numeric,
  justification_plain text,
  justification_adjuster text,
  justification_contractor text,
  evidence jsonb DEFAULT '{}'::jsonb,
  reviewer_note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplement_report_items_report
  ON public.supplement_report_items(supplement_report_id);
CREATE INDEX IF NOT EXISTS idx_supplement_report_items_tenant
  ON public.supplement_report_items(tenant_id);

ALTER TABLE public.supplement_report_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read supplement_report_items"
  ON public.supplement_report_items FOR SELECT
  USING (tenant_id = public.get_user_active_tenant_id());

CREATE POLICY "Tenant members insert supplement_report_items"
  ON public.supplement_report_items FOR INSERT
  WITH CHECK (tenant_id = public.get_user_active_tenant_id());

CREATE POLICY "Tenant members update supplement_report_items"
  ON public.supplement_report_items FOR UPDATE
  USING (tenant_id = public.get_user_active_tenant_id());

CREATE POLICY "Tenant members delete supplement_report_items"
  ON public.supplement_report_items FOR DELETE
  USING (tenant_id = public.get_user_active_tenant_id());

CREATE TABLE IF NOT EXISTS public.supplement_report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  supplement_report_id uuid NOT NULL REFERENCES public.supplement_reports(id) ON DELETE CASCADE,
  export_type text NOT NULL,
  storage_path text,
  export_json jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplement_report_exports_report
  ON public.supplement_report_exports(supplement_report_id);
CREATE INDEX IF NOT EXISTS idx_supplement_report_exports_tenant
  ON public.supplement_report_exports(tenant_id);

ALTER TABLE public.supplement_report_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read supplement_report_exports"
  ON public.supplement_report_exports FOR SELECT
  USING (tenant_id = public.get_user_active_tenant_id());

CREATE POLICY "Tenant members insert supplement_report_exports"
  ON public.supplement_report_exports FOR INSERT
  WITH CHECK (tenant_id = public.get_user_active_tenant_id());
