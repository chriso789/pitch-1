-- Create settings_tabs table for dynamic tab configuration
CREATE TABLE public.settings_tabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id),
  tab_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  icon_name TEXT NOT NULL DEFAULT 'Settings',
  order_index INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  required_role TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, tab_key)
);

-- Index for fast querying
CREATE INDEX idx_settings_tabs_order ON settings_tabs(tenant_id, order_index);
CREATE INDEX idx_settings_tabs_tenant ON settings_tabs(tenant_id);

-- RLS Policies
ALTER TABLE settings_tabs ENABLE ROW LEVEL SECURITY;

-- Everyone can read tab configs in their tenant
CREATE POLICY "Users can view tab configurations in their tenant"
  ON settings_tabs FOR SELECT
  USING (tenant_id = get_user_tenant_id());

-- Only master can edit tab configs
CREATE POLICY "Masters can manage tab configurations"
  ON settings_tabs FOR ALL
  USING (
    tenant_id = get_user_tenant_id() AND
    has_role('master'::app_role)
  );

-- Trigger for updated_at
CREATE TRIGGER update_settings_tabs_updated_at
  BEFORE UPDATE ON settings_tabs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Seed default tabs for each tenant
INSERT INTO settings_tabs (tenant_id, tab_key, label, description, icon_name, order_index, required_role)
SELECT 
  t.id as tenant_id,
  tab.tab_key,
  tab.label,
  tab.description,
  tab.icon_name,
  tab.order_index,
  tab.required_role
FROM tenants t
CROSS JOIN (
  VALUES
    ('general', 'General', 'Basic system settings and preferences', 'Settings', 1, NULL),
    ('materials', 'Materials', 'Manage your materials catalog and pricing', 'Database', 2, NULL),
    ('estimates', 'Estimates', 'Configure estimate templates and settings', 'Calculator', 3, NULL),
    ('commissions', 'Commissions', 'Setup commission structures and rates', 'DollarSign', 4, ARRAY['master', 'admin', 'manager']),
    ('suppliers', 'Suppliers', 'Manage your supplier relationships and contacts', 'Package', 5, NULL),
    ('products', 'Products', 'Product catalog and inventory management', 'Box', 6, NULL),
    ('company', 'Company', 'Company locations and organizational settings', 'Building', 7, NULL),
    ('users', 'Users', 'User management and permissions', 'Users', 8, ARRAY['master', 'admin', 'manager']),
    ('quickbooks', 'QuickBooks', 'QuickBooks Online integration settings', 'Building2', 9, ARRAY['master', 'admin']),
    ('reports', 'Reports', 'System error reports and diagnostics', 'AlertTriangle', 10, ARRAY['master', 'admin']),
    ('automations', 'Automations', 'Automated workflows and smart documents', 'Bell', 11, NULL),
    ('approvals', 'Approvals', 'Manager approval queue and pending items', 'CheckSquare', 12, ARRAY['master', 'manager']),
    ('health', 'Health', 'System health monitoring and diagnostics', 'Activity', 13, ARRAY['master']),
    ('developer', 'Developer', 'Advanced developer tools and API access', 'Code', 14, ARRAY['master'])
) AS tab(tab_key, label, description, icon_name, order_index, required_role);