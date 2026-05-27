CREATE OR REPLACE FUNCTION public.api_estimate_hyperlink_bar(p_pipeline_entry_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result json;
  v_selected_estimate_id uuid;
  v_project_id uuid;
  v_materials numeric := 0;
  v_labor numeric := 0;
  v_overhead numeric := 0;
  v_profit numeric := 0;
  v_sale_price numeric := 0;
  v_base_sale_price numeric := 0;
  v_margin_pct numeric := 30;
  v_cost_pre_profit numeric := 0;
  v_sales_tax_amount numeric := 0;
  v_contract_status text := 'pending';
  v_estimate_status text := 'pending';
  v_materials_status text := 'pending';
  v_labor_status text := 'pending';
  v_co_total numeric := 0;
BEGIN
  SELECT (metadata->>'selected_estimate_id')::uuid
  INTO v_selected_estimate_id
  FROM public.pipeline_entries
  WHERE id = p_pipeline_entry_id;

  SELECT id INTO v_project_id
  FROM public.projects
  WHERE pipeline_entry_id = p_pipeline_entry_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_selected_estimate_id IS NOT NULL THEN
    SELECT 
      COALESCE(material_cost, 0),
      COALESCE(labor_cost, 0),
      COALESCE(overhead_amount, 0),
      COALESCE(actual_profit_amount, 0),
      COALESCE(selling_price, 0),
      COALESCE(actual_profit_percent, 30),
      COALESCE(sales_tax_amount, 0)
    INTO v_materials, v_labor, v_overhead, v_profit, v_base_sale_price, v_margin_pct, v_sales_tax_amount
    FROM public.enhanced_estimates
    WHERE id = v_selected_estimate_id;

    v_cost_pre_profit := v_materials + v_labor + v_overhead;
    v_estimate_status := 'complete';
  END IF;

  -- Sum approved/invoiced/completed change orders for ANY project under this pipeline entry.
  -- change_orders.project_id references projects.id, NOT pipeline_entries.id.
  SELECT COALESCE(SUM(COALESCE(co.cost_impact, 0)), 0)
  INTO v_co_total
  FROM public.change_orders co
  JOIN public.projects p ON p.id = co.project_id
  WHERE p.pipeline_entry_id = p_pipeline_entry_id
    AND (
      LOWER(COALESCE(co.status,'')) IN ('approved','invoiced','completed')
      OR co.customer_approved = true
    );

  v_sale_price := v_base_sale_price + v_co_total;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM public.agreement_instances 
    WHERE pipeline_entry_id = p_pipeline_entry_id AND status = 'completed'
  ) THEN 'complete' ELSE 'pending' END
  INTO v_contract_status;

  IF v_project_id IS NOT NULL THEN
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.purchase_orders 
      WHERE project_id = v_project_id AND status IN ('ordered', 'delivered', 'approved', 'received')
    ) THEN 'complete' ELSE 'pending' END
    INTO v_materials_status;
  END IF;

  IF v_project_id IS NOT NULL THEN
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM public.labor_cost_tracking 
      WHERE project_id = v_project_id
    ) THEN 'complete' ELSE 'pending' END
    INTO v_labor_status;
  END IF;

  v_result := json_build_object(
    'materials', v_materials,
    'labor', v_labor,
    'overhead', v_overhead,
    'cost_pre_profit', v_cost_pre_profit,
    'profit', v_profit,
    'sale_price', v_sale_price,
    'base_sale_price', v_base_sale_price,
    'change_orders_total', v_co_total,
    'margin_pct', v_margin_pct,
    'sales_tax_amount', v_sales_tax_amount,
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
$function$;

NOTIFY pgrst, 'reload schema';