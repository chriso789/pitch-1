-- Create lead scoring rules table
CREATE TABLE public.lead_scoring_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  rule_name text NOT NULL,
  rule_type text NOT NULL, -- 'demographic', 'behavioral', 'property', 'source'
  field_name text NOT NULL,
  condition_type text NOT NULL, -- 'equals', 'contains', 'greater_than', 'less_than', 'range'
  condition_value jsonb NOT NULL DEFAULT '{}',
  points integer NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_scoring_rules ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view scoring rules in their tenant" 
ON public.lead_scoring_rules 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage scoring rules in their tenant" 
ON public.lead_scoring_rules 
FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create lead qualification statuses table
CREATE TABLE public.lead_qualification_statuses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name text NOT NULL,
  min_score integer NOT NULL DEFAULT 0,
  max_score integer NOT NULL DEFAULT 100,
  color text DEFAULT '#6b7280',
  priority integer NOT NULL DEFAULT 0,
  auto_assign boolean DEFAULT false,
  default_assigned_user UUID,
  is_active boolean DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_qualification_statuses ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view qualification statuses in their tenant" 
ON public.lead_qualification_statuses 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage qualification statuses in their tenant" 
ON public.lead_qualification_statuses 
FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Add lead scoring fields to contacts table
ALTER TABLE public.contacts 
ADD COLUMN lead_score integer DEFAULT 0,
ADD COLUMN qualification_status text DEFAULT 'unqualified',
ADD COLUMN last_scored_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN scoring_details jsonb DEFAULT '{}';

-- Add lead quality fields to pipeline_entries
ALTER TABLE public.pipeline_entries
ADD COLUMN lead_temperature text DEFAULT 'cold', -- 'hot', 'warm', 'cold'
ADD COLUMN qualification_notes text,
ADD COLUMN disqualification_reason text;

-- Create lead scoring history table for tracking score changes
CREATE TABLE public.lead_scoring_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  contact_id UUID REFERENCES public.contacts(id) ON DELETE CASCADE,
  old_score integer DEFAULT 0,
  new_score integer DEFAULT 0,
  score_change integer DEFAULT 0,
  rule_applied text,
  reason text,
  scored_by UUID,
  scored_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_scoring_history ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view scoring history in their tenant" 
ON public.lead_scoring_history 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage scoring history in tenant" 
ON public.lead_scoring_history 
FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Add triggers for updated_at
CREATE TRIGGER update_lead_scoring_rules_updated_at
BEFORE UPDATE ON public.lead_scoring_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lead_qualification_statuses_updated_at
BEFORE UPDATE ON public.lead_qualification_statuses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to calculate lead score
CREATE OR REPLACE FUNCTION public.calculate_lead_score(contact_data jsonb, tenant_id_param UUID)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    total_score integer := 0;
    rule_record RECORD;
    field_value text;
    condition_met boolean;
BEGIN
    -- Loop through all active scoring rules for the tenant
    FOR rule_record IN 
        SELECT * FROM public.lead_scoring_rules 
        WHERE tenant_id = tenant_id_param AND is_active = true
    LOOP
        condition_met := false;
        field_value := contact_data ->> rule_record.field_name;
        
        -- Evaluate condition based on rule type
        CASE rule_record.condition_type
            WHEN 'equals' THEN
                condition_met := field_value = (rule_record.condition_value ->> 'value');
            WHEN 'contains' THEN
                condition_met := field_value ILIKE '%' || (rule_record.condition_value ->> 'value') || '%';
            WHEN 'greater_than' THEN
                condition_met := (field_value::numeric) > (rule_record.condition_value ->> 'value')::numeric;
            WHEN 'less_than' THEN
                condition_met := (field_value::numeric) < (rule_record.condition_value ->> 'value')::numeric;
            WHEN 'range' THEN
                condition_met := (field_value::numeric) BETWEEN 
                    (rule_record.condition_value ->> 'min')::numeric AND 
                    (rule_record.condition_value ->> 'max')::numeric;
            ELSE
                condition_met := false;
        END CASE;
        
        -- Add points if condition is met
        IF condition_met THEN
            total_score := total_score + rule_record.points;
        END IF;
    END LOOP;
    
    -- Ensure score is within bounds (0-100)
    total_score := GREATEST(0, LEAST(100, total_score));
    
    RETURN total_score;
END;
$$;