-- Pipeline Management System Enhancement (Fixed)
-- Add pipeline stage management and workflow automation

-- Pipeline stages for better organization
CREATE TABLE IF NOT EXISTS public.pipeline_stages (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    stage_order INTEGER NOT NULL DEFAULT 0,
    probability_percent INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    color TEXT DEFAULT '#6b7280',
    auto_actions JSONB DEFAULT '{}',
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Pipeline activities for tracking all interactions
CREATE TABLE IF NOT EXISTS public.pipeline_activities (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    pipeline_entry_id UUID,
    contact_id UUID,
    activity_type TEXT NOT NULL, -- call, email, meeting, note, status_change
    title TEXT NOT NULL,
    description TEXT,
    scheduled_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'pending', -- pending, completed, cancelled
    priority TEXT DEFAULT 'medium', -- low, medium, high, urgent
    assigned_to UUID,
    created_by UUID,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Pipeline automation rules
CREATE TABLE IF NOT EXISTS public.pipeline_automation_rules (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    trigger_event TEXT NOT NULL, -- stage_change, score_change, activity_completed
    trigger_conditions JSONB DEFAULT '{}',
    actions JSONB DEFAULT '[]', -- array of actions to execute
    is_active BOOLEAN DEFAULT true,
    execution_count INTEGER DEFAULT 0,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_automation_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies for pipeline_stages
CREATE POLICY "Users can view pipeline stages in their tenant" 
ON public.pipeline_stages FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage pipeline stages in their tenant" 
ON public.pipeline_stages FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for pipeline_activities  
CREATE POLICY "Users can view pipeline activities in their tenant" 
ON public.pipeline_activities FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create pipeline activities in their tenant" 
ON public.pipeline_activities FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update pipeline activities in their tenant" 
ON public.pipeline_activities FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete pipeline activities in their tenant" 
ON public.pipeline_activities FOR DELETE 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for pipeline_automation_rules
CREATE POLICY "Users can view automation rules in their tenant" 
ON public.pipeline_automation_rules FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage automation rules in their tenant" 
ON public.pipeline_automation_rules FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Update triggers
CREATE TRIGGER update_pipeline_stages_updated_at
BEFORE UPDATE ON public.pipeline_stages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pipeline_activities_updated_at
BEFORE UPDATE ON public.pipeline_activities
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pipeline_automation_rules_updated_at
BEFORE UPDATE ON public.pipeline_automation_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to auto-assign leads based on scoring
CREATE OR REPLACE FUNCTION public.auto_assign_pipeline_entry()
RETURNS TRIGGER AS $$
DECLARE
    target_user_id UUID;
    qualification_status_rec RECORD;
BEGIN
    -- Only process if this is a new lead or score change
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.lead_quality_score != NEW.lead_quality_score) THEN
        
        -- Get qualification status based on score
        SELECT * INTO qualification_status_rec
        FROM public.lead_qualification_statuses
        WHERE tenant_id = NEW.tenant_id
        AND NEW.lead_quality_score BETWEEN min_score AND max_score
        AND is_active = true
        ORDER BY priority ASC
        LIMIT 1;
        
        -- Auto-assign if qualification status has auto_assign enabled
        IF qualification_status_rec.auto_assign AND qualification_status_rec.default_assigned_user IS NOT NULL THEN
            NEW.assigned_to = qualification_status_rec.default_assigned_user;
        END IF;
        
        -- Update qualification status on contact
        UPDATE public.contacts 
        SET qualification_status = qualification_status_rec.name
        WHERE id = NEW.contact_id;
        
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Add trigger for auto-assignment
CREATE TRIGGER auto_assign_pipeline_entries
BEFORE INSERT OR UPDATE ON public.pipeline_entries
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_pipeline_entry();