-- Seed 5V Painted Metal with Polyglass XFR template items
-- Template ID: 9f632454-6e69-4cc5-9ebf-4e7965764e44

-- First, clear any existing items for this template to avoid duplicates
DELETE FROM template_items WHERE template_id = '9f632454-6e69-4cc5-9ebf-4e7965764e44';

-- Insert material items with smart tag qty_formulas
INSERT INTO template_items (template_id, item_type, item_name, description, unit, unit_cost, qty_formula, measurement_type, sort_order)
VALUES 
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', '5V Metal Panels 26ga Painted', '26-gauge painted 5V crimp panels', 'panel', 38.00, '{{ ceil(waste.12pct.sqft / 20) }}', 'roof_area', 1),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Polyglass XFR Underlayment', 'High-temp synthetic underlayment 4sq roll', 'roll', 125.00, '{{ ceil(roof.squares / 4) }}', 'roof_squares', 2),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Metal Ridge Cap', '10ft metal ridge cap', 'piece', 28.00, '{{ ceil(lf.ridge / 10) }}', 'linear_ridge', 3),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Metal Hip Cap', '10ft metal hip cap', 'piece', 28.00, '{{ ceil(lf.hip / 10) }}', 'linear_hip', 4),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Eave Closure Strip', '3ft foam closure strip', 'piece', 4.50, '{{ ceil(lf.eave / 3) }}', 'linear_eave', 5),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Ridge Closure Strip', '3ft foam closure strip', 'piece', 4.50, '{{ ceil(lf.ridge / 3) }}', 'linear_ridge', 6),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Metal Rake Trim', '10ft metal rake trim', 'piece', 18.00, '{{ ceil(lf.rake / 10) }}', 'linear_rake', 7),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Pancake Screws #10 x 1"', 'Metal roofing screws box of 250', 'box', 45.00, '{{ ceil(roof.squares * 80 / 250) }}', 'roof_squares', 8),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Butyl Tape 1"', 'Sealing tape roll', 'roll', 18.00, '{{ ceil(roof.squares / 5) }}', 'roof_squares', 9),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'material', 'Metal Pipe Boot', 'Metal roof pipe flashing', 'each', 35.00, '{{ penetrations.pipe_vents }}', 'penetrations', 10);

-- Insert labor items
INSERT INTO template_items (template_id, item_type, item_name, description, unit, unit_cost, qty_formula, measurement_type, sort_order)
VALUES 
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'labor', 'Tear Off', 'Remove existing roofing', 'sq', 55.00, '{{ roof.squares }}', 'roof_squares', 11),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'labor', 'Deck Prep', 'Prepare deck for metal installation', 'sq', 20.00, '{{ roof.squares }}', 'roof_squares', 12),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'labor', 'Panel Install', 'Install 5V metal panels', 'sq', 120.00, '{{ roof.squares }}', 'roof_squares', 13),
  ('9f632454-6e69-4cc5-9ebf-4e7965764e44', 'labor', 'Trim Install', 'Install all metal trim and flashing', 'lf', 4.00, '{{ lf.eave + lf.rake + lf.ridge + lf.hip }}', 'linear_total', 14);