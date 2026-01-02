-- Fix the api_estimate_hyperlink_bar function to use correct tables
-- The function was referencing non-existent tables: material_orders and labor_entries
-- Correct tables are: purchase_orders and labor_cost_tracking

DROP FUNCTION IF EXISTS public.api_estimate_hyperlink_bar(uuid);

CREATE OR REPLACE FUNCTION public.api_estimate_hyperlink_bar(p_estimate_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result json;
  v_selected_estimate_id uuid;
  v_materials numeric := 0;
  v_labor numeric := 0;
  v_overhead numeric := 0;
  v_profit numeric := 0;
  v_sale_price numeric := 0;
  v_margin_pct numeric := 30;
  v_cost_pre_profit numeric := 0;
  v_contract_status text := 'pending';
  v_estimate_status text := 'pending';
  v_materials_status text := 'pending';
  v_labor_status text := 'pending';
BEGIN
  -- Get selected estimate ID from pipeline_entries metadata
  SELECT (metadata->>'selected_estimate_id')::uuid
  INTO v_selected_estimate_id
  FROM public.pipeline_entries
  WHERE id = p_estimate_id;

  -- If an estimate is selected, read costs from enhanced_estimates
  IF v_selected_estimate_id IS NOT NULL THEN
    SELECT 
      COALESCE(material_cost, 0),
      COALESCE(labor_cost, 0),
      COALESCE(overhead_amount, 0),
      COALESCE(actual_profit_amount, 0),
      COALESCE(selling_price, 0),
      COALESCE(actual_profit_percent, 30)
    INTO v_materials, v_labor, v_overhead, v_profit, v_sale_price, v_margin_pct
    FROM public.enhanced_estimates
    WHERE id = v_selected_estimate_id;
    
    v_cost_pre_profit := v_materials + v_labor + v_overhead;
    v_estimate_status := 'complete';
  END IF;

  -- Check contract status (agreement_instances exists and completed)
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.agreement_instances 
    WHERE pipeline_entry_id = p_estimate_id AND status = 'completed'
  ) THEN 'complete' ELSE 'pending' END
  INTO v_contract_status;

  -- Check materials order status using purchase_orders (correct table)
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.purchase_orders 
    WHERE pipeline_entry_id = p_estimate_id AND status IN ('ordered', 'delivered', 'approved', 'received')
  ) THEN 'complete' ELSE 'pending' END
  INTO v_materials_status;

  -- Check labor assignment status using labor_cost_tracking (correct table)
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.labor_cost_tracking 
    WHERE pipeline_entry_id = p_estimate_id
  ) THEN 'complete' ELSE 'pending' END
  INTO v_labor_status;

  -- Build result JSON
  v_result := json_build_object(
    'materials', v_materials,
    'labor', v_labor,
    'overhead', v_overhead,
    'cost_pre_profit', v_cost_pre_profit,
    'profit', v_profit,
    'sale_price', v_sale_price,
    'margin_pct', v_margin_pct,
    'mode', 'margin',
    'sections', json_build_object(
      'contract', json_build_object('status', v_contract_status),
      'estimate', json_build_object('status', v_estimate_status),
      'materials', json_build_object('status', v_materials_status),
      'labor', json_build_object('status', v_labor_status)
    ),
    'selected_estimate_id', v_selected_estimate_id
  );

  RETURN v_result;
END;
$$;