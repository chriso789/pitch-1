-- Fix the auto_create_rep_commission_plan trigger to use valid app_role enum values
CREATE OR REPLACE FUNCTION public.auto_create_rep_commission_plan()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only create commission plan for sales roles (not 'admin' or 'manager' which are invalid)
  IF NEW.role IN ('sales_manager', 'regional_manager') THEN
    INSERT INTO commission_plans (
      name,
      commission_type,
      plan_config,
      tenant_id,
      created_by,
      is_active
    ) VALUES (
      'Default Plan - ' || NEW.first_name || ' ' || NEW.last_name,
      'percentage',
      '{"base_rate": 0.05, "tiers": []}'::jsonb,
      NEW.tenant_id,
      NEW.id,
      true
    )
    ON CONFLICT DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$;