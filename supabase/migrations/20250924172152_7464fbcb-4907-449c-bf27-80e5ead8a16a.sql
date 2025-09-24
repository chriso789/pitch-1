-- Step 2 & 3: Enhanced Budget Tracking and Representative Commission Structures (Fixed)

-- Add budget tracking fields to projects table
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS budget_file_path TEXT;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS budget_data JSONB DEFAULT '{}';
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS budget_variance_alerts BOOLEAN DEFAULT true;

-- Add representative-specific overhead to profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS personal_overhead_rate NUMERIC(5,2) DEFAULT 0.00;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pay_structure_display JSONB DEFAULT '{}';

-- Extend commission_plans table with overhead functionality
ALTER TABLE public.commission_plans ADD COLUMN IF NOT EXISTS include_overhead BOOLEAN DEFAULT false;
ALTER TABLE public.commission_plans ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'percentage_selling_price' CHECK (payment_method IN ('percentage_selling_price', 'commission_after_costs'));

-- Create project budget items table for detailed budget tracking (fixed structure)
CREATE TABLE IF NOT EXISTS public.project_budget_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- material, labor, overhead, equipment, permits
    item_name TEXT NOT NULL,
    description TEXT,
    budgeted_quantity NUMERIC DEFAULT 0,
    budgeted_unit_cost NUMERIC DEFAULT 0,
    budgeted_total_cost NUMERIC DEFAULT 0,
    actual_quantity NUMERIC DEFAULT 0,
    actual_unit_cost NUMERIC DEFAULT 0,
    actual_total_cost NUMERIC DEFAULT 0,
    variance_amount NUMERIC DEFAULT 0,
    variance_percent NUMERIC DEFAULT 0,
    vendor_name TEXT,
    purchase_order_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_by UUID
);

-- Enable RLS on project_budget_items
ALTER TABLE public.project_budget_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for project_budget_items
CREATE POLICY "Users can manage budget items in their tenant"
ON public.project_budget_items FOR ALL
USING (tenant_id = get_user_tenant_id());

-- Create commission calculations table
CREATE TABLE IF NOT EXISTS public.commission_calculations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    sales_rep_id UUID NOT NULL REFERENCES public.profiles(id),
    commission_plan_id UUID REFERENCES public.commission_plans(id),
    contract_value NUMERIC NOT NULL DEFAULT 0,
    total_costs NUMERIC NOT NULL DEFAULT 0,
    rep_overhead NUMERIC NOT NULL DEFAULT 0,
    commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    commission_amount NUMERIC NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'percentage_selling_price',
    calculation_details JSONB DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    approved_at TIMESTAMP WITH TIME ZONE,
    paid_at TIMESTAMP WITH TIME ZONE,
    created_by UUID
);

-- Enable RLS on commission_calculations
ALTER TABLE public.commission_calculations ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for commission_calculations
CREATE POLICY "Users can view commission calculations in their tenant"
ON public.commission_calculations FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage commission calculations in their tenant"
ON public.commission_calculations FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create function to update budget calculations
CREATE OR REPLACE FUNCTION public.update_budget_calculations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Calculate budgeted total cost
    NEW.budgeted_total_cost := NEW.budgeted_quantity * NEW.budgeted_unit_cost;
    
    -- Calculate actual total cost
    NEW.actual_total_cost := NEW.actual_quantity * NEW.actual_unit_cost;
    
    -- Calculate variance amount
    NEW.variance_amount := NEW.actual_total_cost - NEW.budgeted_total_cost;
    
    -- Calculate variance percent
    IF NEW.budgeted_total_cost > 0 THEN
        NEW.variance_percent := (NEW.variance_amount / NEW.budgeted_total_cost) * 100;
    ELSE
        NEW.variance_percent := 0;
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger for budget calculations
CREATE TRIGGER update_budget_calculations_trigger
    BEFORE INSERT OR UPDATE ON public.project_budget_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_budget_calculations();

-- Create function to calculate representative commission
CREATE OR REPLACE FUNCTION public.calculate_rep_commission(
    project_id_param UUID,
    sales_rep_id_param UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    project_record RECORD;
    rep_profile RECORD;
    commission_plan RECORD;
    contract_value NUMERIC := 0;
    total_costs NUMERIC := 0;
    rep_overhead NUMERIC := 0;
    commission_rate NUMERIC := 0;
    commission_amount NUMERIC := 0;
    net_profit NUMERIC := 0;
    result JSONB;
BEGIN
    -- Get project details
    SELECT * INTO project_record
    FROM public.projects p
    LEFT JOIN public.estimates e ON e.project_id = p.id
    WHERE p.id = project_id_param;
    
    IF project_record IS NULL THEN
        RETURN jsonb_build_object('error', 'Project not found');
    END IF;
    
    -- Get sales rep profile
    SELECT * INTO rep_profile
    FROM public.profiles
    WHERE id = sales_rep_id_param;
    
    IF rep_profile IS NULL THEN
        RETURN jsonb_build_object('error', 'Sales representative not found');
    END IF;
    
    -- Get commission plan for the rep
    SELECT * INTO commission_plan
    FROM public.commission_plans cp
    INNER JOIN public.profiles p ON p.tenant_id = cp.tenant_id
    WHERE p.id = sales_rep_id_param 
    AND cp.is_active = true
    ORDER BY cp.created_at DESC
    LIMIT 1;
    
    -- Calculate values
    contract_value := COALESCE(project_record.selling_price, 0);
    
    -- Calculate total costs from project_costs and budget items
    SELECT COALESCE(SUM(total_cost), 0) INTO total_costs
    FROM public.project_costs
    WHERE project_id = project_id_param;
    
    -- Add rep personal overhead
    rep_overhead := contract_value * (COALESCE(rep_profile.personal_overhead_rate, 0) / 100);
    
    -- Calculate based on payment method
    IF commission_plan IS NOT NULL THEN
        commission_rate := (commission_plan.plan_config->>'commission_rate')::NUMERIC;
        
        IF commission_plan.payment_method = 'percentage_selling_price' THEN
            commission_amount := contract_value * (commission_rate / 100);
        ELSIF commission_plan.payment_method = 'commission_after_costs' THEN
            net_profit := contract_value - total_costs - rep_overhead;
            commission_amount := net_profit * (commission_rate / 100);
        END IF;
    END IF;
    
    -- Build result
    result := jsonb_build_object(
        'project_id', project_id_param,
        'sales_rep_id', sales_rep_id_param,
        'contract_value', contract_value,
        'total_costs', total_costs,
        'rep_overhead', rep_overhead,
        'net_profit', net_profit,
        'commission_rate', commission_rate,
        'commission_amount', commission_amount,
        'payment_method', COALESCE(commission_plan.payment_method, 'percentage_selling_price'),
        'calculation_details', jsonb_build_object(
            'commission_plan_id', commission_plan.id,
            'commission_plan_name', commission_plan.name,
            'rep_name', rep_profile.first_name || ' ' || rep_profile.last_name,
            'calculated_at', now()
        )
    );
    
    RETURN result;
END;
$$;

-- Create function to update budget variance alerts
CREATE OR REPLACE FUNCTION public.check_budget_variance_alerts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    variance_threshold NUMERIC := 10.0; -- 10% variance threshold
    project_record RECORD;
BEGIN
    -- Only check if actual costs changed significantly
    IF TG_OP = 'UPDATE' AND ABS(OLD.actual_total_cost - NEW.actual_total_cost) < 100 THEN
        RETURN NEW;
    END IF;
    
    -- Get project info
    SELECT * INTO project_record
    FROM public.projects
    WHERE id = NEW.project_id;
    
    -- Check if variance exceeds threshold and alerts are enabled
    IF project_record.budget_variance_alerts AND ABS(NEW.variance_percent) > variance_threshold THEN
        -- Insert AI insight for budget variance alert
        INSERT INTO public.ai_insights (
            tenant_id,
            context_type,
            context_id,
            insight_type,
            title,
            description,
            priority,
            metadata
        ) VALUES (
            NEW.tenant_id,
            'project',
            NEW.project_id,
            'budget_variance',
            'Budget Variance Alert',
            'Budget item "' || NEW.item_name || '" has a variance of ' || 
            ROUND(NEW.variance_percent, 1) || '% (' || 
            CASE WHEN NEW.variance_amount > 0 THEN '+$' ELSE '-$' END ||
            ABS(NEW.variance_amount) || ')',
            CASE 
                WHEN ABS(NEW.variance_percent) > 25 THEN 'high'
                WHEN ABS(NEW.variance_percent) > 15 THEN 'medium'
                ELSE 'low'
            END,
            jsonb_build_object(
                'budget_item_id', NEW.id,
                'variance_amount', NEW.variance_amount,
                'variance_percent', NEW.variance_percent,
                'budgeted_cost', NEW.budgeted_total_cost,
                'actual_cost', NEW.actual_total_cost
            )
        );
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger for budget variance alerts
CREATE TRIGGER budget_variance_alert_trigger
    AFTER INSERT OR UPDATE ON public.project_budget_items
    FOR EACH ROW
    EXECUTE FUNCTION public.check_budget_variance_alerts();

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_project_budget_items_project_id ON public.project_budget_items(project_id);
CREATE INDEX IF NOT EXISTS idx_project_budget_items_category ON public.project_budget_items(category);
CREATE INDEX IF NOT EXISTS idx_commission_calculations_project_id ON public.commission_calculations(project_id);
CREATE INDEX IF NOT EXISTS idx_commission_calculations_sales_rep_id ON public.commission_calculations(sales_rep_id);

-- Add updated_at trigger to project_budget_items
CREATE TRIGGER update_project_budget_items_updated_at
    BEFORE UPDATE ON public.project_budget_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();