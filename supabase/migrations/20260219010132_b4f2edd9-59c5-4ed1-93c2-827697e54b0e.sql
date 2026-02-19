
-- 1) Bulk update existing template item descriptions to homeowner-friendly text
UPDATE public.estimate_calc_template_items
SET description = CASE
  WHEN item_name ILIKE '%shingle%' AND item_type = 'material' AND item_name NOT ILIKE '%starter%' AND item_name NOT ILIKE '%ridge%' AND item_name NOT ILIKE '%hip%'
    THEN 'Remove old roof and install new architectural shingles for lasting weather protection and curb appeal'
  WHEN item_name ILIKE '%starter%'
    THEN 'Adhesive starter row installed along eaves and rakes to seal the first course of shingles against wind uplift'
  WHEN item_name ILIKE '%ridge%' OR item_name ILIKE '%hip and ridge%'
    THEN 'Specially shaped shingles installed along the peak and hip lines of your roof for a finished, watertight seal'
  WHEN item_name ILIKE '%underlayment%' AND item_type = 'material'
    THEN 'Waterproof barrier installed over the roof deck beneath the shingles as a secondary layer of leak protection'
  WHEN item_name ILIKE '%ice%water%' OR item_name ILIKE '%ice & water%'
    THEN 'Self-adhering waterproof membrane applied to vulnerable areas like eaves and valleys to prevent ice dam and wind-driven rain leaks'
  WHEN item_name ILIKE '%drip edge%'
    THEN 'Metal edge flashing installed along the roof perimeter to direct water away from the fascia and into gutters'
  WHEN item_name ILIKE '%valley%'
    THEN 'Metal channel installed where two roof slopes meet to direct heavy water flow and prevent valley leaks'
  WHEN item_name ILIKE '%pipe boot%'
    THEN 'Rubber-sealed flashing fitted around plumbing vent pipes to prevent leaks at roof penetrations'
  WHEN item_name ILIKE '%nail%'
    THEN 'Galvanized roofing nails used to secure roofing materials to the deck per manufacturer specifications'
  WHEN item_name ILIKE '%cement%' OR item_name ILIKE '%sealant%'
    THEN 'Sealant applied to flashings, edges, and penetrations for additional waterproofing'
  WHEN item_name ILIKE '%osb%' OR item_name ILIKE '%decking%'
    THEN 'Replacement plywood decking boards for any rotted or damaged sections discovered during tear-off'
  WHEN item_name ILIKE '%panel%' AND item_type = 'material'
    THEN 'Remove old roof and install new metal roofing panels for superior durability and weather resistance'
  WHEN item_name ILIKE '%screw%'
    THEN 'Specialized fasteners used to secure metal panels to the roof deck for a watertight seal'
  WHEN item_name ILIKE '%tile%' AND item_type = 'material'
    THEN 'Remove old roof and install new concrete roof tiles for long-lasting protection and classic appearance'
  WHEN item_name ILIKE '%stone%coated%' OR item_name ILIKE '%worthouse%'
    THEN 'Remove old roof and install new stone-coated steel panels combining metal durability with a traditional tile look'
  WHEN item_name ILIKE '%closure%' OR item_name ILIKE '%foam%'
    THEN 'Foam or rubber sealing strips installed at panel edges to block wind-driven rain, insects, and debris'
  WHEN item_name ILIKE '%butyl%tape%'
    THEN 'Adhesive sealing tape applied at panel overlaps for a weathertight bond between metal panels'
  WHEN item_name ILIKE '%tear%off%' OR item_name ILIKE '%removal%'
    THEN 'Remove and dispose of all existing roofing materials down to the bare deck'
  WHEN item_name ILIKE '%install%' AND item_type = 'labor'
    THEN 'Professionally install new roofing materials per manufacturer specifications to maintain full warranty coverage'
  WHEN item_name ILIKE '%cleanup%' OR item_name ILIKE '%haul%' OR item_name ILIKE '%debris%'
    THEN 'Complete job-site cleanup, magnetic nail sweep, and haul all debris to the dump'
  WHEN item_name ILIKE '%flashing%' OR item_name ILIKE '%detail%'
    THEN 'Install step flashing, valley metal, and detail work around all roof penetrations and transitions'
  ELSE description
END
WHERE description IS NOT NULL;

-- 2) Update api_estimate_hyperlink_bar to return sales_tax_amount
DROP FUNCTION IF EXISTS public.api_estimate_hyperlink_bar(uuid);

CREATE OR REPLACE FUNCTION public.api_estimate_hyperlink_bar(p_pipeline_entry_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.api_estimate_hyperlink_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.api_estimate_hyperlink_bar(uuid) TO authenticated;
