-- Add margin_override column to estimate_calc_template_items
-- 0 = use template default margin, any other value overrides for this specific item
ALTER TABLE estimate_calc_template_items
ADD COLUMN IF NOT EXISTS margin_override numeric DEFAULT 0;

COMMENT ON COLUMN estimate_calc_template_items.margin_override IS 
  '0 = use template default margin. Any other value overrides the template margin for this item.';