-- Enhance profiles table for sales rep pay structure
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS overhead_rate numeric(5,2) DEFAULT 5.00,
ADD COLUMN IF NOT EXISTS commission_structure text DEFAULT 'profit_split' CHECK (commission_structure IN ('profit_split', 'sales_percentage')),
ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) DEFAULT 50.00,
ADD COLUMN IF NOT EXISTS pay_structure_created_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS pay_structure_created_at timestamp with time zone DEFAULT now();

-- Add comment to document the new fields
COMMENT ON COLUMN public.profiles.overhead_rate IS 'Rep overhead rate as percentage (5% or 10%) of total selling price';
COMMENT ON COLUMN public.profiles.commission_structure IS 'Type of commission: profit_split or sales_percentage';
COMMENT ON COLUMN public.profiles.commission_rate IS 'Commission rate percentage based on structure type';
COMMENT ON COLUMN public.profiles.pay_structure_created_by IS 'Manager who created this pay structure';

-- Create user_commission_assignments table for tracking assignments
CREATE TABLE IF NOT EXISTS public.user_commission_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  commission_plan_id uuid NOT NULL REFERENCES public.commission_plans(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES auth.users(id),
  assigned_at timestamp with time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, commission_plan_id, tenant_id)
);

-- Enable RLS on the new table
ALTER TABLE public.user_commission_assignments ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for user_commission_assignments
CREATE POLICY "Users can view commission assignments in their tenant"
ON public.user_commission_assignments
FOR SELECT
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Managers can manage commission assignments in their tenant"
ON public.user_commission_assignments
FOR ALL
USING ((tenant_id = get_user_tenant_id()) AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Add trigger for updated_at
CREATE TRIGGER update_user_commission_assignments_updated_at
  BEFORE UPDATE ON public.user_commission_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Update commission_plans table to support the new structure types
ALTER TABLE public.commission_plans 
DROP CONSTRAINT IF EXISTS commission_plans_commission_type_check;

-- Create improved enum for commission types that matches our new structure
DO $$ BEGIN
    CREATE TYPE commission_structure_type AS ENUM ('profit_split', 'sales_percentage', 'tiered', 'flat_rate');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Update commission_plans table structure
ALTER TABLE public.commission_plans 
ALTER COLUMN commission_type TYPE text,
ADD COLUMN IF NOT EXISTS structure_type commission_structure_type DEFAULT 'profit_split',
ADD COLUMN IF NOT EXISTS base_rate numeric(5,2) DEFAULT 50.00,
ADD COLUMN IF NOT EXISTS overhead_included boolean DEFAULT false;

-- Function to auto-create commission plan for new sales reps
CREATE OR REPLACE FUNCTION public.auto_create_rep_commission_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_plan_id uuid;
    plan_name text;
BEGIN
    -- Only create commission plan for sales reps/admins with commission structure
    IF NEW.role IN ('admin', 'manager') AND NEW.commission_structure IS NOT NULL THEN
        plan_name := COALESCE(NEW.first_name || ' ' || NEW.last_name, 'Rep') || ' Commission Plan';
        
        -- Create commission plan
        INSERT INTO public.commission_plans (
            tenant_id,
            name,
            commission_type,
            structure_type,
            plan_config,
            payment_method,
            base_rate,
            overhead_included,
            is_active,
            created_by
        ) VALUES (
            NEW.tenant_id,
            plan_name,
            NEW.commission_structure,
            NEW.commission_structure::commission_structure_type,
            jsonb_build_object(
                'commission_rate', NEW.commission_rate,
                'overhead_rate', NEW.overhead_rate,
                'structure_type', NEW.commission_structure
            ),
            CASE 
                WHEN NEW.commission_structure = 'profit_split' THEN 'commission_after_costs'
                ELSE 'percentage_selling_price'
            END,
            NEW.commission_rate,
            CASE WHEN NEW.commission_structure = 'profit_split' THEN true ELSE false END,
            true,
            NEW.pay_structure_created_by
        ) RETURNING id INTO new_plan_id;
        
        -- Link the user to their commission plan
        INSERT INTO public.user_commission_assignments (
            tenant_id,
            user_id,
            commission_plan_id,
            assigned_by,
            notes
        ) VALUES (
            NEW.tenant_id,
            NEW.id,
            new_plan_id,
            NEW.pay_structure_created_by,
            'Auto-assigned commission plan for ' || NEW.commission_structure || ' structure'
        );
    END IF;
    
    RETURN NEW;
END;
$$;

-- Create trigger for auto-creating commission plans
DROP TRIGGER IF EXISTS auto_create_rep_commission_plan_trigger ON public.profiles;
CREATE TRIGGER auto_create_rep_commission_plan_trigger
    AFTER INSERT ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_create_rep_commission_plan();

-- Enhanced commission calculation function
CREATE OR REPLACE FUNCTION public.calculate_enhanced_rep_commission(
    project_id_param uuid, 
    sales_rep_id_param uuid
)
RETURNS jsonb
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
    commission_amount NUMERIC := 0;
    gross_profit NUMERIC := 0;
    net_profit NUMERIC := 0;
    company_profit NUMERIC := 0;
    result JSONB;
BEGIN
    -- Get project details with selling price
    SELECT * INTO project_record
    FROM public.projects p
    LEFT JOIN public.estimates e ON e.project_id = p.id
    WHERE p.id = project_id_param;
    
    IF project_record IS NULL THEN
        RETURN jsonb_build_object('error', 'Project not found');
    END IF;
    
    -- Get sales rep profile with pay structure
    SELECT * INTO rep_profile
    FROM public.profiles
    WHERE id = sales_rep_id_param;
    
    IF rep_profile IS NULL THEN
        RETURN jsonb_build_object('error', 'Sales representative not found');
    END IF;
    
    -- Get active commission plan for the rep
    SELECT cp.* INTO commission_plan
    FROM public.commission_plans cp
    INNER JOIN public.user_commission_assignments uca ON uca.commission_plan_id = cp.id
    WHERE uca.user_id = sales_rep_id_param 
    AND uca.is_active = true
    AND cp.is_active = true
    ORDER BY uca.assigned_at DESC
    LIMIT 1;
    
    -- Calculate values
    contract_value := COALESCE(project_record.selling_price, 0);
    
    -- Calculate total costs from project_costs
    SELECT COALESCE(SUM(total_cost), 0) INTO total_costs
    FROM public.project_costs
    WHERE project_id = project_id_param;
    
    -- Calculate rep overhead based on their rate
    rep_overhead := contract_value * (COALESCE(rep_profile.overhead_rate, 5.00) / 100);
    
    -- Calculate gross and net profit
    gross_profit := contract_value - total_costs;
    net_profit := gross_profit - rep_overhead;
    
    -- Calculate commission based on structure type
    IF commission_plan IS NOT NULL THEN
        IF rep_profile.commission_structure = 'profit_split' THEN
            commission_amount := net_profit * (rep_profile.commission_rate / 100);
        ELSIF rep_profile.commission_structure = 'sales_percentage' THEN
            commission_amount := contract_value * (rep_profile.commission_rate / 100);
        END IF;
    END IF;
    
    -- Calculate company profit after commission
    company_profit := net_profit - commission_amount;
    
    -- Build comprehensive result
    result := jsonb_build_object(
        'project_id', project_id_param,
        'sales_rep_id', sales_rep_id_param,
        'contract_value', contract_value,
        'total_costs', total_costs,
        'gross_profit', gross_profit,
        'rep_overhead', rep_overhead,
        'rep_overhead_rate', rep_profile.overhead_rate,
        'net_profit', net_profit,
        'commission_structure', rep_profile.commission_structure,
        'commission_rate', rep_profile.commission_rate,
        'commission_amount', commission_amount,
        'company_profit', company_profit,
        'profit_margin_percent', CASE WHEN contract_value > 0 THEN (net_profit / contract_value) * 100 ELSE 0 END,
        'commission_plan_id', commission_plan.id,
        'calculation_details', jsonb_build_object(
            'commission_plan_name', commission_plan.name,
            'rep_name', rep_profile.first_name || ' ' || rep_profile.last_name,
            'structure_explanation', CASE 
                WHEN rep_profile.commission_structure = 'profit_split' 
                THEN 'Commission calculated as ' || rep_profile.commission_rate || '% of net profit after costs and overhead'
                ELSE 'Commission calculated as ' || rep_profile.commission_rate || '% of total contract value'
            END,
            'calculated_at', now()
        )
    );
    
    RETURN result;
END;
$$;