-- ===============================================
-- FULL ESTIMATING SYSTEM DATABASE SCHEMA
-- ===============================================

-- Enhanced Estimate Templates with Advanced Calculations
CREATE TABLE public.estimate_calculation_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  roof_type roof_type NOT NULL,
  template_category TEXT NOT NULL DEFAULT 'standard', -- standard, premium, commercial
  base_material_cost_per_sq DECIMAL(10,2) NOT NULL DEFAULT 0,
  base_labor_hours_per_sq DECIMAL(5,2) NOT NULL DEFAULT 0.5,
  base_labor_rate_per_hour DECIMAL(8,2) NOT NULL DEFAULT 50.00,
  overhead_percentage DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  target_profit_percentage DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  complexity_multipliers JSONB NOT NULL DEFAULT '{
    "simple": 1.0,
    "moderate": 1.2,
    "complex": 1.5,
    "extreme": 2.0
  }'::jsonb,
  seasonal_multipliers JSONB NOT NULL DEFAULT '{
    "spring": 1.05,
    "summer": 1.10,
    "fall": 1.00,
    "winter": 0.95
  }'::jsonb,
  location_multipliers JSONB NOT NULL DEFAULT '{}'::jsonb,
  material_specifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  labor_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enhanced Estimates with Detailed Costing
CREATE TABLE public.enhanced_estimates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  estimate_number TEXT UNIQUE NOT NULL,
  pipeline_entry_id UUID,
  project_id UUID,
  template_id UUID REFERENCES public.estimate_calculation_templates(id),
  
  -- Basic Information
  customer_name TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  property_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Calculation Parameters
  roof_area_sq_ft DECIMAL(10,2) NOT NULL,
  roof_pitch TEXT NOT NULL DEFAULT '4/12',
  complexity_level TEXT NOT NULL DEFAULT 'moderate',
  season TEXT NOT NULL DEFAULT 'spring',
  location_zone TEXT,
  
  -- Material Costs
  material_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  material_markup_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  material_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  
  -- Labor Costs
  labor_hours DECIMAL(8,2) NOT NULL DEFAULT 0,
  labor_rate_per_hour DECIMAL(8,2) NOT NULL DEFAULT 50.00,
  labor_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  labor_markup_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  labor_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  
  -- Overhead Costs
  overhead_percent DECIMAL(5,2) NOT NULL DEFAULT 20.00,
  overhead_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  
  -- Sales Rep Commission
  sales_rep_id UUID,
  sales_rep_commission_percent DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  sales_rep_commission_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  
  -- Company Profit Calculations
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  target_profit_percent DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  target_profit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  actual_profit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  actual_profit_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
  
  -- Final Pricing
  selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  price_per_sq_ft DECIMAL(8,2) NOT NULL DEFAULT 0,
  
  -- Additional Costs
  permit_costs DECIMAL(10,2) NOT NULL DEFAULT 0,
  waste_factor_percent DECIMAL(5,2) NOT NULL DEFAULT 10.00,
  contingency_percent DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  
  -- Line Items Detail
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Estimate Status & Workflow
  status estimate_status NOT NULL DEFAULT 'draft',
  approval_required BOOLEAN NOT NULL DEFAULT false,
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  sent_to_customer_at TIMESTAMP WITH TIME ZONE,
  customer_viewed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE,
  
  -- Metadata
  notes TEXT,
  internal_notes TEXT,
  calculation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Material Cost Database
CREATE TABLE public.material_costs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  material_name TEXT NOT NULL,
  material_category TEXT NOT NULL, -- shingles, underlayment, flashing, etc.
  brand TEXT,
  model TEXT,
  unit_type TEXT NOT NULL DEFAULT 'sq', -- sq, bundle, roll, piece
  cost_per_unit DECIMAL(10,2) NOT NULL,
  current_market_price DECIMAL(10,2) NOT NULL,
  supplier_id UUID,
  lead_time_days INTEGER DEFAULT 7,
  minimum_order_quantity INTEGER DEFAULT 1,
  waste_factor_percent DECIMAL(5,2) DEFAULT 10.00,
  price_valid_until DATE,
  location_specific BOOLEAN DEFAULT false,
  location_zones TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Labor Rate Matrix
CREATE TABLE public.labor_rates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  job_type TEXT NOT NULL, -- removal, installation, cleanup, etc.
  skill_level TEXT NOT NULL DEFAULT 'standard', -- apprentice, standard, expert
  base_rate_per_hour DECIMAL(8,2) NOT NULL,
  location_zone TEXT,
  seasonal_adjustment DECIMAL(5,2) DEFAULT 0.00,
  complexity_multiplier DECIMAL(4,2) DEFAULT 1.00,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expires_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Estimate Line Items Detail
CREATE TABLE public.estimate_line_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  estimate_id UUID NOT NULL REFERENCES public.enhanced_estimates(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  
  -- Item Details
  item_category TEXT NOT NULL, -- material, labor, equipment, permit, other
  item_name TEXT NOT NULL,
  description TEXT,
  
  -- Quantities & Units
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  unit_type TEXT NOT NULL DEFAULT 'each',
  
  -- Costs
  unit_cost DECIMAL(10,2) NOT NULL DEFAULT 0,
  extended_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  markup_percent DECIMAL(5,2) DEFAULT 0,
  markup_amount DECIMAL(10,2) DEFAULT 0,
  total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  
  -- References
  material_id UUID REFERENCES public.material_costs(id),
  labor_rate_id UUID REFERENCES public.labor_rates(id),
  
  -- Metadata
  notes TEXT,
  is_optional BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Sales Rep Commission Tracking
CREATE TABLE public.estimate_commissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  estimate_id UUID NOT NULL REFERENCES public.enhanced_estimates(id),
  sales_rep_id UUID NOT NULL,
  
  -- Commission Calculation
  commission_type TEXT NOT NULL DEFAULT 'percentage', -- percentage, flat_fee, tiered
  commission_rate DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  commission_base_amount DECIMAL(12,2) NOT NULL, -- amount commission is calculated on
  commission_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  
  -- Payment Tracking
  payment_status TEXT NOT NULL DEFAULT 'pending', -- pending, paid, cancelled
  payment_date TIMESTAMP WITH TIME ZONE,
  payment_reference TEXT,
  
  -- Approval Workflow
  approved_by UUID,
  approved_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Project Budget Comparison
CREATE TABLE public.project_budget_actuals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  estimate_id UUID REFERENCES public.enhanced_estimates(id),
  
  -- Budget vs Actual Tracking
  budgeted_material_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  actual_material_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  material_variance DECIMAL(12,2) NOT NULL DEFAULT 0,
  material_variance_percent DECIMAL(8,2) NOT NULL DEFAULT 0,
  
  budgeted_labor_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  actual_labor_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  labor_variance DECIMAL(12,2) NOT NULL DEFAULT 0,
  labor_variance_percent DECIMAL(8,2) NOT NULL DEFAULT 0,
  
  budgeted_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  actual_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_variance DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_variance_percent DECIMAL(8,2) NOT NULL DEFAULT 0,
  
  -- Profit Analysis
  original_profit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  actual_profit_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  profit_variance DECIMAL(12,2) NOT NULL DEFAULT 0,
  
  -- Timeline Tracking
  budget_date DATE NOT NULL DEFAULT CURRENT_DATE,
  completion_date DATE,
  
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Pricing Rules Engine
CREATE TABLE public.dynamic_pricing_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL, -- seasonal, market, competition, demand
  
  -- Conditions
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Actions
  price_adjustment_type TEXT NOT NULL, -- percentage, fixed_amount
  adjustment_value DECIMAL(8,2) NOT NULL,
  max_adjustment_percent DECIMAL(5,2) DEFAULT 50.00,
  
  -- Applicability
  applies_to TEXT NOT NULL DEFAULT 'all', -- all, material, labor, category_specific
  category_filter TEXT[],
  
  -- Validity
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add RLS Policies
ALTER TABLE public.estimate_calculation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enhanced_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_budget_actuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dynamic_pricing_rules ENABLE ROW LEVEL SECURITY;

-- RLS Policies for Estimate Templates
CREATE POLICY "Users can view templates in their tenant" 
ON public.estimate_calculation_templates FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage templates in their tenant" 
ON public.estimate_calculation_templates FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for Enhanced Estimates
CREATE POLICY "Users can view estimates in their tenant" 
ON public.enhanced_estimates FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create estimates in their tenant" 
ON public.enhanced_estimates FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update estimates in their tenant" 
ON public.enhanced_estimates FOR UPDATE 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can delete estimates in their tenant" 
ON public.enhanced_estimates FOR DELETE 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for Material Costs
CREATE POLICY "Users can view material costs in their tenant" 
ON public.material_costs FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage material costs in their tenant" 
ON public.material_costs FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for Labor Rates
CREATE POLICY "Users can view labor rates in their tenant" 
ON public.labor_rates FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage labor rates in their tenant" 
ON public.labor_rates FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for Line Items
CREATE POLICY "Users can manage line items in their tenant" 
ON public.estimate_line_items FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- RLS Policies for Commissions
CREATE POLICY "Users can view commissions in their tenant" 
ON public.estimate_commissions FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage commissions in their tenant" 
ON public.estimate_commissions FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- RLS Policies for Budget Actuals
CREATE POLICY "Users can view budget actuals in their tenant" 
ON public.project_budget_actuals FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage budget actuals in their tenant" 
ON public.project_budget_actuals FOR ALL 
USING (tenant_id = get_user_tenant_id());

-- RLS Policies for Pricing Rules
CREATE POLICY "Users can view pricing rules in their tenant" 
ON public.dynamic_pricing_rules FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage pricing rules in their tenant" 
ON public.dynamic_pricing_rules FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Calculation Functions
CREATE OR REPLACE FUNCTION public.calculate_enhanced_estimate(estimate_id_param UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
    estimate_data RECORD;
    line_items_total DECIMAL(12,2) := 0;
    material_total DECIMAL(12,2) := 0;
    labor_total DECIMAL(12,2) := 0;
    subtotal DECIMAL(12,2) := 0;
    overhead_amount DECIMAL(12,2) := 0;
    commission_amount DECIMAL(12,2) := 0;
    profit_amount DECIMAL(12,2) := 0;
    final_price DECIMAL(12,2) := 0;
    result JSONB;
BEGIN
    -- Get estimate data
    SELECT * INTO estimate_data
    FROM public.enhanced_estimates
    WHERE id = estimate_id_param;
    
    IF estimate_data IS NULL THEN
        RETURN jsonb_build_object('error', 'Estimate not found');
    END IF;
    
    -- Calculate line items total
    SELECT 
        COALESCE(SUM(total_price), 0),
        COALESCE(SUM(CASE WHEN item_category = 'material' THEN total_price ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN item_category = 'labor' THEN total_price ELSE 0 END), 0)
    INTO line_items_total, material_total, labor_total
    FROM public.estimate_line_items
    WHERE estimate_id = estimate_id_param;
    
    -- Calculate subtotal
    subtotal := material_total + labor_total;
    
    -- Calculate overhead
    overhead_amount := subtotal * (estimate_data.overhead_percent / 100);
    
    -- Calculate sales rep commission
    commission_amount := (subtotal + overhead_amount) * (estimate_data.sales_rep_commission_percent / 100);
    
    -- Calculate profit
    profit_amount := (subtotal + overhead_amount + commission_amount) * (estimate_data.target_profit_percent / 100);
    
    -- Final selling price
    final_price := subtotal + overhead_amount + commission_amount + profit_amount + estimate_data.permit_costs;
    
    -- Update the estimate
    UPDATE public.enhanced_estimates SET
        material_total = material_total,
        labor_total = labor_total,
        subtotal = subtotal,
        overhead_amount = overhead_amount,
        sales_rep_commission_amount = commission_amount,
        target_profit_amount = profit_amount,
        actual_profit_amount = profit_amount,
        actual_profit_percent = (profit_amount / final_price) * 100,
        selling_price = final_price,
        price_per_sq_ft = final_price / estimate_data.roof_area_sq_ft,
        updated_at = now()
    WHERE id = estimate_id_param;
    
    -- Build result
    result := jsonb_build_object(
        'estimate_id', estimate_id_param,
        'calculations', jsonb_build_object(
            'material_total', material_total,
            'labor_total', labor_total,
            'subtotal', subtotal,
            'overhead_amount', overhead_amount,
            'commission_amount', commission_amount,
            'profit_amount', profit_amount,
            'selling_price', final_price,
            'price_per_sq_ft', final_price / estimate_data.roof_area_sq_ft
        )
    );
    
    RETURN result;
END;
$$;

-- Triggers for automatic calculations
CREATE OR REPLACE FUNCTION public.recalculate_estimate_on_line_item_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
    -- Recalculate the estimate whenever line items change
    PERFORM calculate_enhanced_estimate(COALESCE(NEW.estimate_id, OLD.estimate_id));
    
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER estimate_line_items_calculation_trigger
    AFTER INSERT OR UPDATE OR DELETE ON public.estimate_line_items
    FOR EACH ROW
    EXECUTE FUNCTION public.recalculate_estimate_on_line_item_change();

-- Add updated_at triggers
CREATE TRIGGER update_estimate_calculation_templates_updated_at
    BEFORE UPDATE ON public.estimate_calculation_templates
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_enhanced_estimates_updated_at
    BEFORE UPDATE ON public.enhanced_estimates
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_material_costs_updated_at
    BEFORE UPDATE ON public.material_costs
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_labor_rates_updated_at
    BEFORE UPDATE ON public.labor_rates
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_estimate_line_items_updated_at
    BEFORE UPDATE ON public.estimate_line_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_project_budget_actuals_updated_at
    BEFORE UPDATE ON public.project_budget_actuals
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();