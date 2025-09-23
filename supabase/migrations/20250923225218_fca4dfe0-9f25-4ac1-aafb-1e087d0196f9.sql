-- Create feature permissions table for role-based access control
CREATE TABLE public.feature_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  role app_role NOT NULL,
  feature_key TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, role, feature_key)
);

-- Enable RLS
ALTER TABLE public.feature_permissions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can manage feature permissions in their tenant" 
ON public.feature_permissions 
FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

CREATE POLICY "Users can view feature permissions in their tenant" 
ON public.feature_permissions 
FOR SELECT
USING (tenant_id = get_user_tenant_id());

-- Insert default feature permissions for each role
INSERT INTO public.feature_permissions (tenant_id, role, feature_key, is_enabled) VALUES
-- Admin permissions (full access)
('00000000-0000-0000-0000-000000000000', 'admin', 'pipeline', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'estimates', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'projects', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'contacts', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'production', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'leaderboard', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'payments', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'dialer', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'smart_docs', true),
('00000000-0000-0000-0000-000000000000', 'admin', 'settings', true),

-- Manager permissions (most features)
('00000000-0000-0000-0000-000000000000', 'manager', 'pipeline', true),
('00000000-0000-0000-0000-000000000000', 'manager', 'estimates', true),
('00000000-0000-0000-0000-000000000000', 'manager', 'projects', true),
('00000000-0000-0000-0000-000000000000', 'manager', 'contacts', true),
('00000000-0000-0000-0000-000000000000', 'manager', 'production', true),
('00000000-0000-0000-0000-000000000000', 'manager', 'leaderboard', true),
('00000000-0000-0000-0000-000000000000', 'manager', 'payments', false),
('00000000-0000-0000-0000-000000000000', 'manager', 'dialer', true),
('00000000-0000-0000-0000-000000000000', 'manager', 'smart_docs', true),
('00000000-0000-0000-0000-000000000000', 'manager', 'settings', false),

-- User permissions (limited access)
('00000000-0000-0000-0000-000000000000', 'user', 'pipeline', true),
('00000000-0000-0000-0000-000000000000', 'user', 'estimates', true),
('00000000-0000-0000-0000-000000000000', 'user', 'projects', false),
('00000000-0000-0000-0000-000000000000', 'user', 'contacts', true),
('00000000-0000-0000-0000-000000000000', 'user', 'production', false),
('00000000-0000-0000-0000-000000000000', 'user', 'leaderboard', true),
('00000000-0000-0000-0000-000000000000', 'user', 'payments', false),
('00000000-0000-0000-0000-000000000000', 'user', 'dialer', true),
('00000000-0000-0000-0000-000000000000', 'user', 'smart_docs', false),
('00000000-0000-0000-0000-000000000000', 'user', 'settings', false);

-- Create trigger for updated_at
CREATE TRIGGER update_feature_permissions_updated_at
BEFORE UPDATE ON public.feature_permissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();