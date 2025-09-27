-- Add RPC functions for the estimate API endpoints

-- List template items for a template (tenant-scoped)
CREATE OR REPLACE FUNCTION public.api_template_items_get(p_template_id uuid)
RETURNS TABLE(
  id uuid, item_name text, unit text, waste_pct numeric, unit_cost numeric,
  qty_formula text, sort_order int, active boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ti.id, ti.item_name, ti.unit, ti.waste_pct, ti.unit_cost,
         ti.qty_formula, ti.sort_order, ti.active
  FROM public.template_items ti
  JOIN public.templates t ON t.id = ti.template_id
  WHERE ti.template_id = p_template_id
    AND t.tenant_id = get_user_tenant_id()
  ORDER BY ti.sort_order, ti.item_name;
$$;

REVOKE ALL ON FUNCTION public.api_template_items_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_template_items_get(uuid) TO authenticated;

-- List computed items for an estimate (tenant-scoped)
CREATE OR REPLACE FUNCTION public.api_estimate_items_get(p_estimate_id uuid)
RETURNS TABLE(
  template_item_id uuid, item_name text, qty numeric, unit_cost numeric, line_total numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT eci.template_item_id, eci.item_name, eci.qty, eci.unit_cost, eci.line_total
  FROM public.estimate_cost_items eci
  JOIN public.estimates e ON e.id = eci.estimate_id
  WHERE eci.estimate_id = p_estimate_id
    AND e.tenant_id = get_user_tenant_id()
  ORDER BY eci.item_name;
$$;

REVOKE ALL ON FUNCTION public.api_estimate_items_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_estimate_items_get(uuid) TO authenticated;

-- Hyperlink Bar response (sections + gating)
CREATE OR REPLACE FUNCTION public.api_estimate_hyperlink_bar(p_estimate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_bound boolean := false;
  v_meas  boolean := false;
  v_ready boolean := false;
  v_sq    numeric := 0;
  v_costs  record;
  v_sections jsonb;
  v_currency char(3) := 'USD';
  v_pipeline_id uuid;
BEGIN
  -- Get pipeline entry ID and check access
  SELECT pe.id, pe.tenant_id INTO v_pipeline_id, v_tenant 
  FROM public.pipeline_entries pe 
  WHERE pe.id = p_estimate_id;
  
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Pipeline entry not found'; END IF;
  IF v_tenant <> get_user_tenant_id() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

  -- Check if template is bound
  v_bound := EXISTS (
    SELECT 1 FROM public.pipeline_entries 
    WHERE id = p_estimate_id AND calculation_template_id IS NOT NULL
  );
  
  -- Check if measurements exist
  SELECT COALESCE(roof_area_sq_ft, 0) INTO v_sq
  FROM public.pipeline_entries WHERE id = p_estimate_id;
  v_meas := v_sq > 0;
  
  v_ready := v_bound AND v_meas;

  -- Get cost data from pipeline_entries
  SELECT 
    COALESCE(material_cost, 0) as materials,
    COALESCE(labor_cost, 0) as labor,
    COALESCE(overhead_amount, 0) as overhead,
    COALESCE(material_cost, 0) + COALESCE(labor_cost, 0) + COALESCE(overhead_amount, 0) as cost_pre_profit,
    COALESCE(actual_profit, 0) as profit,
    COALESCE(selling_price, 0) as sale_price,
    COALESCE(target_margin_percent, 30) as margin_pct,
    'margin' as mode
  INTO v_costs
  FROM public.pipeline_entries WHERE id = p_estimate_id;

  -- Build sections (pending displays $0 until ready)
  v_sections := jsonb_build_array(
    jsonb_build_object('key','measurements','label','Measurements',
                       'amount', 0, -- UI shows squares in extra
                       'pending', NOT v_meas,
                       'extra', jsonb_build_object('squares', v_sq)),
    jsonb_build_object('key','materials','label','Materials',
                       'amount', CASE WHEN v_ready THEN v_costs.materials ELSE 0 END,
                       'pending', NOT v_ready),
    jsonb_build_object('key','labor','label','Labor',
                       'amount', CASE WHEN v_ready THEN v_costs.labor ELSE 0 END,
                       'pending', NOT v_ready),
    jsonb_build_object('key','overhead','label','Overhead',
                       'amount', CASE WHEN v_ready THEN v_costs.overhead ELSE 0 END,
                       'pending', NOT v_ready),
    jsonb_build_object('key','profit','label','Profit',
                       'amount', CASE WHEN v_ready THEN v_costs.profit ELSE 0 END,
                       'pending', NOT v_ready,
                       'extra', jsonb_build_object('mode', v_costs.mode,
                                                   'margin_pct', v_costs.margin_pct,
                                                   'markup_pct', null,
                                                   'slider_disabled', NOT v_ready)),
    jsonb_build_object('key','total','label','Total',
                       'amount', CASE WHEN v_ready THEN v_costs.sale_price ELSE 0 END,
                       'pending', NOT v_ready)
  );

  RETURN jsonb_build_object(
    'estimate_id', p_estimate_id,
    'currency', v_currency,
    'ready', v_ready,
    'template_bound', v_bound,
    'measurements_present', v_meas,
    'squares', v_sq,
    'materials', CASE WHEN v_ready THEN v_costs.materials ELSE 0 END,
    'labor', CASE WHEN v_ready THEN v_costs.labor ELSE 0 END,
    'overhead', CASE WHEN v_ready THEN v_costs.overhead ELSE 0 END,
    'cost_pre_profit', CASE WHEN v_ready THEN v_costs.cost_pre_profit ELSE 0 END,
    'mode', v_costs.mode,
    'margin_pct', v_costs.margin_pct,
    'markup_pct', null,
    'sale_price', CASE WHEN v_ready THEN v_costs.sale_price ELSE 0 END,
    'profit', CASE WHEN v_ready THEN v_costs.profit ELSE 0 END,
    'sections', v_sections
  );
END
$$;

REVOKE ALL ON FUNCTION public.api_estimate_hyperlink_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_estimate_hyperlink_bar(uuid) TO authenticated;