-- Create enums for dialer system
CREATE TYPE dialer_mode AS ENUM ('preview', 'power');
CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'complete');
CREATE TYPE member_state AS ENUM ('queued', 'in_progress', 'done');
CREATE TYPE import_source AS ENUM ('csv_upload', 'manual', 'segment');
CREATE TYPE dnc_status AS ENUM ('clean', 'dnc', 'unknown');
CREATE TYPE consent_status AS ENUM ('opt_in', 'opt_out', 'unknown');

-- Create dialer lists table
CREATE TABLE public.dialer_lists (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    source import_source NOT NULL DEFAULT 'csv_upload',
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create dialer list items table  
CREATE TABLE public.dialer_list_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    list_id UUID NOT NULL REFERENCES public.dialer_lists(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id),
    raw_name TEXT,
    raw_address TEXT, 
    raw_phone TEXT,
    raw_city TEXT,
    raw_state TEXT,
    raw_zip TEXT,
    e164_phone TEXT,
    first_name TEXT,
    last_name TEXT,
    normalized_address TEXT,
    dnc_status dnc_status DEFAULT 'unknown',
    consent_status consent_status DEFAULT 'unknown',
    import_errors JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create dialer dispositions table
CREATE TABLE public.dialer_dispositions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    is_final BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default dispositions
INSERT INTO public.dialer_dispositions (tenant_id, name, is_final) VALUES
    ('00000000-0000-0000-0000-000000000000', 'No Answer', false),
    ('00000000-0000-0000-0000-000000000000', 'Left Voicemail', false), 
    ('00000000-0000-0000-0000-000000000000', 'Bad Number', true),
    ('00000000-0000-0000-0000-000000000000', 'Not Interested', true),
    ('00000000-0000-0000-0000-000000000000', 'Call Back', false),
    ('00000000-0000-0000-0000-000000000000', 'Appointment Set', true),
    ('00000000-0000-0000-0000-000000000000', 'Contact Made', true);

-- Create dialer campaigns table
CREATE TABLE public.dialer_campaigns (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    mode dialer_mode DEFAULT 'preview',
    caller_id_phone TEXT,
    status campaign_status DEFAULT 'draft',
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create dialer campaign members table
CREATE TABLE public.dialer_campaign_members (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    campaign_id UUID NOT NULL REFERENCES public.dialer_campaigns(id) ON DELETE CASCADE,
    list_item_id UUID NOT NULL REFERENCES public.dialer_list_items(id) ON DELETE CASCADE,
    state member_state DEFAULT 'queued',
    last_disposition_id UUID REFERENCES public.dialer_dispositions(id),
    attempts_count INTEGER DEFAULT 0,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(campaign_id, list_item_id)
);

-- Add campaign_id to existing calls table
ALTER TABLE public.calls ADD COLUMN campaign_id UUID REFERENCES public.dialer_campaigns(id);
ALTER TABLE public.calls ADD COLUMN list_item_id UUID REFERENCES public.dialer_list_items(id);
ALTER TABLE public.calls ADD COLUMN disposition_id UUID REFERENCES public.dialer_dispositions(id);

-- Enable RLS
ALTER TABLE public.dialer_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_dispositions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dialer_campaign_members ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for dialer_lists
CREATE POLICY "Users can view dialer lists in their tenant" 
ON public.dialer_lists FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create dialer lists in their tenant" 
ON public.dialer_lists FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update dialer lists in their tenant" 
ON public.dialer_lists FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete dialer lists in their tenant" 
ON public.dialer_lists FOR DELETE 
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for dialer_list_items
CREATE POLICY "Users can view dialer list items in their tenant" 
ON public.dialer_list_items FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create dialer list items in their tenant" 
ON public.dialer_list_items FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update dialer list items in their tenant" 
ON public.dialer_list_items FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete dialer list items in their tenant" 
ON public.dialer_list_items FOR DELETE 
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for dialer_dispositions  
CREATE POLICY "Users can view dispositions in their tenant" 
ON public.dialer_dispositions FOR SELECT 
USING (tenant_id = get_user_tenant_id() OR tenant_id = '00000000-0000-0000-0000-000000000000');

CREATE POLICY "Admins can manage dispositions in their tenant" 
ON public.dialer_dispositions FOR ALL 
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for dialer_campaigns
CREATE POLICY "Users can view dialer campaigns in their tenant" 
ON public.dialer_campaigns FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create dialer campaigns in their tenant" 
ON public.dialer_campaigns FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update dialer campaigns in their tenant" 
ON public.dialer_campaigns FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete dialer campaigns in their tenant" 
ON public.dialer_campaigns FOR DELETE 
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for dialer_campaign_members
CREATE POLICY "Users can view campaign members in their tenant" 
ON public.dialer_campaign_members FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create campaign members in their tenant" 
ON public.dialer_campaign_members FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update campaign members in their tenant" 
ON public.dialer_campaign_members FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete campaign members in their tenant" 
ON public.dialer_campaign_members FOR DELETE 
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create triggers for updated_at
CREATE TRIGGER update_dialer_lists_updated_at
    BEFORE UPDATE ON public.dialer_lists
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_dialer_campaigns_updated_at
    BEFORE UPDATE ON public.dialer_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for performance
CREATE INDEX idx_dialer_list_items_list_id ON public.dialer_list_items(list_id);
CREATE INDEX idx_dialer_list_items_contact_id ON public.dialer_list_items(contact_id);
CREATE INDEX idx_dialer_list_items_phone ON public.dialer_list_items(e164_phone);
CREATE INDEX idx_dialer_campaign_members_campaign_id ON public.dialer_campaign_members(campaign_id);
CREATE INDEX idx_dialer_campaign_members_state ON public.dialer_campaign_members(state);
CREATE INDEX idx_calls_campaign_id ON public.calls(campaign_id);