-- Create tenant estimate settings table for fine print and PDF defaults
CREATE TABLE public.tenant_estimate_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fine_print_content TEXT,
  default_include_fine_print BOOLEAN DEFAULT true,
  default_pdf_view_mode TEXT DEFAULT 'customer' CHECK (default_pdf_view_mode IN ('customer', 'internal')),
  default_terms TEXT DEFAULT 'This estimate is valid for 30 days. A 50% deposit is required to schedule the project. Final balance due upon completion. All work includes standard manufacturer warranty.',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

-- Enable RLS
ALTER TABLE public.tenant_estimate_settings ENABLE ROW LEVEL SECURITY;

-- Policies with correct role names
CREATE POLICY "Users can view their tenant estimate settings"
ON public.tenant_estimate_settings FOR SELECT
USING (
  tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) 
    FROM profiles WHERE id = auth.uid()
  )
);

CREATE POLICY "Owners can update estimate settings"
ON public.tenant_estimate_settings FOR UPDATE
USING (
  tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) 
    FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('owner', 'master', 'office_admin')
  )
);

CREATE POLICY "Owners can insert estimate settings"
ON public.tenant_estimate_settings FOR INSERT
WITH CHECK (
  tenant_id IN (
    SELECT COALESCE(active_tenant_id, tenant_id) 
    FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('owner', 'master', 'office_admin')
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_tenant_estimate_settings_updated_at
  BEFORE UPDATE ON public.tenant_estimate_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();