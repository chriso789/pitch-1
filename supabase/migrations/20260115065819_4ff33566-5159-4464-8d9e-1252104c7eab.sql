-- Fix the 5V Metal Panels template item formula
-- The formula was calculating panels (sqft/20) but labeled as SQ (squares)
-- Fix: Use squares directly for SQ unit
UPDATE estimate_calc_template_items 
SET qty_formula = '{{ ceil(waste.12pct.squares) }}' 
WHERE id = '7969dc40-4630-41ca-81ff-d28570dec067';