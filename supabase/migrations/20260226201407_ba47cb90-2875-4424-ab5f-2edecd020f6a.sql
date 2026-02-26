
-- Create inspection_step_configs table
CREATE TABLE public.inspection_step_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  guidance TEXT[] DEFAULT '{}',
  is_required BOOLEAN DEFAULT false,
  min_photos INTEGER DEFAULT 0,
  order_index INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, step_key)
);

-- Enable RLS
ALTER TABLE public.inspection_step_configs ENABLE ROW LEVEL SECURITY;

-- Read policy: all authenticated users in same tenant can read
CREATE POLICY "Users can read their tenant inspection configs"
  ON public.inspection_step_configs
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (
    SELECT t.id FROM tenants t
    JOIN profiles p ON p.tenant_id = t.id OR p.active_tenant_id = t.id
    WHERE p.id = auth.uid()
  ));

-- Write policy: only admin roles can insert/update/delete
CREATE POLICY "Admins can manage inspection configs"
  ON public.inspection_step_configs
  FOR ALL
  TO authenticated
  USING (
    tenant_id IN (
      SELECT t.id FROM tenants t
      JOIN profiles p ON p.tenant_id = t.id OR p.active_tenant_id = t.id
      WHERE p.id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'corporate', 'office_admin', 'master')
    )
  )
  WITH CHECK (
    tenant_id IN (
      SELECT t.id FROM tenants t
      JOIN profiles p ON p.tenant_id = t.id OR p.active_tenant_id = t.id
      WHERE p.id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM user_roles ur
      WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'corporate', 'office_admin', 'master')
    )
  );

-- Add updated_at trigger
CREATE TRIGGER update_inspection_step_configs_updated_at
  BEFORE UPDATE ON public.inspection_step_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert settings tab for Inspections
INSERT INTO public.settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
VALUES (
  'inspections',
  'Inspections',
  'Configure inspection walkthrough steps and requirements',
  'ClipboardCheck',
  25,
  true,
  ARRAY['owner', 'corporate', 'office_admin', 'master']
);

-- Create index for faster tenant lookups
CREATE INDEX idx_inspection_step_configs_tenant ON public.inspection_step_configs(tenant_id, order_index);
