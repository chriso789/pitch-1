-- Phase 5: Measurement-Based Template for Testing
-- This template demonstrates smart tag integration with measurement data
-- Insert this into estimate_calculation_templates table for testing

INSERT INTO estimate_calculation_templates (
  name,
  description,
  template_items,
  is_active,
  tenant_id
) VALUES (
  'Measurement-Based Roofing Template',
  'Auto-calculates quantities from roof measurements using smart tags',
  '[
    {
      "name": "Asphalt Shingles",
      "qty": "{{ roof.squares }}",
      "unit": "square",
      "unit_cost": 150,
      "markup_percent": 25,
      "description": "3-tab architectural shingles based on measured roof area"
    },
    {
      "name": "Ridge Cap Shingles",
      "qty": "{{ ceil((lf.ridge + lf.hip) / 3) }}",
      "unit": "bundle",
      "unit_cost": 45,
      "markup_percent": 25,
      "description": "Ridge cap covering calculated from ridge and hip lengths"
    },
    {
      "name": "Starter Strip",
      "qty": "{{ ceil((lf.eave + lf.rake) / 100) }}",
      "unit": "bundle",
      "unit_cost": 35,
      "markup_percent": 25,
      "description": "Starter strip for eaves and rakes"
    },
    {
      "name": "Ice & Water Shield",
      "qty": "{{ ceil((lf.valley + lf.eave * 0.25) / 65) }}",
      "unit": "roll",
      "unit_cost": 85,
      "markup_percent": 25,
      "description": "Valleys plus 25% of eave coverage"
    },
    {
      "name": "Drip Edge",
      "qty": "{{ ceil((lf.eave + lf.rake) / 10) }}",
      "unit": "piece",
      "unit_cost": 12,
      "markup_percent": 25,
      "description": "10ft pieces for perimeter protection"
    },
    {
      "name": "Valley Material",
      "qty": "{{ ceil(lf.valley / 10) }}",
      "unit": "piece",
      "unit_cost": 18,
      "markup_percent": 25,
      "description": "Valley flashing material"
    }
  ]'::jsonb,
  true,
  (SELECT id FROM tenants LIMIT 1)
)
ON CONFLICT DO NOTHING;

-- Test Cases for Template Validation:
-- 
-- Given measurement data:
--   roof.squares = 45.70
--   lf.ridge = 60 ft
--   lf.hip = 40 ft
--   lf.valley = 30 ft
--   lf.eave = 120 ft
--   lf.rake = 80 ft
--
-- Expected calculated quantities:
--   1. Asphalt Shingles: 45.70 squares (direct from roof.squares)
--   2. Ridge Cap: ceil((60+40)/3) = ceil(33.33) = 34 bundles
--   3. Starter Strip: ceil((120+80)/100) = ceil(2.0) = 2 bundles
--   4. Ice & Water: ceil((30 + 120*0.25)/65) = ceil(60/65) = ceil(0.92) = 1 roll
--   5. Drip Edge: ceil((120+80)/10) = ceil(20.0) = 20 pieces
--   6. Valley Material: ceil(30/10) = ceil(3.0) = 3 pieces
--
-- Validation Steps:
--   1. Load estimate builder with measurement data
--   2. Select "Measurement-Based Roofing Template"
--   3. Verify template engine calls applyTemplateItems()
--   4. Verify quantities match expected values above
--   5. Save estimate and confirm quantities persist
