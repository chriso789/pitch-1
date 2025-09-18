-- Create dialer tables with proper structure
-- Create dialer_dispositions table
CREATE TABLE IF NOT EXISTS public.dialer_dispositions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_positive BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

-- Create dialer_lists table
CREATE TABLE IF NOT EXISTS public.dialer_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  total_items INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

-- Create dialer_campaigns table
CREATE TABLE IF NOT EXISTS public.dialer_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  list_id UUID REFERENCES public.dialer_lists(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

-- Create dialer_list_items table
CREATE TABLE IF NOT EXISTS public.dialer_list_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  list_id UUID NOT NULL REFERENCES public.dialer_lists(id),
  first_name TEXT,
  last_name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID
);

-- Enable RLS on all tables
ALTER TABLE public.dialer_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_list_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view dialer dispositions in their tenant" ON public.dialer_dispositions
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage dialer dispositions in their tenant" ON public.dialer_dispositions
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

CREATE POLICY "Users can view dialer lists in their tenant" ON public.dialer_lists
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage dialer lists in their tenant" ON public.dialer_lists
  FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view dialer campaigns in their tenant" ON public.dialer_campaigns
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage dialer campaigns in their tenant" ON public.dialer_campaigns
  FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view dialer list items in their tenant" ON public.dialer_list_items
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage dialer list items in their tenant" ON public.dialer_list_items
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_dialer_dispositions_tenant_id ON public.dialer_dispositions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dialer_lists_tenant_id ON public.dialer_lists(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dialer_campaigns_tenant_id ON public.dialer_campaigns(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dialer_campaigns_list_id ON public.dialer_campaigns(list_id);
CREATE INDEX IF NOT EXISTS idx_dialer_list_items_tenant_id ON public.dialer_list_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dialer_list_items_list_id ON public.dialer_list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_dialer_list_items_status ON public.dialer_list_items(status);

-- Add updated_at triggers
CREATE TRIGGER update_dialer_dispositions_updated_at
  BEFORE UPDATE ON public.dialer_dispositions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dialer_lists_updated_at
  BEFORE UPDATE ON public.dialer_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dialer_campaigns_updated_at
  BEFORE UPDATE ON public.dialer_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dialer_list_items_updated_at
  BEFORE UPDATE ON public.dialer_list_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();