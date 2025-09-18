-- Seed demo data for PITCH CRM system
-- Create demo tenant and sample data

-- Demo tenant
INSERT INTO public.tenants (id, name, subdomain, settings) VALUES 
('550e8400-e29b-41d4-a716-446655440000', 'Acme Roofing', 'acme-roofing', '{"contact_email": "admin@acmeroofing.com", "phone": "(555) 123-4567"}');

-- Demo tenant settings
INSERT INTO public.tenant_settings (tenant_id, min_profit_margin_percent, min_profit_amount_dollars, default_target_margin_percent, portal_show_photos, portal_show_documents, portal_show_balance, portal_show_messages) VALUES 
('550e8400-e29b-41d4-a716-446655440000', 15.00, 1000.00, 30.00, true, true, true, true);

-- Demo estimate templates based on uploaded CSV data
INSERT INTO public.estimate_templates (id, tenant_id, name, roof_type, template_data, is_active) VALUES 
('660e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'Standard Shingle Roof', 'shingle', '{
  "parameters": [
    {"name": "roof_area", "label": "Roof Area (sq ft)", "type": "number", "required": true},
    {"name": "pitch", "label": "Roof Pitch", "type": "select", "options": ["4/12", "6/12", "8/12", "10/12"], "default": "6/12"},
    {"name": "complexity", "label": "Job Complexity", "type": "select", "options": ["Simple", "Average", "Complex"], "default": "Average"}
  ],
  "materials": [
    {"item": "Architectural Shingles", "unit": "sq", "formula": "roof_area / 100", "unit_cost": 120.00},
    {"item": "Underlayment", "unit": "sq", "formula": "roof_area / 100 * 1.1", "unit_cost": 25.00},
    {"item": "Drip Edge", "unit": "lf", "formula": "roof_area * 0.15", "unit_cost": 3.50},
    {"item": "Ridge Cap", "unit": "lf", "formula": "roof_area * 0.08", "unit_cost": 8.00},
    {"item": "Nails & Fasteners", "unit": "lbs", "formula": "roof_area / 100 * 5", "unit_cost": 1.20}
  ],
  "labor": [
    {"task": "Tear Off", "unit": "sq", "formula": "roof_area / 100", "rate": 75.00},
    {"task": "Installation", "unit": "sq", "formula": "roof_area / 100", "rate": 150.00},
    {"task": "Cleanup", "unit": "job", "formula": "1", "rate": 200.00}
  ]
}', true),

('660e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', 'Standard Metal Roof', 'metal', '{
  "parameters": [
    {"name": "roof_area", "label": "Roof Area (sq ft)", "type": "number", "required": true},
    {"name": "metal_type", "label": "Metal Type", "type": "select", "options": ["Standing Seam", "Corrugated", "Metal Tile"], "default": "Standing Seam"},
    {"name": "color", "label": "Color", "type": "select", "options": ["Charcoal", "Red", "Green", "Tan"], "default": "Charcoal"}
  ],
  "materials": [
    {"item": "Metal Panels", "unit": "sq", "formula": "roof_area / 100", "unit_cost": 350.00},
    {"item": "Underlayment", "unit": "sq", "formula": "roof_area / 100 * 1.1", "unit_cost": 30.00},
    {"item": "Trim & Flashing", "unit": "lf", "formula": "roof_area * 0.20", "unit_cost": 12.00},
    {"item": "Fasteners", "unit": "lbs", "formula": "roof_area / 100 * 3", "unit_cost": 2.50}
  ],
  "labor": [
    {"task": "Tear Off", "unit": "sq", "formula": "roof_area / 100", "rate": 85.00},
    {"task": "Installation", "unit": "sq", "formula": "roof_area / 100", "rate": 250.00},
    {"task": "Trim Work", "unit": "lf", "formula": "roof_area * 0.20", "rate": 15.00}
  ]
}', true),

('660e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440000', 'Standard Tile Roof', 'tile', '{
  "parameters": [
    {"name": "roof_area", "label": "Roof Area (sq ft)", "type": "number", "required": true},
    {"name": "tile_type", "label": "Tile Type", "type": "select", "options": ["Clay", "Concrete", "Slate"], "default": "Clay"},
    {"name": "style", "label": "Style", "type": "select", "options": ["Mission", "French", "Shake"], "default": "Mission"}
  ],
  "materials": [
    {"item": "Roof Tiles", "unit": "sq", "formula": "roof_area / 100", "unit_cost": 450.00},
    {"item": "Underlayment", "unit": "sq", "formula": "roof_area / 100 * 1.1", "unit_cost": 35.00},
    {"item": "Battens", "unit": "lf", "formula": "roof_area * 0.25", "unit_cost": 2.50},
    {"item": "Ridge Tiles", "unit": "lf", "formula": "roof_area * 0.08", "unit_cost": 25.00}
  ],
  "labor": [
    {"task": "Tear Off", "unit": "sq", "formula": "roof_area / 100", "rate": 95.00},
    {"task": "Installation", "unit": "sq", "formula": "roof_area / 100", "rate": 350.00},
    {"task": "Ridge Installation", "unit": "lf", "formula": "roof_area * 0.08", "rate": 25.00}
  ]
}', true);

-- Demo supplier pricebook entries
INSERT INTO public.supplier_pricebooks (tenant_id, supplier_name, item_code, item_description, category, unit_of_measure, unit_cost, markup_percent, effective_date) VALUES 
('550e8400-e29b-41d4-a716-446655440000', 'ABC Supply', 'AS-ARCH-30', 'Architectural Shingles 30yr', 'Shingles', 'sq', 95.00, 25.00, '2025-01-01'),
('550e8400-e29b-41d4-a716-446655440000', 'ABC Supply', 'UL-SYNTH-15', 'Synthetic Underlayment', 'Underlayment', 'sq', 22.50, 15.00, '2025-01-01'),
('550e8400-e29b-41d4-a716-446655440000', 'SRS Distribution', 'MS-SEAM-26', 'Standing Seam Metal 26ga', 'Metal', 'sq', 285.00, 23.00, '2025-01-01'),
('550e8400-e29b-41d4-a716-446655440000', 'SRS Distribution', 'CT-MISS-STD', 'Clay Mission Tile Standard', 'Tile', 'sq', 380.00, 18.00, '2025-01-01');

-- Demo commission plans
INSERT INTO public.commission_plans (id, tenant_id, name, commission_type, plan_config, is_active) VALUES 
('770e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'Standard Rep Plan', 'gross_percent', '{
  "rate": 3.5,
  "minimum_sale": 5000,
  "cap_amount": null
}', true),

('770e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', 'Senior Rep Plan', 'tiered_margin', '{
  "tiers": [
    {"min_margin": 15, "max_margin": 20, "rate": 2.0},
    {"min_margin": 20, "max_margin": 25, "rate": 3.0},
    {"min_margin": 25, "max_margin": null, "rate": 4.5}
  ]
}', true);

-- Demo contacts
INSERT INTO public.contacts (id, tenant_id, type, first_name, last_name, email, phone, address_street, address_city, address_state, address_zip, latitude, longitude) VALUES 
('880e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', 'homeowner', 'John', 'Smith', 'john.smith@email.com', '(555) 234-5678', '123 Oak Street', 'Springfield', 'IL', '62701', 39.7817, -89.6501),
('880e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', 'homeowner', 'Sarah', 'Johnson', 'sarah.j@email.com', '(555) 345-6789', '456 Maple Avenue', 'Springfield', 'IL', '62702', 39.7990, -89.6441),
('880e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440000', 'homeowner', 'Mike', 'Davis', 'mike.davis@email.com', '(555) 456-7890', '789 Pine Drive', 'Springfield', 'IL', '62703', 39.7656, -89.6298),
('880e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440000', 'homeowner', 'Lisa', 'Wilson', 'lisa.wilson@email.com', '(555) 567-8901', '321 Cedar Lane', 'Springfield', 'IL', '62704', 39.8123, -89.6176);

-- Demo pipeline entries (various stages)
INSERT INTO public.pipeline_entries (id, tenant_id, contact_id, status, source, roof_type, priority, estimated_value, probability_percent, expected_close_date) VALUES 
('990e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', '880e8400-e29b-41d4-a716-446655440001', 'lead', 'referral', 'shingle', 'high', 18500.00, 75, '2025-10-15'),
('990e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', '880e8400-e29b-41d4-a716-446655440002', 'legal_review', 'canvassing', 'metal', 'medium', 35000.00, 60, '2025-10-30'),
('990e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440000', '880e8400-e29b-41d4-a716-446655440003', 'contingency_signed', 'online', 'tile', 'high', 42000.00, 85, '2025-11-15'),
('990e8400-e29b-41d4-a716-446655440004', '550e8400-e29b-41d4-a716-446655440000', '880e8400-e29b-41d4-a716-446655440004', 'project', 'advertisement', 'shingle', 'medium', 22000.00, 95, '2025-09-30');

-- Demo estimates
INSERT INTO public.estimates (id, tenant_id, pipeline_entry_id, template_id, estimate_number, status, parameters, material_cost, labor_cost, overhead_percent, overhead_amount, target_margin_percent, selling_price, actual_profit, actual_margin_percent, valid_until) VALUES 
('aa0e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', '990e8400-e29b-41d4-a716-446655440001', '660e8400-e29b-41d4-a716-446655440001', 'EST-2025-0001', 'sent', '{"roof_area": 2400, "pitch": "6/12", "complexity": "Average"}', 8500.00, 5200.00, 12.0, 2220.00, 30.0, 18500.00, 2580.00, 18.5, '2025-10-18'),
('aa0e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440000', '990e8400-e29b-41d4-a716-446655440002', '660e8400-e29b-41d4-a716-446655440002', 'EST-2025-0002', 'approved', '{"roof_area": 2800, "metal_type": "Standing Seam", "color": "Charcoal"}', 15200.00, 8900.00, 15.0, 5250.00, 30.0, 35000.00, 5650.00, 19.3, '2025-11-01'),
('aa0e8400-e29b-41d4-a716-446655440003', '550e8400-e29b-41d4-a716-446655440000', '990e8400-e29b-41d4-a716-446655440003', '660e8400-e29b-41d4-a716-446655440003', 'EST-2025-0003', 'draft', '{"roof_area": 3200, "tile_type": "Clay", "style": "Mission"}', 21800.00, 12600.00, 18.0, 7560.00, 30.0, 42000.00, -40.00, 28.8, '2025-11-20');

-- Demo project (created from approved estimate)
INSERT INTO public.projects (id, tenant_id, pipeline_entry_id, project_number, name, description, start_date, estimated_completion_date, status) VALUES 
('bb0e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440000', '990e8400-e29b-41d4-a716-446655440004', 'PROJ-2025-0001', 'Lisa Wilson - 321 Cedar Lane', 'Shingle roof replacement project', '2025-09-01', '2025-09-30', 'active');

-- Demo project budget snapshot
INSERT INTO public.project_budget_snapshots (tenant_id, project_id, estimate_id, original_budget, is_current) VALUES 
('550e8400-e29b-41d4-a716-446655440000', 'bb0e8400-e29b-41d4-a716-446655440001', 'aa0e8400-e29b-41d4-a716-446655440002', '{
  "estimate_id": "aa0e8400-e29b-41d4-a716-446655440002",
  "estimate_number": "EST-2025-0002",
  "material_cost": 15200.00,
  "labor_cost": 8900.00,
  "overhead_amount": 5250.00,
  "selling_price": 35000.00,
  "actual_profit": 5650.00,
  "actual_margin_percent": 19.3,
  "approved_at": "2025-09-15T10:30:00Z"
}', true);

-- Demo project costs (actuals)
INSERT INTO public.project_costs (tenant_id, project_id, cost_type, description, quantity, unit_cost, total_cost, vendor_name, cost_date) VALUES 
('550e8400-e29b-41d4-a716-446655440000', 'bb0e8400-e29b-41d4-a716-446655440001', 'material', 'Standing Seam Metal Panels', 28.0, 350.00, 9800.00, 'ABC Supply', '2025-09-05'),
('550e8400-e29b-41d4-a716-446655440000', 'bb0e8400-e29b-41d4-a716-446655440001', 'material', 'Synthetic Underlayment', 31.0, 25.00, 775.00, 'ABC Supply', '2025-09-05'),
('550e8400-e29b-41d4-a716-446655440000', 'bb0e8400-e29b-41d4-a716-446655440001', 'labor', 'Installation Labor - Day 1', 8.0, 75.00, 600.00, 'Crew Alpha', '2025-09-08'),
('550e8400-e29b-41d4-a716-446655440000', 'bb0e8400-e29b-41d4-a716-446655440001', 'labor', 'Installation Labor - Day 2', 10.0, 75.00, 750.00, 'Crew Alpha', '2025-09-09');