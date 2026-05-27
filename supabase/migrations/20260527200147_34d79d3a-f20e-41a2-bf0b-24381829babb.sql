
CREATE OR REPLACE FUNCTION public.compute_co_totals_from_line_items(p_line_items jsonb)
RETURNS TABLE(material_total numeric, labor_total numeric, cost_impact numeric)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_mat numeric := 0;
  v_lab numeric := 0;
  v_line numeric := 0;
  v_qty numeric;
  v_price numeric;
  v_type text;
  rec jsonb;
BEGIN
  IF p_line_items IS NULL OR jsonb_typeof(p_line_items) <> 'array' THEN
    RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  FOR rec IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    v_qty := COALESCE((rec->>'qty')::numeric, (rec->>'quantity')::numeric, 0);
    v_price := COALESCE(
      (rec->>'unit_cost')::numeric,
      (rec->>'unit_price')::numeric,
      (rec->>'price')::numeric,
      (rec->>'rate')::numeric,
      0
    );
    v_line := COALESCE(
      (rec->>'line_total')::numeric,
      (rec->>'total')::numeric,
      (rec->>'amount')::numeric,
      v_qty * v_price
    );
    v_type := LOWER(COALESCE(rec->>'type', rec->>'category', 'material'));
    IF v_type IN ('labor','service') THEN
      v_lab := v_lab + v_line;
    ELSE
      v_mat := v_mat + v_line;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_mat, v_lab, v_mat + v_lab;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_change_order_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_mat numeric;
  v_lab numeric;
  v_cost numeric;
BEGIN
  SELECT material_total, labor_total, cost_impact
  INTO v_mat, v_lab, v_cost
  FROM public.compute_co_totals_from_line_items(NEW.line_items);

  NEW.material_total := v_mat;
  NEW.labor_total := v_lab;
  IF v_cost > 0 OR NEW.cost_impact IS NULL OR NEW.cost_impact = 0 THEN
    NEW.cost_impact := v_cost;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_change_order_totals ON public.change_orders;
CREATE TRIGGER trg_sync_change_order_totals
BEFORE INSERT OR UPDATE OF line_items, cost_impact, material_total, labor_total
ON public.change_orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_change_order_totals();

-- Backfill: re-set line_items only for rows where it's an array with elements
UPDATE public.change_orders co
SET line_items = co.line_items
WHERE co.id IN (
  SELECT id FROM public.change_orders
  WHERE line_items IS NOT NULL
    AND jsonb_typeof(line_items) = 'array'
    AND CASE WHEN jsonb_typeof(line_items) = 'array' THEN jsonb_array_length(line_items) ELSE 0 END > 0
    AND (COALESCE(cost_impact,0) = 0 OR COALESCE(material_total,0) + COALESCE(labor_total,0) = 0)
);

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
    INTO v_materials, v_labor, v_overhead, v_profit, v_sale_price, v_margin_pct, v_sales_tax_amount
    FROM public.enhanced_estimates
    WHERE id = v_selected_estimate_id;

    v_cost_pre_profit := v_materials + v_labor + v_overhead;
    v_estimate_status := 'complete';
  END IF;

  SELECT COALESCE(SUM(COALESCE(cost_impact, 0)), 0)
  INTO v_co_total
  FROM public.change_orders
  WHERE project_id = p_pipeline_entry_id
    AND LOWER(COALESCE(status,'')) IN ('approved','invoiced','completed');

  v_sale_price := v_sale_price + v_co_total;

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
