
CREATE TABLE public.xact_scope_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  estimate_type text NOT NULL CHECK (estimate_type IN ('retail','insurance','supplement','change_order')),
  title text NOT NULL,
  xactimate_profile text,
  price_list_region text,
  price_list_date date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','approved','exported','archived')),
  overhead_profit_enabled boolean DEFAULT false,
  overhead_percent numeric DEFAULT 10,
  profit_percent numeric DEFAULT 10,
  tax_enabled boolean DEFAULT true,
  default_tax_rate numeric DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.xact_scope_projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can manage xact_scope_projects"
  ON public.xact_scope_projects FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.tenant_id = xact_scope_projects.tenant_id
        AND uca.user_id = auth.uid()
        AND uca.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.tenant_id = xact_scope_projects.tenant_id
        AND uca.user_id = auth.uid()
        AND uca.is_active = true
    )
  );

CREATE TABLE public.xact_scope_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_project_id uuid NOT NULL REFERENCES public.xact_scope_projects(id) ON DELETE CASCADE,
  area_name text NOT NULL,
  area_type text NOT NULL DEFAULT 'roof' CHECK (area_type IN ('roof','interior','exterior','gutter','siding','other')),
  measurements jsonb DEFAULT '{}'::jsonb,
  notes text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.xact_scope_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can manage xact_scope_areas"
  ON public.xact_scope_areas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.xact_scope_projects sp
      JOIN public.user_company_access uca ON uca.tenant_id = sp.tenant_id AND uca.user_id = auth.uid() AND uca.is_active = true
      WHERE sp.id = xact_scope_areas.scope_project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.xact_scope_projects sp
      JOIN public.user_company_access uca ON uca.tenant_id = sp.tenant_id AND uca.user_id = auth.uid() AND uca.is_active = true
      WHERE sp.id = xact_scope_areas.scope_project_id
    )
  );

CREATE TABLE public.xact_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_project_id uuid NOT NULL REFERENCES public.xact_scope_projects(id) ON DELETE CASCADE,
  scope_area_id uuid REFERENCES public.xact_scope_areas(id) ON DELETE SET NULL,
  trade text NOT NULL DEFAULT 'roofing',
  xactimate_code text,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'SQ',
  unit_price numeric DEFAULT 0,
  waste_percent numeric DEFAULT 0,
  tax_rate numeric DEFAULT 0,
  line_total numeric GENERATED ALWAYS AS (
    round((quantity * unit_price * (1 + waste_percent / 100))::numeric, 2)
  ) STORED,
  source text DEFAULT 'manual' CHECK (source IN ('manual','ai_suggested','measurement','imported')),
  confidence numeric,
  ai_reason text,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.xact_scope_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can manage xact_scope_items"
  ON public.xact_scope_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.xact_scope_projects sp
      JOIN public.user_company_access uca ON uca.tenant_id = sp.tenant_id AND uca.user_id = auth.uid() AND uca.is_active = true
      WHERE sp.id = xact_scope_items.scope_project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.xact_scope_projects sp
      JOIN public.user_company_access uca ON uca.tenant_id = sp.tenant_id AND uca.user_id = auth.uid() AND uca.is_active = true
      WHERE sp.id = xact_scope_items.scope_project_id
    )
  );

CREATE TABLE public.xact_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_project_id uuid NOT NULL REFERENCES public.xact_scope_projects(id) ON DELETE CASCADE,
  export_type text NOT NULL CHECK (export_type IN ('pdf','excel','xactimate_worksheet','supplement_packet')),
  file_url text,
  status text DEFAULT 'generated' CHECK (status IN ('generating','generated','failed')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.xact_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can manage xact_exports"
  ON public.xact_exports FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.xact_scope_projects sp
      JOIN public.user_company_access uca ON uca.tenant_id = sp.tenant_id AND uca.user_id = auth.uid() AND uca.is_active = true
      WHERE sp.id = xact_exports.scope_project_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.xact_scope_projects sp
      JOIN public.user_company_access uca ON uca.tenant_id = sp.tenant_id AND uca.user_id = auth.uid() AND uca.is_active = true
      WHERE sp.id = xact_exports.scope_project_id
    )
  );

CREATE TABLE public.xact_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  carrier_estimate_url text,
  pitch_scope_id uuid REFERENCES public.xact_scope_projects(id) ON DELETE SET NULL,
  missing_items jsonb DEFAULT '[]'::jsonb,
  quantity_disputes jsonb DEFAULT '[]'::jsonb,
  pricing_disputes jsonb DEFAULT '[]'::jsonb,
  supplement_summary text,
  status text DEFAULT 'pending' CHECK (status IN ('pending','reviewed','supplement_filed','resolved')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.xact_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can manage xact_comparisons"
  ON public.xact_comparisons FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.tenant_id = xact_comparisons.tenant_id
        AND uca.user_id = auth.uid()
        AND uca.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_company_access uca
      WHERE uca.tenant_id = xact_comparisons.tenant_id
        AND uca.user_id = auth.uid()
        AND uca.is_active = true
    )
  );

CREATE INDEX idx_xact_scope_projects_tenant ON public.xact_scope_projects(tenant_id);
CREATE INDEX idx_xact_scope_projects_job ON public.xact_scope_projects(job_id);
CREATE INDEX idx_xact_scope_areas_project ON public.xact_scope_areas(scope_project_id);
CREATE INDEX idx_xact_scope_items_project ON public.xact_scope_items(scope_project_id);
CREATE INDEX idx_xact_scope_items_area ON public.xact_scope_items(scope_area_id);
CREATE INDEX idx_xact_exports_project ON public.xact_exports(scope_project_id);
CREATE INDEX idx_xact_comparisons_job ON public.xact_comparisons(job_id);
CREATE INDEX idx_xact_comparisons_tenant ON public.xact_comparisons(tenant_id);
