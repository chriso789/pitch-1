-- Create tasks table for AI-generated and manual tasks
CREATE TABLE public.tasks (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    assigned_to UUID REFERENCES public.profiles(id),
    contact_id UUID REFERENCES public.contacts(id),
    pipeline_entry_id UUID REFERENCES public.pipeline_entries(id),
    project_id UUID REFERENCES public.projects(id),
    title TEXT NOT NULL,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    due_date TIMESTAMP WITH TIME ZONE,
    ai_generated BOOLEAN DEFAULT false,
    ai_context JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- Create follow_up_campaigns table for automated sequences
CREATE TABLE public.follow_up_campaigns (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    trigger_event TEXT NOT NULL, -- 'status_change', 'time_based', 'manual'
    trigger_conditions JSONB NOT NULL DEFAULT '{}',
    sequence_steps JSONB NOT NULL DEFAULT '[]', -- Array of follow-up steps
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create communication_history table for complete interaction log
CREATE TABLE public.communication_history (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    contact_id UUID REFERENCES public.contacts(id),
    pipeline_entry_id UUID REFERENCES public.pipeline_entries(id),
    project_id UUID REFERENCES public.projects(id),
    rep_id UUID REFERENCES public.profiles(id),
    communication_type TEXT NOT NULL, -- 'call', 'email', 'sms', 'meeting', 'voice_note'
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    subject TEXT,
    content TEXT,
    transcription TEXT,
    sentiment_score DECIMAL(3,2), -- -1.0 to 1.0
    ai_insights JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ai_insights table for stored AI recommendations
CREATE TABLE public.ai_insights (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    context_type TEXT NOT NULL, -- 'contact', 'pipeline', 'project', 'estimate'
    context_id UUID NOT NULL,
    insight_type TEXT NOT NULL, -- 'recommendation', 'warning', 'opportunity', 'prediction'
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    confidence_score DECIMAL(3,2), -- 0.0 to 1.0
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'acted_upon')),
    action_taken JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE
);

-- Create follow_up_instances table for tracking individual follow-ups
CREATE TABLE public.follow_up_instances (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    campaign_id UUID REFERENCES public.follow_up_campaigns(id),
    contact_id UUID REFERENCES public.contacts(id),
    pipeline_entry_id UUID REFERENCES public.pipeline_entries(id),
    step_index INTEGER NOT NULL,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'cancelled')),
    sent_at TIMESTAMP WITH TIME ZONE,
    delivery_status JSONB DEFAULT '{}',
    response_data JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_instances ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for tasks
CREATE POLICY "Users can view tasks in their tenant" 
ON public.tasks FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create tasks in their tenant" 
ON public.tasks FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update tasks in their tenant" 
ON public.tasks FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete tasks in their tenant" 
ON public.tasks FOR DELETE 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for follow_up_campaigns
CREATE POLICY "Users can view campaigns in their tenant" 
ON public.follow_up_campaigns FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage campaigns in their tenant" 
ON public.follow_up_campaigns FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create RLS policies for communication_history
CREATE POLICY "Users can view communication history in their tenant" 
ON public.communication_history FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create communication records in their tenant" 
ON public.communication_history FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update communication records in their tenant" 
ON public.communication_history FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

-- Create RLS policies for ai_insights
CREATE POLICY "Users can view AI insights in their tenant" 
ON public.ai_insights FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage AI insights in tenant" 
ON public.ai_insights FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- Create RLS policies for follow_up_instances
CREATE POLICY "Users can view follow-up instances in their tenant" 
ON public.follow_up_instances FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage follow-up instances in tenant" 
ON public.follow_up_instances FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- Create indexes for performance
CREATE INDEX idx_tasks_tenant_assigned ON public.tasks(tenant_id, assigned_to);
CREATE INDEX idx_tasks_due_date ON public.tasks(due_date) WHERE status != 'completed';
CREATE INDEX idx_communication_history_contact ON public.communication_history(contact_id, created_at);
CREATE INDEX idx_ai_insights_context ON public.ai_insights(context_type, context_id, status);
CREATE INDEX idx_follow_up_instances_scheduled ON public.follow_up_instances(scheduled_for) WHERE status = 'pending';

-- Create triggers for updated_at timestamps
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_follow_up_campaigns_updated_at
    BEFORE UPDATE ON public.follow_up_campaigns
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_communication_history_updated_at
    BEFORE UPDATE ON public.communication_history
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_ai_insights_updated_at
    BEFORE UPDATE ON public.ai_insights
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_follow_up_instances_updated_at
    BEFORE UPDATE ON public.follow_up_instances
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();