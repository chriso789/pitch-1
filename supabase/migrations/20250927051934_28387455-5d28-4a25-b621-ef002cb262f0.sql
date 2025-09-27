-- =========================
-- RPC: Estimate status (gating flags)
-- =========================
CREATE OR REPLACE FUNCTION public.api_estimate_status_get(p_estimate_id uuid)
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
  v_cost  record;
  v_next  text[] := ARRAY[]::text[];
  v_msgs  text[] := ARRAY[]::text[];
  v_mode  text;
  v_margin numeric;
  v_markup numeric;
  v_computed_at timestamp with time zone;
BEGIN
  -- Get estimate tenant and verify access
  SELECT tenant_id INTO v_tenant FROM public.estimates WHERE id = p_estimate_id;
  IF v_tenant IS NULL THEN 
    RAISE EXCEPTION 'Estimate not found'; 
  END IF;
  IF v_tenant <> public.get_user_tenant_id() THEN 
    RAISE EXCEPTION 'Access denied'; 
  END IF;

  -- Check if template is bound
  v_bound := EXISTS (SELECT 1 FROM public.estimate_bindings WHERE estimate_id = p_estimate_id);
  
  -- Check if measurements are present (assuming estimates table has measurements data)
  SELECT CASE WHEN roof_area_sq_ft > 0 THEN true ELSE false END
  INTO v_meas
  FROM public.estimates 
  WHERE id = p_estimate_id;
  
  v_ready := v_bound AND v_meas;

  -- Get cost data from estimates table
  SELECT overhead_amount, target_margin_percent, selling_price, updated_at
  INTO v_cost
  FROM public.estimates
  WHERE id = p_estimate_id;

  -- Build next required steps and messages
  IF NOT v_bound THEN
    v_next := array_append(v_next, 'template');
    v_msgs := array_append(v_msgs, 'Bind a template to enable computations.');
  END IF;
  IF NOT v_meas THEN
    v_next := array_append(v_next, 'measurements');
    v_msgs := array_append(v_msgs, 'Add measurements to compute quantities.');
  END IF;

  v_mode := 'margin'; -- Default mode
  v_margin := v_cost.target_margin_percent;
  v_computed_at := v_cost.updated_at;

  RETURN jsonb_build_object(
    'estimate_id', p_estimate_id,
    'template_bound', v_bound,
    'measurements_present', v_meas,
    'ready', v_ready,
    'slider_disabled', NOT v_ready,
    'last_computed_at', v_computed_at,
    'mode', v_mode,
    'margin_pct', v_margin,
    'markup_pct', NULL,
    'next_required', to_jsonb(v_next),
    'messages', to_jsonb(v_msgs)
  );
END
$$;

REVOKE ALL ON FUNCTION public.api_estimate_status_get(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_estimate_status_get(uuid) TO authenticated;

-- =========================
-- RPC: Template (builder-ready, includes items)
-- =========================
CREATE OR REPLACE FUNCTION public.api_template_get_full(p_template_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  t record;
  items jsonb;
BEGIN
  -- Get template and verify access
  SELECT id, name, roof_type, base_material_cost_per_sq, base_labor_rate_per_hour, 
         overhead_percentage, target_profit_percentage, complexity_multipliers,
         seasonal_multipliers, material_specifications, labor_breakdown
  INTO t
  FROM public.estimate_calculation_templates
  WHERE id = p_template_id AND tenant_id = v_tenant AND is_active = true;
  
  IF NOT FOUND THEN 
    RAISE EXCEPTION 'Template not found or access denied'; 
  END IF;

  -- Build items array (using material_specifications as items)
  SELECT COALESCE(
    jsonb_build_array(), '[]'::jsonb
  ) INTO items;
  
  -- If material_specifications exists, use it as items
  IF t.material_specifications IS NOT NULL THEN
    items := t.material_specifications;
  END IF;

  RETURN jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'currency', 'USD',
    'labor', jsonb_build_object(
      'rate_per_square', t.base_labor_rate_per_hour,
      'complexity', COALESCE(t.complexity_multipliers, '{}'::jsonb)
    ),
    'overhead', jsonb_build_object(
      'type', 'percent',
      'percent', t.overhead_percentage,
      'fixed', NULL
    ),
    'items', items
  );
END
$$;

REVOKE ALL ON FUNCTION public.api_template_get_full(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_template_get_full(uuid) TO authenticated;