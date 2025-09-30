-- Create skip_trace_results table
CREATE TABLE IF NOT EXISTS public.skip_trace_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id),
  search_parameters JSONB DEFAULT '{}'::jsonb,
  raw_results JSONB DEFAULT '{}'::jsonb,
  enriched_data JSONB DEFAULT '{}'::jsonb,
  confidence_score NUMERIC DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'searchbug',
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_skip_trace_contact_id ON public.skip_trace_results(contact_id);
CREATE INDEX IF NOT EXISTS idx_skip_trace_tenant_id ON public.skip_trace_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_skip_trace_created_at ON public.skip_trace_results(created_at DESC);

-- Enable RLS
ALTER TABLE public.skip_trace_results ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view skip trace results in their tenant"
  ON public.skip_trace_results
  FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert skip trace results in their tenant"
  ON public.skip_trace_results
  FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage skip trace results in their tenant"
  ON public.skip_trace_results
  FOR ALL
  USING (
    tenant_id = get_user_tenant_id() AND 
    has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role])
  );