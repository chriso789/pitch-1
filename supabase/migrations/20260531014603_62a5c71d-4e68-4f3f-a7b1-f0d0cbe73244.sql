
-- Seed: GAF EverGuard TPO 60 Mil Roof System template for O'Brien Contracting
-- Idempotent: skips if template (tenant_id, name) already exists.
-- Material pricing intentionally placeholder (unit_cost=0); sku_pattern carries
-- the SRS live-pricing lookup key. The live SRS pricing hook resolves cost at
-- estimate time. Do not hard-code SRS prices here.

DO $seed$
DECLARE
  v_tenant uuid := '14de934e-7964-4afd-940a-620d2ace125d'; -- O'Brien Contracting
  v_template uuid;
  g_tearoff uuid;
  g_insulation uuid;
  g_membrane uuid;
  g_accessories uuid;
  g_flashings uuid;
  g_edge_drains uuid;
  g_labor uuid;
  g_freight uuid;
BEGIN
  -- 1) Template
  INSERT INTO public.estimate_calculation_templates (
    tenant_id, name, roof_type, template_category,
    base_material_cost_per_sq, base_labor_hours_per_sq, base_labor_rate_per_hour,
    overhead_percentage, target_profit_percentage,
    complexity_multipliers, seasonal_multipliers, location_multipliers,
    material_specifications, labor_breakdown,
    is_active, use_section_mapping
  ) VALUES (
    v_tenant,
    'GAF EverGuard TPO 60 Mil Roof System',
    'flat',
    'commercial',
    0, 0, 0,
    10, 20,
    '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
    jsonb_build_object(
      'system','GAF EverGuard TPO',
      'membrane_mil',60,
      'trade','Commercial Roofing',
      'pricing_source','live_srs',
      'notes','All material unit_cost is placeholder; resolved live via SRS integration using sku_pattern as lookup key.'
    ),
    '{}'::jsonb,
    true, true
  )
  ON CONFLICT (tenant_id, name) DO NOTHING
  RETURNING id INTO v_template;

  IF v_template IS NULL THEN
    RAISE NOTICE 'GAF EverGuard TPO template already seeded for O''Brien Contracting — skipping.';
    RETURN;
  END IF;

  -- 2) Groups (schema constraint allows only material/labor as group_type)
  INSERT INTO public.estimate_calc_template_groups (tenant_id, calc_template_id, name, group_type, sort_order)
  VALUES (v_tenant, v_template, 'Tear-Off & Roof Prep', 'labor', 1) RETURNING id INTO g_tearoff;

  INSERT INTO public.estimate_calc_template_groups (tenant_id, calc_template_id, name, group_type, sort_order)
  VALUES (v_tenant, v_template, 'Insulation & Cover Board', 'material', 2) RETURNING id INTO g_insulation;

  INSERT INTO public.estimate_calc_template_groups (tenant_id, calc_template_id, name, group_type, sort_order)
  VALUES (v_tenant, v_template, 'GAF EverGuard 60 Mil TPO Membrane', 'material', 3) RETURNING id INTO g_membrane;

  INSERT INTO public.estimate_calc_template_groups (tenant_id, calc_template_id, name, group_type, sort_order)
  VALUES (v_tenant, v_template, 'TPO Accessories & Adhesives', 'material', 4) RETURNING id INTO g_accessories;

  INSERT INTO public.estimate_calc_template_groups (tenant_id, calc_template_id, name, group_type, sort_order)
  VALUES (v_tenant, v_template, 'Flashings & Penetrations', 'material', 5) RETURNING id INTO g_flashings;

  INSERT INTO public.estimate_calc_template_groups (tenant_id, calc_template_id, name, group_type, sort_order)
  VALUES (v_tenant, v_template, 'Edge Metal, Drains & Scuppers', 'material', 6) RETURNING id INTO g_edge_drains;

  INSERT INTO public.estimate_calc_template_groups (tenant_id, calc_template_id, name, group_type, sort_order)
  VALUES (v_tenant, v_template, 'Installation Labor', 'labor', 7) RETURNING id INTO g_labor;

  INSERT INTO public.estimate_calc_template_groups (tenant_id, calc_template_id, name, group_type, sort_order)
  VALUES (v_tenant, v_template, 'Freight, Disposal & Closeout', 'labor', 8) RETURNING id INTO g_freight;

  -- 3) Items
  -- NOTE: unit_cost is intentionally 0 for SRS-resolved materials. The
  -- sku_pattern column carries the SRS live-pricing lookup key. The estimator
  -- UI resolves price_source='live_srs' at estimate time and allows manual
  -- override per existing engine standards.

  -- A. Tear-Off & Prep
  INSERT INTO public.estimate_calc_template_items
    (tenant_id, calc_template_id, group_id, item_type, item_name, description, unit, unit_cost, qty_formula, sku_pattern, manufacturer, measurement_type, sort_order)
  VALUES
    (v_tenant, v_template, g_tearoff, 'labor', 'Tear-Off Existing Roof System', 'Per layer; multiply by tear-off layer count', 'sq', 75, '{{ roof.squares * (roof.tearoff_layers ?? 1) }}', 'LABOR-TPO-TEAROFF', NULL, 'roof_squares', 1),
    (v_tenant, v_template, g_tearoff, 'labor', 'Wet Insulation Replacement Allowance', 'Allowance — adjust % to roof area', 'sq', 35, '{{ ceil(roof.squares * 0.05) }}', 'LABOR-WET-INS', NULL, 'roof_squares', 2),
    (v_tenant, v_template, g_tearoff, 'labor', 'Deck Repair Allowance', 'Allowance — adjust as needed', 'sheet', 65, '{{ ceil(roof.total_sqft * 0.02 / 32) }}', 'LABOR-DECK-RPR', NULL, 'roof_area', 3),
    (v_tenant, v_template, g_tearoff, 'labor', 'Substrate Prep / Sweep', 'Full roof surface prep', 'sq', 6, '{{ roof.squares }}', 'LABOR-PREP', NULL, 'roof_squares', 4);

  -- B. Insulation & Cover Board (SRS live pricing)
  INSERT INTO public.estimate_calc_template_items
    (tenant_id, calc_template_id, group_id, item_type, item_name, description, unit, unit_cost, qty_formula, sku_pattern, manufacturer, measurement_type, coverage_per_unit, sort_order)
  VALUES
    (v_tenant, v_template, g_insulation, 'material', 'GAF EnergyGuard Polyiso ISO 2.0"', 'SRS live price — 4x8 board, R-12', 'board', 0, '{{ ceil(roof.total_sqft * (1 + (roof.waste_pct ?? 5)/100) / 32) }}', 'SRS:GAF-POLYISO-2.0-4x8', 'GAF', 'roof_area', 32, 1),
    (v_tenant, v_template, g_insulation, 'material', 'Tapered ISO Package (1/2" per foot)', 'SRS live price — quote/package; resolve at takeoff', 'pkg', 0, '1', 'SRS:TAPERED-ISO-1/2-PKG', 'GAF', 'roof_area', NULL, 2),
    (v_tenant, v_template, g_insulation, 'material', 'GAF SecurockGypsum Cover Board 1/2"', 'SRS live price', 'board', 0, '{{ ceil(roof.total_sqft * (1 + (roof.waste_pct ?? 5)/100) / 32) }}', 'SRS:SECUROCK-1/2-4x8', 'USG', 'roof_area', 32, 3),
    (v_tenant, v_template, g_insulation, 'material', 'OlyBond500 Insulation Adhesive', 'SRS live price — 5gal kit', 'kit', 0, '{{ ceil(roof.total_sqft / 1500) }}', 'SRS:OLYBOND500-KIT', 'OMG', 'roof_area', 1500, 4),
    (v_tenant, v_template, g_insulation, 'material', 'Drill-Tec #15 Fastener (mechanically attached alt)', 'SRS live price — used when MA attachment', 'box', 0, '{{ ceil(roof.total_sqft / 250) }}', 'SRS:DRILLTEC-15-BOX', 'GAF', 'roof_area', 250, 5),
    (v_tenant, v_template, g_insulation, 'material', 'Drill-Tec 3" Insulation Plate', 'SRS live price — pairs with #15 fastener', 'box', 0, '{{ ceil(roof.total_sqft / 250) }}', 'SRS:DRILLTEC-3IN-PLATE-BOX', 'GAF', 'roof_area', 250, 6);

  -- C. Membrane
  INSERT INTO public.estimate_calc_template_items
    (tenant_id, calc_template_id, group_id, item_type, item_name, description, unit, unit_cost, qty_formula, sku_pattern, manufacturer, measurement_type, coverage_per_unit, requires_color, sort_order)
  VALUES
    (v_tenant, v_template, g_membrane, 'material', 'GAF EverGuard TPO 60 Mil — 10ft Roll', 'SRS live price — 10ft x 100ft = 1000 sf/roll', 'roll', 0, '{{ ceil(roof.total_sqft * (1 + (roof.waste_pct ?? 10)/100) / 1000) }}', 'SRS:GAF-EVRGRD-TPO-60-10X100', 'GAF', 'roof_area', 1000, true, 1),
    (v_tenant, v_template, g_membrane, 'material', 'GAF EverGuard TPO 60 Mil — 12ft Roll (optional)', 'SRS live price — 12ft x 100ft = 1200 sf/roll', 'roll', 0, '0', 'SRS:GAF-EVRGRD-TPO-60-12X100', 'GAF', 'roof_area', 1200, true, 2);

  -- D. Accessories & Adhesives
  INSERT INTO public.estimate_calc_template_items
    (tenant_id, calc_template_id, group_id, item_type, item_name, description, unit, unit_cost, qty_formula, sku_pattern, manufacturer, measurement_type, coverage_per_unit, sort_order)
  VALUES
    (v_tenant, v_template, g_accessories, 'material', 'GAF EverGuard TPO Bonding Adhesive', 'SRS live price — 5gal; ~60 sf/gal both surfaces', 'pail', 0, '{{ ceil(roof.total_sqft / 300) }}', 'SRS:GAF-TPO-BOND-ADH-5GAL', 'GAF', 'roof_area', 300, 1),
    (v_tenant, v_template, g_accessories, 'material', 'GAF EverGuard TPO Cut-Edge Sealant', 'SRS live price — tube', 'tube', 0, '{{ ceil(roof.total_sqft / 1000) }}', 'SRS:GAF-TPO-CUTEDGE-TUBE', 'GAF', 'roof_area', 1000, 2),
    (v_tenant, v_template, g_accessories, 'material', 'GAF EverGuard TPO Water Block Sealant', 'SRS live price', 'tube', 0, '{{ pen.pipe_vent + pen.curb + pen.drain + 5 }}', 'SRS:GAF-TPO-WATERBLOCK', 'GAF', 'penetrations', NULL, 3),
    (v_tenant, v_template, g_accessories, 'material', 'GAF FlexSeal Caulk Grade Sealant', 'SRS live price', 'tube', 0, '{{ ceil((lf.perimeter + lf.wall_flashing) / 50) }}', 'SRS:GAF-FLEXSEAL', 'GAF', 'linear_perimeter', NULL, 4),
    (v_tenant, v_template, g_accessories, 'material', 'GAF EverGuard TPO Primer', 'SRS live price — 5gal', 'pail', 0, '{{ ceil(roof.total_sqft / 5000) }}', 'SRS:GAF-TPO-PRIMER-5GAL', 'GAF', 'roof_area', 5000, 5),
    (v_tenant, v_template, g_accessories, 'material', 'TPO Walk Pad 30"x50ft', 'SRS live price — optional traffic protection', 'roll', 0, '{{ ceil((roof.walk_pad_lf ?? 0) / 50) }}', 'SRS:GAF-TPO-WALKPAD', 'GAF', 'linear_perimeter', 50, 6);

  -- E. Flashings & Penetrations
  INSERT INTO public.estimate_calc_template_items
    (tenant_id, calc_template_id, group_id, item_type, item_name, description, unit, unit_cost, qty_formula, sku_pattern, manufacturer, measurement_type, coverage_per_unit, sort_order)
  VALUES
    (v_tenant, v_template, g_flashings, 'material', 'GAF EverGuard TPO Detail Membrane 12"', 'SRS live price — non-reinforced for penetrations', 'roll', 0, '{{ ceil((pen.pipe_vent + pen.curb + pen.drain) / 20) }}', 'SRS:GAF-TPO-DETAIL-12IN', 'GAF', 'penetrations', 20, 1),
    (v_tenant, v_template, g_flashings, 'material', 'GAF EverGuard TPO Utility Flashing Membrane', 'SRS live price — reinforced flashing roll', 'roll', 0, '{{ ceil(lf.wall_flashing / 50) }}', 'SRS:GAF-TPO-UTIL-FLASH', 'GAF', 'linear_wall', 50, 2),
    (v_tenant, v_template, g_flashings, 'material', 'GAF EverGuard TPO Pre-Molded Pipe Boot', 'SRS live price — sized per pipe', 'each', 0, '{{ pen.pipe_vent }}', 'SRS:GAF-TPO-PIPEBOOT', 'GAF', 'penetrations', NULL, 3),
    (v_tenant, v_template, g_flashings, 'material', 'GAF EverGuard TPO Inside/Outside Corners', 'SRS live price — pre-molded corner', 'pack', 0, '{{ ceil(pen.curb * 8 / 25) }}', 'SRS:GAF-TPO-CORNERS', 'GAF', 'penetrations', 25, 4),
    (v_tenant, v_template, g_flashings, 'material', 'TPO Curb Wrap Material', 'SRS live price — for HVAC/equipment curbs', 'lf', 0, '{{ pen.curb * 12 }}', 'SRS:GAF-TPO-CURB-WRAP', 'GAF', 'penetrations', NULL, 5),
    (v_tenant, v_template, g_flashings, 'material', 'Termination Bar w/ Sealant Edge', 'SRS live price — 10ft', 'piece', 0, '{{ ceil(lf.wall_flashing / 10) }}', 'SRS:TERM-BAR-10FT', 'OMG', 'linear_wall', 10, 6);

  -- F. Edge Metal, Drains & Scuppers
  INSERT INTO public.estimate_calc_template_items
    (tenant_id, calc_template_id, group_id, item_type, item_name, description, unit, unit_cost, qty_formula, sku_pattern, manufacturer, measurement_type, coverage_per_unit, requires_color, sort_order)
  VALUES
    (v_tenant, v_template, g_edge_drains, 'material', 'TPO Coated Drip Edge — 10ft', 'SRS live price — color match', 'piece', 0, '{{ ceil(lf.perimeter / 10) }}', 'SRS:TPO-DRIP-EDGE-10FT', 'GAF', 'linear_perimeter', 10, true, 1),
    (v_tenant, v_template, g_edge_drains, 'material', 'TPO Coated Coping Cap — 10ft', 'SRS live price — optional', 'piece', 0, '0', 'SRS:TPO-COPING-10FT', 'GAF', 'linear_perimeter', 10, true, 2),
    (v_tenant, v_template, g_edge_drains, 'material', 'Roof Drain Retrofit Assembly', 'SRS live price — per drain', 'each', 0, '{{ pen.drain }}', 'SRS:DRAIN-RETROFIT-ASSY', 'OMG', 'penetrations', NULL, false, 3),
    (v_tenant, v_template, g_edge_drains, 'material', 'Drain Strainer / Clamping Ring', 'SRS live price', 'each', 0, '{{ pen.drain }}', 'SRS:DRAIN-STRAINER', 'OMG', 'penetrations', NULL, false, 4),
    (v_tenant, v_template, g_edge_drains, 'material', 'Scupper Box w/ TPO Flange', 'SRS live price', 'each', 0, '{{ pen.scupper ?? 0 }}', 'SRS:SCUPPER-TPO-FLANGE', 'GAF', 'penetrations', NULL, false, 5);

  -- G. Installation Labor
  INSERT INTO public.estimate_calc_template_items
    (tenant_id, calc_template_id, group_id, item_type, item_name, description, unit, unit_cost, qty_formula, sku_pattern, manufacturer, measurement_type, sort_order)
  VALUES
    (v_tenant, v_template, g_labor, 'labor', 'Insulation & Cover Board Install', 'Layered system install labor', 'sq', 35, '{{ roof.squares }}', 'LABOR-TPO-INS-INSTALL', NULL, 'roof_squares', 1),
    (v_tenant, v_template, g_labor, 'labor', 'TPO Membrane Install (FA / MA / Adhered)', 'Field membrane labor', 'sq', 95, '{{ roof.squares }}', 'LABOR-TPO-MEMBRANE', NULL, 'roof_squares', 2),
    (v_tenant, v_template, g_labor, 'labor', 'Heat-Weld Field Seams', 'Robotic + hand-weld labor', 'sq', 25, '{{ roof.squares }}', 'LABOR-TPO-SEAMS', NULL, 'roof_squares', 3),
    (v_tenant, v_template, g_labor, 'labor', 'Wall / Parapet Flashing Install', NULL, 'lf', 9, '{{ lf.wall_flashing }}', 'LABOR-TPO-WALL-FLASH', NULL, 'linear_wall', 4),
    (v_tenant, v_template, g_labor, 'labor', 'Pipe Penetration Flash & Detail', NULL, 'each', 85, '{{ pen.pipe_vent }}', 'LABOR-TPO-PIPE-PEN', NULL, 'penetrations', 5),
    (v_tenant, v_template, g_labor, 'labor', 'Curb / Equipment Flashing', NULL, 'each', 225, '{{ pen.curb }}', 'LABOR-TPO-CURB', NULL, 'penetrations', 6),
    (v_tenant, v_template, g_labor, 'labor', 'Drain Retrofit Install', NULL, 'each', 250, '{{ pen.drain }}', 'LABOR-TPO-DRAIN', NULL, 'penetrations', 7),
    (v_tenant, v_template, g_labor, 'labor', 'Edge Metal / Coping Install', NULL, 'lf', 6, '{{ lf.perimeter }}', 'LABOR-TPO-EDGE', NULL, 'linear_perimeter', 8),
    (v_tenant, v_template, g_labor, 'labor', 'Tapered ISO Layout & Install', 'Per package layout & install labor', 'sq', 20, '{{ roof.squares }}', 'LABOR-TPO-TAPER', NULL, 'roof_squares', 9);

  -- H. Freight, Disposal & Closeout
  INSERT INTO public.estimate_calc_template_items
    (tenant_id, calc_template_id, group_id, item_type, item_name, description, unit, unit_cost, qty_formula, sku_pattern, manufacturer, measurement_type, sort_order)
  VALUES
    (v_tenant, v_template, g_freight, 'labor', 'Material Freight / Delivery', 'SRS freight; override per quote', 'job', 850, '1', 'SRS:FREIGHT-DELIVERY', NULL, NULL, 1),
    (v_tenant, v_template, g_freight, 'labor', 'Crane / Boom Lift Rental', 'Per day; adjust qty', 'day', 1200, '1', 'RENTAL-CRANE-DAY', NULL, NULL, 2),
    (v_tenant, v_template, g_freight, 'labor', 'Dumpster / Disposal (40yd)', 'Per pull; adjust qty', 'each', 750, '{{ ceil((roof.tearoff_layers ?? 1) * roof.squares / 30) }}', 'DUMPSTER-40YD', NULL, NULL, 3),
    (v_tenant, v_template, g_freight, 'labor', 'Final Cleanup & Magnetic Sweep', NULL, 'job', 450, '1', 'LABOR-CLEANUP', NULL, NULL, 4),
    (v_tenant, v_template, g_freight, 'labor', 'Optional: GAF Diamond Pledge NDL Warranty Registration', 'Optional warranty cost', 'job', 0, '0', 'GAF-NDL-WARRANTY', NULL, NULL, 5),
    (v_tenant, v_template, g_freight, 'labor', 'Optional: Third-Party Seam Probe / Adhesion Test', 'Optional QA testing', 'job', 0, '0', 'QA-SEAM-TEST', NULL, NULL, 6);

  RAISE NOTICE 'Seeded GAF EverGuard TPO 60 Mil Roof System template % for O''Brien Contracting.', v_template;
END
$seed$;
