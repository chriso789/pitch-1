-- Seed 8 brand-specific estimate calculation templates
INSERT INTO estimate_calculation_templates (tenant_id, name, roof_type, template_category, base_material_cost_per_sq, base_labor_hours_per_sq, base_labor_rate_per_hour, overhead_percentage, target_profit_percentage, is_active)
SELECT 
  t.id as tenant_id,
  template.name,
  template.roof_type::roof_type,
  template.template_category,
  template.base_material_cost_per_sq,
  template.base_labor_hours_per_sq,
  template.base_labor_rate_per_hour,
  template.overhead_percentage,
  template.target_profit_percentage,
  true as is_active
FROM tenants t
CROSS JOIN (
  VALUES
    ('GAF Timberline HDZ', 'shingle', 'premium', 185.00, 1.5, 65.00, 15.0, 30.0),
    ('Owens Corning Duration', 'shingle', 'premium', 180.00, 1.5, 65.00, 15.0, 30.0),
    ('Owens Corning Oakridge', 'shingle', 'standard', 145.00, 1.25, 60.00, 15.0, 30.0),
    ('CertainTeed Landmark', 'shingle', 'standard', 155.00, 1.25, 60.00, 15.0, 30.0),
    ('5V Painted Metal with Polyglass XFR', 'metal', 'standard', 250.00, 2.0, 70.00, 15.0, 30.0),
    ('Standing Seam 1" SnapLok with Polyglass XFR', 'metal', 'premium', 450.00, 3.0, 75.00, 15.0, 30.0),
    ('Worthouse Dura Profile Stamped Panels', 'metal', 'premium', 380.00, 2.5, 75.00, 15.0, 30.0),
    ('Worthouse Supre Profile Stamped Panels', 'metal', 'premium', 420.00, 2.75, 75.00, 15.0, 30.0)
) AS template(name, roof_type, template_category, base_material_cost_per_sq, base_labor_hours_per_sq, base_labor_rate_per_hour, overhead_percentage, target_profit_percentage)
ON CONFLICT DO NOTHING;