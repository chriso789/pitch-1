-- Fix api_estimate_hyperlink_bar: Replace non-existent address_full with correct columns
CREATE OR REPLACE FUNCTION public.api_estimate_hyperlink_bar(p_estimate_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_contact_address text;
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
  
  -- Get the contact address for joining with roof_measurements
  -- FIX: Use individual address columns instead of non-existent address_full
  SELECT COALESCE(
    NULLIF(TRIM(CONCAT_WS(', ', 
      NULLIF(c.address_street, ''),
      NULLIF(c.address_city, ''),
      CONCAT_WS(' ', NULLIF(c.address_state, ''), NULLIF(c.address_zip, ''))
    )), ''),
    c.address_street,
    ''
  ) INTO v_contact_address
  FROM public.pipeline_entries pe
  LEFT JOIN public.contacts c ON c.id = pe.contact_id
  WHERE pe.id = p_estimate_id;
  
  -- Get squares from roof_measurements table (NEW: proper join)
  -- First try to find measurement by matching property_address to contact address
  SELECT COALESCE(rm.total_area_adjusted_sqft, 0) INTO v_sq
  FROM public.roof_measurements rm
  WHERE rm.property_address ILIKE '%' || SPLIT_PART(v_contact_address, ',', 1) || '%'
    AND v_contact_address IS NOT NULL
    AND v_contact_address <> ''
  ORDER BY rm.created_at DESC
  LIMIT 1;
  
  -- Fallback: check if there's a direct customer_id link
  IF v_sq = 0 OR v_sq IS NULL THEN
    SELECT COALESCE(rm.total_area_adjusted_sqft, 0) INTO v_sq
    FROM public.roof_measurements rm
    JOIN public.pipeline_entries pe ON pe.contact_id = rm.customer_id
    WHERE pe.id = p_estimate_id
    ORDER BY rm.created_at DESC
    LIMIT 1;
  END IF;
  
  v_sq := COALESCE(v_sq, 0);
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
$function$;