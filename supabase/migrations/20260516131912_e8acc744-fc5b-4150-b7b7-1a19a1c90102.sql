
ALTER TABLE public.insurance_scope_line_items
  ADD COLUMN IF NOT EXISTS remove_price numeric,
  ADD COLUMN IF NOT EXISTS replace_price numeric,
  ADD COLUMN IF NOT EXISTS effective_unit_price numeric,
  ADD COLUMN IF NOT EXISTS parser_layout text;

CREATE TABLE IF NOT EXISTS public.scope_compare_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NULL,
  claim_id uuid NULL,
  carrier_document_id uuid NOT NULL,
  contractor_document_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  carrier_total_rcv numeric DEFAULT 0,
  contractor_total_rcv numeric DEFAULT 0,
  total_difference_rcv numeric DEFAULT 0,
  carrier_total_tax numeric DEFAULT 0,
  contractor_total_tax numeric DEFAULT 0,
  tax_difference numeric DEFAULT 0,
  carrier_line_count integer DEFAULT 0,
  contractor_line_count integer DEFAULT 0,
  matched_count integer DEFAULT 0,
  missing_from_carrier_count integer DEFAULT 0,
  missing_from_contractor_count integer DEFAULT 0,
  quantity_delta_count integer DEFAULT 0,
  price_delta_count integer DEFAULT 0,
  analysis_json jsonb DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scope_compare_runs_tenant ON public.scope_compare_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scope_compare_runs_job ON public.scope_compare_runs(job_id);
CREATE INDEX IF NOT EXISTS idx_scope_compare_runs_claim ON public.scope_compare_runs(claim_id);

ALTER TABLE public.scope_compare_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scope_compare_runs_select" ON public.scope_compare_runs FOR SELECT USING (tenant_id = get_user_active_tenant_id());
CREATE POLICY "scope_compare_runs_insert" ON public.scope_compare_runs FOR INSERT WITH CHECK (tenant_id = get_user_active_tenant_id());
CREATE POLICY "scope_compare_runs_update" ON public.scope_compare_runs FOR UPDATE USING (tenant_id = get_user_active_tenant_id()) WITH CHECK (tenant_id = get_user_active_tenant_id());
CREATE POLICY "scope_compare_runs_delete" ON public.scope_compare_runs FOR DELETE USING (tenant_id = get_user_active_tenant_id());

CREATE TABLE IF NOT EXISTS public.scope_compare_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compare_run_id uuid NOT NULL REFERENCES public.scope_compare_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  result_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  carrier_line_item_id uuid NULL,
  contractor_line_item_id uuid NULL,
  carrier_description text NULL,
  contractor_description text NULL,
  normalized_key text NULL,
  canonical_group text NULL,
  carrier_quantity numeric NULL,
  contractor_quantity numeric NULL,
  quantity_delta numeric NULL,
  unit text NULL,
  carrier_unit_price numeric NULL,
  contractor_unit_price numeric NULL,
  unit_price_delta numeric NULL,
  carrier_tax numeric NULL,
  contractor_tax numeric NULL,
  tax_delta numeric NULL,
  carrier_total_rcv numeric NULL,
  contractor_total_rcv numeric NULL,
  total_rcv_delta numeric NULL,
  carrier_total_acv numeric NULL,
  contractor_total_acv numeric NULL,
  total_acv_delta numeric NULL,
  match_confidence numeric DEFAULT 0,
  match_method text NULL,
  evidence jsonb DEFAULT '{}'::jsonb,
  explanation text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scope_compare_results_run ON public.scope_compare_results(compare_run_id);
CREATE INDEX IF NOT EXISTS idx_scope_compare_results_tenant ON public.scope_compare_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scope_compare_results_type ON public.scope_compare_results(result_type);

ALTER TABLE public.scope_compare_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scope_compare_results_select" ON public.scope_compare_results FOR SELECT USING (tenant_id = get_user_active_tenant_id());
CREATE POLICY "scope_compare_results_insert" ON public.scope_compare_results FOR INSERT WITH CHECK (tenant_id = get_user_active_tenant_id());
CREATE POLICY "scope_compare_results_update" ON public.scope_compare_results FOR UPDATE USING (tenant_id = get_user_active_tenant_id()) WITH CHECK (tenant_id = get_user_active_tenant_id());
CREATE POLICY "scope_compare_results_delete" ON public.scope_compare_results FOR DELETE USING (tenant_id = get_user_active_tenant_id());

CREATE TABLE IF NOT EXISTS public.scope_parse_debug_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  document_id uuid NOT NULL,
  page_number integer NULL,
  raw_line text NOT NULL,
  parser_layout text NULL,
  parsed_json jsonb DEFAULT '{}'::jsonb,
  accepted boolean DEFAULT false,
  rejection_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scope_parse_debug_doc ON public.scope_parse_debug_rows(document_id);
CREATE INDEX IF NOT EXISTS idx_scope_parse_debug_tenant ON public.scope_parse_debug_rows(tenant_id);

ALTER TABLE public.scope_parse_debug_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scope_parse_debug_select" ON public.scope_parse_debug_rows FOR SELECT USING (tenant_id = get_user_active_tenant_id());
CREATE POLICY "scope_parse_debug_insert" ON public.scope_parse_debug_rows FOR INSERT WITH CHECK (tenant_id = get_user_active_tenant_id());
CREATE POLICY "scope_parse_debug_delete" ON public.scope_parse_debug_rows FOR DELETE USING (tenant_id = get_user_active_tenant_id());

CREATE OR REPLACE FUNCTION public.touch_scope_compare_runs()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_scope_compare_runs ON public.scope_compare_runs;
CREATE TRIGGER trg_touch_scope_compare_runs
  BEFORE UPDATE ON public.scope_compare_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_scope_compare_runs();
