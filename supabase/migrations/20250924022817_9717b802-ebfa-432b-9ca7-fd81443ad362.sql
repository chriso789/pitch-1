-- Add lead source tracking to contacts and pipeline entries
ALTER TABLE public.contacts 
ADD COLUMN lead_source text,
ADD COLUMN lead_source_details jsonb DEFAULT '{}',
ADD COLUMN acquisition_cost numeric(10,2) DEFAULT 0,
ADD COLUMN referral_source text;

ALTER TABLE public.pipeline_entries
ADD COLUMN marketing_campaign text,
ADD COLUMN lead_quality_score integer DEFAULT 50,
ADD COLUMN conversion_probability numeric(5,2) DEFAULT 50.00;

-- Create lead sources management table
CREATE TABLE public.lead_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name text NOT NULL,
  category text NOT NULL, -- 'online', 'referral', 'direct', 'advertising', 'social'
  description text,
  default_acquisition_cost numeric(10,2) DEFAULT 0,
  tracking_url text,
  is_active boolean DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view lead sources in their tenant" 
ON public.lead_sources 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage lead sources in their tenant" 
ON public.lead_sources 
FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create lead source performance tracking
CREATE TABLE public.lead_source_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  lead_source_id UUID REFERENCES public.lead_sources(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  leads_generated integer DEFAULT 0,
  qualified_leads integer DEFAULT 0,
  appointments_set integer DEFAULT 0,
  estimates_created integer DEFAULT 0,
  deals_closed integer DEFAULT 0,
  total_revenue numeric(12,2) DEFAULT 0,
  total_cost numeric(10,2) DEFAULT 0,
  roi_percent numeric(8,4) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.lead_source_performance ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view performance data in their tenant" 
ON public.lead_source_performance 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage performance data in tenant" 
ON public.lead_source_performance 
FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Add trigger for updated_at
CREATE TRIGGER update_lead_sources_updated_at
BEFORE UPDATE ON public.lead_sources
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lead_source_performance_updated_at
BEFORE UPDATE ON public.lead_source_performance
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();