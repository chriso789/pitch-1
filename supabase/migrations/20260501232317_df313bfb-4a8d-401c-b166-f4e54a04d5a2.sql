
-- Update Shingle template to match O'Brien's
UPDATE estimate_templates
SET template_data = '{
  "parameters": [
    {"name": "roof_area", "label": "Roof Area (sq ft)", "type": "number", "required": true},
    {"name": "pitch", "label": "Roof Pitch", "type": "select", "default": "6/12", "options": ["4/12", "6/12", "8/12", "10/12"]},
    {"name": "complexity", "label": "Job Complexity", "type": "select", "default": "Average", "options": ["Simple", "Average", "Complex"]}
  ],
  "materials": [
    {"item": "Architectural Shingles", "formula": "roof_area / 100", "unit": "sq", "unit_cost": 120},
    {"item": "Underlayment", "formula": "roof_area / 100 * 1.1", "unit": "sq", "unit_cost": 25},
    {"item": "Drip Edge", "formula": "roof_area * 0.15", "unit": "lf", "unit_cost": 3.5},
    {"item": "Ridge Cap", "formula": "roof_area * 0.08", "unit": "lf", "unit_cost": 8},
    {"item": "Nails & Fasteners", "formula": "roof_area / 100 * 5", "unit": "lbs", "unit_cost": 1.2}
  ],
  "labor": [
    {"task": "Tear Off", "formula": "roof_area / 100", "unit": "sq", "rate": 75},
    {"task": "Installation", "formula": "roof_area / 100", "unit": "sq", "rate": 150},
    {"task": "Cleanup", "formula": "1", "unit": "job", "rate": 200}
  ]
}'::jsonb,
    name = 'Standard Shingle Roof',
    updated_at = now()
WHERE id = 'd4bcf7d6-da5f-4392-838e-bf62bd237bc1';

-- Update Metal template to match O'Brien's
UPDATE estimate_templates
SET template_data = '{
  "parameters": [
    {"name": "roof_area", "label": "Roof Area (sq ft)", "type": "number", "required": true},
    {"name": "metal_type", "label": "Metal Type", "type": "select", "default": "Standing Seam", "options": ["Standing Seam", "Corrugated", "Metal Tile"]},
    {"name": "color", "label": "Color", "type": "select", "default": "Charcoal", "options": ["Charcoal", "Red", "Green", "Tan"]}
  ],
  "materials": [
    {"item": "Metal Panels", "formula": "roof_area / 100", "unit": "sq", "unit_cost": 350},
    {"item": "Underlayment", "formula": "roof_area / 100 * 1.1", "unit": "sq", "unit_cost": 30},
    {"item": "Trim & Flashing", "formula": "roof_area * 0.20", "unit": "lf", "unit_cost": 12},
    {"item": "Fasteners", "formula": "roof_area / 100 * 3", "unit": "lbs", "unit_cost": 2.5}
  ],
  "labor": [
    {"task": "Tear Off", "formula": "roof_area / 100", "unit": "sq", "rate": 85},
    {"task": "Installation", "formula": "roof_area / 100", "unit": "sq", "rate": 250},
    {"task": "Trim Work", "formula": "roof_area * 0.20", "unit": "lf", "rate": 15}
  ]
}'::jsonb,
    name = 'Standard Metal Roof',
    updated_at = now()
WHERE id = '4262461d-2422-44c4-a098-199151329cd7';

-- Update Tile template to match O'Brien's
UPDATE estimate_templates
SET template_data = '{
  "parameters": [
    {"name": "roof_area", "label": "Roof Area (sq ft)", "type": "number", "required": true},
    {"name": "tile_type", "label": "Tile Type", "type": "select", "default": "Clay", "options": ["Clay", "Concrete", "Slate"]},
    {"name": "style", "label": "Style", "type": "select", "default": "Mission", "options": ["Mission", "French", "Shake"]}
  ],
  "materials": [
    {"item": "Roof Tiles", "formula": "roof_area / 100", "unit": "sq", "unit_cost": 450},
    {"item": "Underlayment", "formula": "roof_area / 100 * 1.1", "unit": "sq", "unit_cost": 35},
    {"item": "Battens", "formula": "roof_area * 0.25", "unit": "lf", "unit_cost": 2.5},
    {"item": "Ridge Tiles", "formula": "roof_area * 0.08", "unit": "lf", "unit_cost": 25}
  ],
  "labor": [
    {"task": "Tear Off", "formula": "roof_area / 100", "unit": "sq", "rate": 95},
    {"task": "Installation", "formula": "roof_area / 100", "unit": "sq", "rate": 350},
    {"task": "Ridge Installation", "formula": "roof_area * 0.08", "unit": "lf", "rate": 25}
  ]
}'::jsonb,
    name = 'Standard Tile Roof',
    updated_at = now()
WHERE id = '67df42ec-857b-4af6-adcb-0b746a9a6149';
