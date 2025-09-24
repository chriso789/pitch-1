-- Notification Automation System (Fixed)
-- Create tables for automated notifications with smart word replacements

-- Notification templates with smart word support
CREATE TABLE IF NOT EXISTS public.notification_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    template_type TEXT NOT NULL, -- email, sms, in_app
    recipient_type TEXT NOT NULL, -- homeowner, sales_rep, manager, admin
    subject TEXT, -- For email templates
    content TEXT NOT NULL, -- Template content with smart words
    smart_words JSONB DEFAULT '{}', -- Available smart words for this template
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Automation rules that trigger notifications
CREATE TABLE IF NOT EXISTS public.automation_rules (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    trigger_event TEXT NOT NULL, -- payment_completed, status_changed, material_ordered, etc.
    trigger_conditions JSONB DEFAULT '{}', -- Conditions that must be met
    template_id UUID REFERENCES public.notification_templates(id) ON DELETE CASCADE,
    recipient_rules JSONB DEFAULT '{}', -- Rules for determining recipients
    delay_minutes INTEGER DEFAULT 0, -- Delay before sending
    is_active BOOLEAN DEFAULT true,
    execution_count INTEGER DEFAULT 0,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Log of automated notification executions
CREATE TABLE IF NOT EXISTS public.notification_executions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    automation_rule_id UUID REFERENCES public.automation_rules(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.notification_templates(id) ON DELETE SET NULL,
    recipient_type TEXT NOT NULL,
    recipient_email TEXT,
    recipient_phone TEXT,
    trigger_event TEXT NOT NULL,
    trigger_data JSONB DEFAULT '{}',
    rendered_content TEXT, -- Final content after smart word replacement
    status TEXT DEFAULT 'pending', -- pending, sent, failed, cancelled
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    scheduled_for TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Smart word definitions and their data sources
CREATE TABLE IF NOT EXISTS public.smart_word_definitions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    word_key TEXT NOT NULL, -- e.g., customer_name, project_address, payment_amount
    display_name TEXT NOT NULL, -- e.g., "Customer Name", "Project Address"
    description TEXT,
    data_source TEXT NOT NULL, -- contacts, projects, payments, estimates
    data_field TEXT NOT NULL, -- field name in the source table
    format_type TEXT DEFAULT 'text', -- text, currency, date, phone
    is_system BOOLEAN DEFAULT false, -- System-defined vs custom
    category TEXT DEFAULT 'general', -- general, customer, project, payment, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_word_definitions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view notification templates in their tenant" 
ON public.notification_templates FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage notification templates in their tenant" 
ON public.notification_templates FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

CREATE POLICY "Users can view automation rules in their tenant" 
ON public.automation_rules FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage automation rules in their tenant" 
ON public.automation_rules FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

CREATE POLICY "Users can view notification executions in their tenant" 
ON public.notification_executions FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage notification executions in tenant" 
ON public.notification_executions FOR ALL 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view smart word definitions in their tenant" 
ON public.smart_word_definitions FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage smart word definitions in their tenant" 
ON public.smart_word_definitions FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Update triggers
CREATE TRIGGER update_notification_templates_updated_at
BEFORE UPDATE ON public.notification_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_automation_rules_updated_at
BEFORE UPDATE ON public.automation_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function to process smart words in templates
CREATE OR REPLACE FUNCTION public.process_smart_words(
    template_content TEXT,
    context_data JSONB,
    tenant_id_param UUID
) RETURNS TEXT AS $$
DECLARE
    result_content TEXT := template_content;
    smart_word RECORD;
    replacement_value TEXT;
BEGIN
    -- Loop through all smart word definitions for the tenant
    FOR smart_word IN 
        SELECT * FROM public.smart_word_definitions 
        WHERE tenant_id = tenant_id_param 
    LOOP
        -- Check if the smart word exists in the template
        IF result_content LIKE '%{' || smart_word.word_key || '}%' THEN
            -- Extract the value from context_data based on data_source and data_field
            replacement_value := context_data ->> smart_word.word_key;
            
            -- If no value found, use empty string
            IF replacement_value IS NULL THEN
                replacement_value := '';
            END IF;
            
            -- Apply formatting based on format_type
            CASE smart_word.format_type
                WHEN 'currency' THEN
                    replacement_value := '$' || COALESCE(replacement_value::NUMERIC, 0)::TEXT;
                WHEN 'date' THEN
                    IF replacement_value != '' THEN
                        replacement_value := TO_CHAR(replacement_value::DATE, 'MM/DD/YYYY');
                    END IF;
                WHEN 'phone' THEN
                    -- Format phone number
                    IF LENGTH(replacement_value) = 10 THEN
                        replacement_value := '(' || SUBSTRING(replacement_value, 1, 3) || ') ' || 
                                          SUBSTRING(replacement_value, 4, 3) || '-' || 
                                          SUBSTRING(replacement_value, 7, 4);
                    END IF;
                ELSE
                    -- Default text formatting - no changes needed
                    NULL;
            END CASE;
            
            -- Replace the smart word in the template
            result_content := REPLACE(result_content, '{' || smart_word.word_key || '}', replacement_value);
        END IF;
    END LOOP;
    
    RETURN result_content;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;