-- Create external_measurement_reports table for storing competitor PDF data
CREATE TABLE IF NOT EXISTS public.external_measurement_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID REFERENCES public.pipeline_entries(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'roofr',
  address TEXT,
  total_area_sqft NUMERIC(10, 2),
  facet_count INTEGER,
  predominant_pitch TEXT,
  linears JSONB DEFAULT '{}',
  waste_factors JSONB DEFAULT '{}',
  facets JSONB DEFAULT '[]',
  materials_summary JSONB DEFAULT '{}',
  raw_data JSONB,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(lead_id, provider)
);

-- Enable RLS
ALTER TABLE public.external_measurement_reports ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view external reports for their tenant"
  ON public.external_measurement_reports
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can insert external reports for their tenant"
  ON public.external_measurement_reports
  FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update external reports for their tenant"
  ON public.external_measurement_reports
  FOR UPDATE
  USING (tenant_id IN (
    SELECT tenant_id FROM public.profiles WHERE id = auth.uid()
  ));

-- Service role bypass for edge functions
CREATE POLICY "Service role has full access to external reports"
  ON public.external_measurement_reports
  FOR ALL
  USING (auth.role() = 'service_role');

-- Create index for faster lookups
CREATE INDEX idx_external_measurement_reports_lead_id ON public.external_measurement_reports(lead_id);
CREATE INDEX idx_external_measurement_reports_tenant_id ON public.external_measurement_reports(tenant_id);

-- Add trigger for updated_at
CREATE TRIGGER update_external_measurement_reports_updated_at
  BEFORE UPDATE ON public.external_measurement_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();