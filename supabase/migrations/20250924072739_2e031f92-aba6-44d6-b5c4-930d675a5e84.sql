-- Create dynamic pricing configuration table
CREATE TABLE public.dynamic_pricing_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  min_margin_percent DECIMAL(5,2) NOT NULL DEFAULT 15.00,
  max_margin_percent DECIMAL(5,2) NOT NULL DEFAULT 50.00,
  base_markup_percent DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  weather_risk_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.15,
  backlog_multiplier DECIMAL(3,2) NOT NULL DEFAULT 1.10,
  season_multipliers JSONB NOT NULL DEFAULT '{"spring": 1.05, "summer": 1.10, "fall": 1.00, "winter": 0.95}',
  zip_conversion_rates JSONB NOT NULL DEFAULT '{}',
  vendor_leadtime_multipliers JSONB NOT NULL DEFAULT '{}',
  price_anomaly_threshold_percent DECIMAL(5,2) NOT NULL DEFAULT 25.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.dynamic_pricing_config ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can manage pricing config in their tenant" 
ON public.dynamic_pricing_config 
FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

CREATE POLICY "Users can view pricing config in their tenant" 
ON public.dynamic_pricing_config 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

-- Create pricing calculations log table
CREATE TABLE public.pricing_calculations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  estimate_id UUID,
  base_cost DECIMAL(10,2) NOT NULL,
  labor_cost DECIMAL(10,2) NOT NULL,
  zip_code TEXT,
  season TEXT NOT NULL,
  weather_risk_score DECIMAL(3,2),
  backlog_days INTEGER,
  vendor_leadtime_days INTEGER,
  conversion_rate_percent DECIMAL(5,2),
  base_markup_percent DECIMAL(5,2) NOT NULL,
  weather_adjustment DECIMAL(5,2) DEFAULT 0.00,
  backlog_adjustment DECIMAL(5,2) DEFAULT 0.00,
  season_adjustment DECIMAL(5,2) DEFAULT 0.00,
  leadtime_adjustment DECIMAL(5,2) DEFAULT 0.00,
  final_markup_percent DECIMAL(5,2) NOT NULL,
  suggested_price DECIMAL(10,2) NOT NULL,
  rationale JSONB NOT NULL DEFAULT '{}',
  is_locked BOOLEAN NOT NULL DEFAULT false,
  weather_data JSONB,
  calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  calculated_by UUID
);

-- Enable RLS
ALTER TABLE public.pricing_calculations ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can manage pricing calculations in their tenant" 
ON public.pricing_calculations 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view pricing calculations in their tenant" 
ON public.pricing_calculations 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

-- Create weather cache table
CREATE TABLE public.weather_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  zip_code TEXT NOT NULL,
  weather_data JSONB NOT NULL,
  risk_score DECIMAL(3,2) NOT NULL,
  cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '6 hours'),
  UNIQUE(tenant_id, zip_code)
);

-- Enable RLS
ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "System can manage weather cache in tenant" 
ON public.weather_cache 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- Create indexes for performance
CREATE INDEX idx_dynamic_pricing_config_tenant ON public.dynamic_pricing_config(tenant_id);
CREATE INDEX idx_pricing_calculations_tenant ON public.pricing_calculations(tenant_id);
CREATE INDEX idx_pricing_calculations_estimate ON public.pricing_calculations(estimate_id);
CREATE INDEX idx_weather_cache_zip_tenant ON public.weather_cache(tenant_id, zip_code);
CREATE INDEX idx_weather_cache_expires ON public.weather_cache(expires_at);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_dynamic_pricing_config_updated_at
  BEFORE UPDATE ON public.dynamic_pricing_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default configuration for each tenant
INSERT INTO public.dynamic_pricing_config (tenant_id, created_by)
SELECT DISTINCT tenant_id, NULL::UUID
FROM public.profiles
WHERE tenant_id IS NOT NULL
ON CONFLICT DO NOTHING;