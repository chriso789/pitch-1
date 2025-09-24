-- Create nurturing campaigns table
CREATE TABLE public.nurturing_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name text NOT NULL,
  description text,
  trigger_type text NOT NULL, -- 'lead_score', 'status_change', 'time_based', 'behavior'
  trigger_conditions jsonb NOT NULL DEFAULT '{}',
  target_audience jsonb NOT NULL DEFAULT '{}', -- conditions for who gets enrolled
  is_active boolean DEFAULT true,
  priority integer DEFAULT 0,
  total_enrolled integer DEFAULT 0,
  total_completed integer DEFAULT 0,
  conversion_rate numeric(5,2) DEFAULT 0.00,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.nurturing_campaigns ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view nurturing campaigns in their tenant" 
ON public.nurturing_campaigns 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage nurturing campaigns in their tenant" 
ON public.nurturing_campaigns 
FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create campaign steps table
CREATE TABLE public.nurturing_campaign_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.nurturing_campaigns(id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  step_name text NOT NULL,
  step_type text NOT NULL, -- 'email', 'sms', 'call_reminder', 'task', 'wait'
  delay_hours integer NOT NULL DEFAULT 0, -- hours after previous step
  content_template text,
  content_variables jsonb DEFAULT '{}',
  conditions jsonb DEFAULT '{}', -- conditions to execute this step
  is_active boolean DEFAULT true,
  success_count integer DEFAULT 0,
  failure_count integer DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.nurturing_campaign_steps ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view campaign steps in their tenant" 
ON public.nurturing_campaign_steps 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage campaign steps in their tenant" 
ON public.nurturing_campaign_steps 
FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create campaign enrollments table
CREATE TABLE public.nurturing_enrollments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.nurturing_campaigns(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  current_step_id UUID REFERENCES public.nurturing_campaign_steps(id),
  enrollment_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active', -- 'active', 'completed', 'paused', 'opted_out'
  completion_date TIMESTAMP WITH TIME ZONE,
  next_action_date TIMESTAMP WITH TIME ZONE,
  total_steps_completed integer DEFAULT 0,
  converted boolean DEFAULT false,
  conversion_date TIMESTAMP WITH TIME ZONE,
  metadata jsonb DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.nurturing_enrollments ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view enrollments in their tenant" 
ON public.nurturing_enrollments 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage enrollments in tenant" 
ON public.nurturing_enrollments 
FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Create step execution log table
CREATE TABLE public.nurturing_step_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  enrollment_id UUID REFERENCES public.nurturing_enrollments(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.nurturing_campaign_steps(id) ON DELETE CASCADE,
  executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'opened', 'clicked', 'failed'
  response_data jsonb DEFAULT '{}',
  error_message text,
  retry_count integer DEFAULT 0,
  scheduled_for TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.nurturing_step_executions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view step executions in their tenant" 
ON public.nurturing_step_executions 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage step executions in tenant" 
ON public.nurturing_step_executions 
FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Create message templates table
CREATE TABLE public.message_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name text NOT NULL,
  template_type text NOT NULL, -- 'email', 'sms', 'call_script'
  subject text, -- for emails
  content text NOT NULL,
  variables jsonb DEFAULT '[]', -- available template variables
  category text, -- 'welcome', 'follow_up', 'reminder', 'promotion'
  is_system_template boolean DEFAULT false,
  usage_count integer DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view message templates in their tenant" 
ON public.message_templates 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage message templates in their tenant" 
ON public.message_templates 
FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Add nurturing fields to contacts table
ALTER TABLE public.contacts 
ADD COLUMN nurturing_status text DEFAULT 'not_enrolled', -- 'not_enrolled', 'enrolled', 'completed', 'opted_out'
ADD COLUMN last_nurturing_activity TIMESTAMP WITH TIME ZONE,
ADD COLUMN total_campaigns_completed integer DEFAULT 0,
ADD COLUMN email_engagement_score numeric(5,2) DEFAULT 0.00;

-- Add triggers for updated_at
CREATE TRIGGER update_nurturing_campaigns_updated_at
BEFORE UPDATE ON public.nurturing_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_nurturing_campaign_steps_updated_at
BEFORE UPDATE ON public.nurturing_campaign_steps
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_nurturing_enrollments_updated_at
BEFORE UPDATE ON public.nurturing_enrollments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_message_templates_updated_at
BEFORE UPDATE ON public.message_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to check enrollment eligibility
CREATE OR REPLACE FUNCTION public.check_enrollment_eligibility(
  contact_data jsonb, 
  campaign_conditions jsonb
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    condition RECORD;
    field_value text;
    condition_met boolean := true;
BEGIN
    -- Loop through all conditions in the campaign
    FOR condition IN SELECT * FROM jsonb_to_recordset(campaign_conditions) AS x(
        field_name text, 
        operator text, 
        value text, 
        logic text
    ) LOOP
        field_value := contact_data ->> condition.field_name;
        
        -- Evaluate each condition
        CASE condition.operator
            WHEN 'equals' THEN
                IF field_value != condition.value THEN
                    condition_met := false;
                END IF;
            WHEN 'not_equals' THEN
                IF field_value = condition.value THEN
                    condition_met := false;
                END IF;
            WHEN 'greater_than' THEN
                IF (field_value::numeric) <= (condition.value::numeric) THEN
                    condition_met := false;
                END IF;
            WHEN 'less_than' THEN
                IF (field_value::numeric) >= (condition.value::numeric) THEN
                    condition_met := false;
                END IF;
            WHEN 'contains' THEN
                IF field_value NOT ILIKE '%' || condition.value || '%' THEN
                    condition_met := false;
                END IF;
            ELSE
                -- Unknown operator, skip condition
                NULL;
        END CASE;
        
        -- If any condition fails and we're using AND logic, return false
        IF NOT condition_met AND (condition.logic = 'AND' OR condition.logic IS NULL) THEN
            RETURN false;
        END IF;
    END LOOP;
    
    RETURN condition_met;
END;
$$;