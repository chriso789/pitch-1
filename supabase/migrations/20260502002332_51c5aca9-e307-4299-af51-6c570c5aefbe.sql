
INSERT INTO estimate_calculation_templates (
  tenant_id, name, roof_type, template_category,
  base_material_cost_per_sq, base_labor_hours_per_sq, base_labor_rate_per_hour,
  overhead_percentage, target_profit_percentage,
  complexity_multipliers, seasonal_multipliers, location_multipliers,
  material_specifications, labor_breakdown, is_active
)
SELECT
  '1e3b5562-c89e-489a-a949-ed281d91c889'::uuid,
  name, roof_type, template_category,
  base_material_cost_per_sq, base_labor_hours_per_sq, base_labor_rate_per_hour,
  overhead_percentage, target_profit_percentage,
  complexity_multipliers, seasonal_multipliers, location_multipliers,
  material_specifications, labor_breakdown, true
FROM estimate_calculation_templates
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND is_active = true;
