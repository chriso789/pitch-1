
-- Supplement Engine tables (using tenant_id to match project convention)

CREATE TABLE IF NOT EXISTS public.supplement_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_id uuid NOT NULL,
  estimate_project_id uuid,
  carrier_name text,
  claim_number text,
  policy_number text,
  loss_date date,
  status text NOT NULL DEFAULT 'draft',
  supplement_total numeric DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplement_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplement_case_id uuid NOT NULL REFERENCES public.supplement_cases(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  file_url text NOT NULL,
  parsed_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplement_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplement_case_id uuid NOT NULL REFERENCES public.supplement_cases(id) ON DELETE CASCADE,
  dispute_type text NOT NULL,
  xactimate_code text,
  description text NOT NULL,
  carrier_quantity numeric,
  requested_quantity numeric,
  unit text,
  reason text,
  evidence_refs jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplement_narratives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplement_case_id uuid NOT NULL REFERENCES public.supplement_cases(id) ON DELETE CASCADE,
  narrative text NOT NULL,
  adjuster_email text,
  internal_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_supplement_cases_tenant ON public.supplement_cases(tenant_id);
CREATE INDEX idx_supplement_cases_job ON public.supplement_cases(job_id);
CREATE INDEX idx_supplement_disputes_case ON public.supplement_disputes(supplement_case_id);
CREATE INDEX idx_supplement_documents_case ON public.supplement_documents(supplement_case_id);
CREATE INDEX idx_supplement_narratives_case ON public.supplement_narratives(supplement_case_id);

-- RLS
ALTER TABLE public.supplement_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplement_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplement_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplement_narratives ENABLE ROW LEVEL SECURITY;

-- supplement_cases policies
CREATE POLICY "Tenant users can view supplement cases"
  ON public.supplement_cases FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE));

CREATE POLICY "Tenant users can create supplement cases"
  ON public.supplement_cases FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE));

CREATE POLICY "Tenant users can update supplement cases"
  ON public.supplement_cases FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE));

CREATE POLICY "Tenant users can delete supplement cases"
  ON public.supplement_cases FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE));

-- supplement_documents policies (join through parent case)
CREATE POLICY "Tenant users can manage supplement documents"
  ON public.supplement_documents FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supplement_cases sc
      WHERE sc.id = supplement_case_id
        AND sc.tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
    )
  );

-- supplement_disputes policies
CREATE POLICY "Tenant users can manage supplement disputes"
  ON public.supplement_disputes FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supplement_cases sc
      WHERE sc.id = supplement_case_id
        AND sc.tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
    )
  );

-- supplement_narratives policies
CREATE POLICY "Tenant users can manage supplement narratives"
  ON public.supplement_narratives FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.supplement_cases sc
      WHERE sc.id = supplement_case_id
        AND sc.tenant_id IN (SELECT tenant_id FROM public.user_company_access WHERE user_id = auth.uid() AND is_active = TRUE)
    )
  );
