-- Diagrams generated from PITCH measured geometry
CREATE TABLE IF NOT EXISTS public.ai_measurement_diagrams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_measurement_job_id uuid REFERENCES public.ai_measurement_jobs(id) ON DELETE CASCADE,
  measurement_result_id uuid,
  roof_measurement_id uuid,
  lead_id uuid,
  project_id uuid,
  company_id uuid,
  tenant_id uuid,
  diagram_type text NOT NULL,
  title text NOT NULL,
  page_number integer,
  svg_markup text,
  png_storage_path text,
  pdf_storage_path text,
  diagram_json jsonb,
  width integer DEFAULT 1000,
  height integer DEFAULT 1000,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_measurement_diagrams_job ON public.ai_measurement_diagrams(ai_measurement_job_id);
CREATE INDEX IF NOT EXISTS idx_ai_measurement_diagrams_lead ON public.ai_measurement_diagrams(lead_id);
CREATE INDEX IF NOT EXISTS idx_ai_measurement_diagrams_project ON public.ai_measurement_diagrams(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_measurement_diagrams_tenant ON public.ai_measurement_diagrams(tenant_id);

ALTER TABLE public.ai_measurement_diagrams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view diagrams"
  ON public.ai_measurement_diagrams FOR SELECT
  USING (tenant_id IN (SELECT public.get_user_tenant_ids()) OR tenant_id IS NULL);

CREATE POLICY "Service role manages diagrams"
  ON public.ai_measurement_diagrams FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Vendor PDF extracted diagram pages (training/QA reference only)
CREATE TABLE IF NOT EXISTS public.vendor_report_diagram_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  tenant_id uuid,
  lead_id uuid,
  project_id uuid,
  report_file_path text NOT NULL,
  vendor text,
  page_number integer NOT NULL,
  page_type text NOT NULL,
  extracted_text text,
  image_storage_path text,
  parsed_values jsonb,
  confidence numeric,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendor_report_diagram_pages_lead ON public.vendor_report_diagram_pages(lead_id);
CREATE INDEX IF NOT EXISTS idx_vendor_report_diagram_pages_project ON public.vendor_report_diagram_pages(project_id);
CREATE INDEX IF NOT EXISTS idx_vendor_report_diagram_pages_tenant ON public.vendor_report_diagram_pages(tenant_id);

ALTER TABLE public.vendor_report_diagram_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view vendor diagram pages"
  ON public.vendor_report_diagram_pages FOR SELECT
  USING (tenant_id IN (SELECT public.get_user_tenant_ids()) OR tenant_id IS NULL);

CREATE POLICY "Service role manages vendor diagram pages"
  ON public.vendor_report_diagram_pages FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');