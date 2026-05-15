
ALTER TABLE public.insurance_scope_documents
  DROP CONSTRAINT IF EXISTS insurance_scope_documents_document_type_check;
ALTER TABLE public.insurance_scope_documents
  ADD CONSTRAINT insurance_scope_documents_document_type_check
  CHECK (document_type IN ('estimate','supplement','denial','policy','reinspection','final_settlement','company_scope'));

CREATE TABLE public.scope_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID,
  job_id UUID,
  carrier_document_id UUID NOT NULL REFERENCES public.insurance_scope_documents(id) ON DELETE CASCADE,
  company_document_id UUID NOT NULL REFERENCES public.insurance_scope_documents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','sent','approved','denied','partial')),
  carrier_total_rcv NUMERIC(12,2) DEFAULT 0,
  company_total_rcv NUMERIC(12,2) DEFAULT 0,
  net_supplement_amount NUMERIC(12,2) DEFAULT 0,
  added_count INTEGER DEFAULT 0,
  removed_count INTEGER DEFAULT 0,
  qty_change_count INTEGER DEFAULT 0,
  price_change_count INTEGER DEFAULT 0,
  totals_json JSONB DEFAULT '{}'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scope_comparisons_tenant ON public.scope_comparisons(tenant_id);
CREATE INDEX idx_scope_comparisons_project ON public.scope_comparisons(project_id);
CREATE INDEX idx_scope_comparisons_job ON public.scope_comparisons(job_id);
ALTER TABLE public.scope_comparisons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_select_scope_comparisons" ON public.scope_comparisons FOR SELECT USING (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_insert_scope_comparisons" ON public.scope_comparisons FOR INSERT WITH CHECK (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_update_scope_comparisons" ON public.scope_comparisons FOR UPDATE USING (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_delete_scope_comparisons" ON public.scope_comparisons FOR DELETE USING (tenant_id = public.get_user_active_tenant_id());

CREATE TABLE public.scope_comparison_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id UUID NOT NULL REFERENCES public.scope_comparisons(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('added','removed','qty_change','price_change','unchanged')),
  category TEXT,
  canonical_item_id UUID REFERENCES public.insurance_canonical_items(id),
  match_method TEXT,
  carrier_line_id UUID REFERENCES public.insurance_scope_line_items(id) ON DELETE SET NULL,
  carrier_code TEXT,
  carrier_description TEXT,
  carrier_quantity NUMERIC(12,4),
  carrier_unit TEXT,
  carrier_unit_price NUMERIC(12,4),
  carrier_total_rcv NUMERIC(12,2),
  company_line_id UUID REFERENCES public.insurance_scope_line_items(id) ON DELETE SET NULL,
  company_code TEXT,
  company_description TEXT,
  company_quantity NUMERIC(12,4),
  company_unit TEXT,
  company_unit_price NUMERIC(12,4),
  company_total_rcv NUMERIC(12,2),
  delta_quantity NUMERIC(12,4),
  delta_unit_price NUMERIC(12,4),
  delta_rcv NUMERIC(12,2),
  delta_percent NUMERIC(8,4),
  justification TEXT,
  approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scope_comparison_lines_comparison ON public.scope_comparison_lines(comparison_id);
CREATE INDEX idx_scope_comparison_lines_tenant ON public.scope_comparison_lines(tenant_id);
CREATE INDEX idx_scope_comparison_lines_change_type ON public.scope_comparison_lines(change_type);
ALTER TABLE public.scope_comparison_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_select_comparison_lines" ON public.scope_comparison_lines FOR SELECT USING (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_insert_comparison_lines" ON public.scope_comparison_lines FOR INSERT WITH CHECK (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_update_comparison_lines" ON public.scope_comparison_lines FOR UPDATE USING (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_delete_comparison_lines" ON public.scope_comparison_lines FOR DELETE USING (tenant_id = public.get_user_active_tenant_id());

CREATE TABLE public.supplement_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  comparison_id UUID NOT NULL REFERENCES public.scope_comparisons(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  pdf_url TEXT,
  pdf_storage_path TEXT,
  esx_url TEXT,
  esx_storage_path TEXT,
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','sent','approved','denied','partial')),
  sent_at TIMESTAMPTZ,
  sent_to TEXT,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplement_reports_tenant ON public.supplement_reports(tenant_id);
CREATE INDEX idx_supplement_reports_comparison ON public.supplement_reports(comparison_id);
ALTER TABLE public.supplement_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_select_supplement_reports" ON public.supplement_reports FOR SELECT USING (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_insert_supplement_reports" ON public.supplement_reports FOR INSERT WITH CHECK (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_update_supplement_reports" ON public.supplement_reports FOR UPDATE USING (tenant_id = public.get_user_active_tenant_id());
CREATE POLICY "tenant_delete_supplement_reports" ON public.supplement_reports FOR DELETE USING (tenant_id = public.get_user_active_tenant_id());

CREATE TRIGGER trg_scope_comparisons_updated BEFORE UPDATE ON public.scope_comparisons FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_scope_comparison_lines_updated BEFORE UPDATE ON public.scope_comparison_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_supplement_reports_updated BEFORE UPDATE ON public.supplement_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
