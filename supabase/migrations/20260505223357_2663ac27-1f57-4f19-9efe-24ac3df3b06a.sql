
-- carrier_estimate_line_items
CREATE TABLE IF NOT EXISTS public.carrier_estimate_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplement_case_id uuid REFERENCES public.supplement_cases(id) ON DELETE CASCADE NOT NULL,
  raw_text text NOT NULL,
  code text,
  description text,
  quantity numeric,
  unit text,
  unit_price numeric,
  total_price numeric,
  category text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.carrier_estimate_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for carrier_estimate_line_items"
  ON public.carrier_estimate_line_items FOR ALL TO authenticated
  USING (
    supplement_case_id IN (
      SELECT id FROM public.supplement_cases
      WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    )
  )
  WITH CHECK (
    supplement_case_id IN (
      SELECT id FROM public.supplement_cases
      WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    )
  );

-- supplement_packet_exports
CREATE TABLE IF NOT EXISTS public.supplement_packet_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplement_case_id uuid REFERENCES public.supplement_cases(id) ON DELETE CASCADE NOT NULL,
  file_url text,
  export_type text DEFAULT 'pdf',
  status text DEFAULT 'generated',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.supplement_packet_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for supplement_packet_exports"
  ON public.supplement_packet_exports FOR ALL TO authenticated
  USING (
    supplement_case_id IN (
      SELECT id FROM public.supplement_cases
      WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    )
  )
  WITH CHECK (
    supplement_case_id IN (
      SELECT id FROM public.supplement_cases
      WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    )
  );

-- supplement_activity_log
CREATE TABLE IF NOT EXISTS public.supplement_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplement_case_id uuid REFERENCES public.supplement_cases(id) ON DELETE CASCADE NOT NULL,
  activity_type text NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.supplement_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for supplement_activity_log"
  ON public.supplement_activity_log FOR ALL TO authenticated
  USING (
    supplement_case_id IN (
      SELECT id FROM public.supplement_cases
      WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    )
  )
  WITH CHECK (
    supplement_case_id IN (
      SELECT id FROM public.supplement_cases
      WHERE tenant_id = (SELECT (auth.jwt()->'app_metadata'->>'tenant_id')::uuid)
    )
  );

-- Extend supplement_cases with workflow columns
ALTER TABLE public.supplement_cases
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS denied_at timestamptz,
  ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS adjuster_email text,
  ADD COLUMN IF NOT EXISTS supplement_requested_total numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplement_approved_total numeric DEFAULT 0;
