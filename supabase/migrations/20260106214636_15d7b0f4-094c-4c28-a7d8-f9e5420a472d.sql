-- Add missing perimeter_ft column to roof_measurements_truth
ALTER TABLE roof_measurements_truth 
ADD COLUMN IF NOT EXISTS perimeter_ft NUMERIC;

-- Copy tile templates from tenant 76ee42a0-6e96-4161-a7a6-abbdd3a6017d to East Coast tenant 14de934e-7964-4afd-940a-620d2ace125d
-- Using correct column list from schema
INSERT INTO estimate_calculation_templates (
  tenant_id, name, roof_type, template_category, 
  base_material_cost_per_sq, base_labor_hours_per_sq, base_labor_rate_per_hour,
  overhead_percentage, target_profit_percentage, complexity_multipliers,
  seasonal_multipliers, location_multipliers, material_specifications,
  labor_breakdown, is_active, created_at, updated_at
)
SELECT 
  '14de934e-7964-4afd-940a-620d2ace125d'::uuid,
  name, roof_type, template_category,
  base_material_cost_per_sq, base_labor_hours_per_sq, base_labor_rate_per_hour,
  overhead_percentage, target_profit_percentage, complexity_multipliers,
  seasonal_multipliers, location_multipliers, material_specifications,
  labor_breakdown, is_active, now(), now()
FROM estimate_calculation_templates
WHERE tenant_id = '76ee42a0-6e96-4161-a7a6-abbdd3a6017d'
AND (
  name ILIKE '%tile%' 
  OR name ILIKE '%boral%' 
  OR name ILIKE '%eagle%' 
  OR name = 'Worthouse Dura Profile'
  OR name = 'Worthouse Supre Profile'
)
AND name NOT IN (
  SELECT name FROM estimate_calculation_templates 
  WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
);